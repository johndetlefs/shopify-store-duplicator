/**
 * Integrations Apply
 *
 * Imports webhook subscriptions and web pixels into the destination store.
 *
 * Purpose:
 * - Read integrations from JSON dump
 * - Create webhook subscriptions (idempotent: checks existing by topic+uri)
 * - Create web pixels (creates new instances, no deduplication)
 *
 * Idempotency:
 * - Webhooks: Checks existing subscriptions by topic+uri; skips if already exists
 * - Pixels: Creates new instances (Shopify handles deduplication internally)
 * - Safe to re-run; skips existing webhooks, may create duplicate pixels if run multiple times
 *
 * Note: Webhook callback URLs are preserved as-is from the dump.
 * You may want to remap URLs if destination uses different endpoints.
 */

import * as fs from "node:fs";
import { GraphQLClient } from "../graphql/client.js";
import {
  WEBHOOK_SUBSCRIPTIONS_QUERY,
  WEBHOOK_SUBSCRIPTION_CREATE,
  WEB_PIXEL_CREATE,
} from "../graphql/queries.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";
import type { IntegrationsDump, WebhookData, PixelData } from "./dump.js";

export interface IntegrationsApplyStats {
  webhooks: {
    created: number;
    skipped: number;
    failed: number;
  };
  pixels: {
    created: number;
    failed: number;
  };
  errors: Array<{
    type: "webhook" | "pixel";
    item: string;
    error: string;
  }>;
}

/**
 * Apply integrations from a dump file to the destination store
 */
export async function applyIntegrations(
  client: GraphQLClient,
  inputFile: string
): Promise<Result<IntegrationsApplyStats>> {
  logger.info("Starting integrations apply...");

  try {
    // Read dump file
    if (!fs.existsSync(inputFile)) {
      return err(new Error(`Input file not found: ${inputFile}`));
    }

    const content = fs.readFileSync(inputFile, "utf-8");
    const dump: IntegrationsDump = JSON.parse(content);

    if (!dump.webhooks && !dump.pixels) {
      return err(
        new Error("Invalid dump format: missing 'webhooks' or 'pixels'")
      );
    }

    logger.info(
      `Loaded ${dump.webhooks?.length || 0} webhooks and ${
        dump.pixels?.length || 0
      } pixels from dump`
    );

    const stats: IntegrationsApplyStats = {
      webhooks: {
        created: 0,
        skipped: 0,
        failed: 0,
      },
      pixels: {
        created: 0,
        failed: 0,
      },
      errors: [],
    };

    // Fetch existing webhooks to avoid duplicates
    const existingWebhooks = await fetchExistingWebhooks(client);
    if (!existingWebhooks.ok) {
      return err(existingWebhooks.error);
    }

    // Apply webhooks
    if (dump.webhooks && Array.isArray(dump.webhooks)) {
      logger.info(`Applying ${dump.webhooks.length} webhooks...`);

      for (const webhook of dump.webhooks) {
        // Check if webhook already exists (by topic + uri)
        const exists = existingWebhooks.data.some(
          (w) => w.topic === webhook.topic && w.uri === webhook.uri
        );

        if (exists) {
          stats.webhooks.skipped++;
          logger.info(`⏭️  Skipping existing webhook: ${webhook.topic}`);
          continue;
        }

        // Create webhook
        const result = await createWebhook(client, webhook);
        if (result.ok) {
          stats.webhooks.created++;
          logger.info(`✅ Created webhook: ${webhook.topic}`);
        } else {
          stats.webhooks.failed++;
          stats.errors.push({
            type: "webhook",
            item: webhook.topic,
            error: result.error.message,
          });
          logger.warn(`❌ Failed to create webhook: ${webhook.topic}`, {
            error: result.error.message,
          });
        }

        // Throttle to avoid rate limits
        await sleep(500);
      }
    }

    // Apply pixels
    if (dump.pixels && Array.isArray(dump.pixels)) {
      logger.info(`Applying ${dump.pixels.length} web pixels...`);

      for (const pixel of dump.pixels) {
        const result = await createPixel(client, pixel);
        if (result.ok) {
          stats.pixels.created++;
          logger.info(`✅ Created web pixel`);
        } else {
          stats.pixels.failed++;
          stats.errors.push({
            type: "pixel",
            item: "Web Pixel",
            error: result.error.message,
          });
          logger.warn(`❌ Failed to create web pixel`, {
            error: result.error.message,
          });
        }

        // Throttle to avoid rate limits
        await sleep(500);
      }
    }

    logger.info("Integrations apply complete", {
      webhooks: stats.webhooks,
      pixels: stats.pixels,
    });

    return ok(stats);
  } catch (error) {
    logger.error("Error applying integrations", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Fetch existing webhook subscriptions to avoid duplicates
 */
async function fetchExistingWebhooks(
  client: GraphQLClient
): Promise<Result<Array<{ topic: string; uri: string }>>> {
  logger.info("Fetching existing webhook subscriptions...");

  const webhooks: Array<{ topic: string; uri: string }> = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  const pageSize = 50;

  try {
    while (hasNextPage) {
      const result: any = await client.request({
        query: WEBHOOK_SUBSCRIPTIONS_QUERY,
        variables: {
          first: pageSize,
          after: cursor,
        },
      });

      if (!result.ok) {
        return err(result.error);
      }

      const connection: any = result.data.data?.webhookSubscriptions;
      if (!connection) {
        return err(new Error("No webhookSubscriptions data returned"));
      }

      // Process edges
      if (connection.edges && Array.isArray(connection.edges)) {
        for (const edge of connection.edges) {
          const node = edge.node;
          if (node) {
            webhooks.push({
              topic: String(node.topic),
              uri: String(node.uri),
            });
          }
        }
      }

      // Check for next page
      hasNextPage = connection.pageInfo?.hasNextPage || false;
      cursor = connection.pageInfo?.endCursor || null;
    }

    logger.info(`Found ${webhooks.length} existing webhook subscriptions`);
    return ok(webhooks);
  } catch (error) {
    logger.error("Error fetching existing webhooks", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Create a webhook subscription
 */
async function createWebhook(
  client: GraphQLClient,
  webhook: WebhookData
): Promise<Result<void>> {
  try {
    // Build webhookSubscription input
    const webhookSubscription: any = {
      callbackUrl: webhook.uri,
      format: webhook.format,
    };

    // Add optional fields
    if (webhook.filter) {
      webhookSubscription.filter = webhook.filter;
    }
    if (webhook.includeFields && webhook.includeFields.length > 0) {
      webhookSubscription.includeFields = webhook.includeFields;
    }
    if (webhook.metafieldNamespaces && webhook.metafieldNamespaces.length > 0) {
      webhookSubscription.metafieldNamespaces = webhook.metafieldNamespaces;
    }

    const result: any = await client.request({
      query: WEBHOOK_SUBSCRIPTION_CREATE,
      variables: {
        topic: webhook.topic,
        webhookSubscription,
      },
    });

    if (!result.ok) {
      return err(result.error);
    }

    const response = result.data.data?.webhookSubscriptionCreate;
    if (response?.userErrors && response.userErrors.length > 0) {
      const errorMsg = response.userErrors
        .map((e: any) => e.message)
        .join(", ");
      return err(new Error(errorMsg));
    }

    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Create a web pixel
 */
async function createPixel(
  client: GraphQLClient,
  pixel: PixelData
): Promise<Result<void>> {
  try {
    // Parse settings (they're stored as JSON string)
    let settings: any;
    try {
      settings = JSON.parse(pixel.settings);
    } catch {
      // If parsing fails, use as-is
      settings = pixel.settings;
    }

    const result: any = await client.request({
      query: WEB_PIXEL_CREATE,
      variables: {
        webPixel: {
          settings,
        },
      },
    });

    if (!result.ok) {
      return err(result.error);
    }

    const response = result.data.data?.webPixelCreate;
    if (response?.userErrors && response.userErrors.length > 0) {
      const errorMsg = response.userErrors
        .map((e: any) => `${e.code}: ${e.message}`)
        .join(", ");
      return err(new Error(errorMsg));
    }

    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Sleep for the given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
