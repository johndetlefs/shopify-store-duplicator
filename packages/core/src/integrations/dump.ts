/**
 * Integrations Dump
 *
 * Exports webhook subscriptions and web pixels from the source store to a JSON file.
 *
 * Purpose:
 * - Query all webhook subscriptions with their topics, URIs, filters, etc.
 * - Query all web pixels with their settings
 * - Export integration configurations for migration
 *
 * Output Format:
 * ```json
 * {
 *   "webhooks": [
 *     {
 *       "topic": "PRODUCTS_CREATE",
 *       "format": "JSON",
 *       "uri": "https://example.com/webhooks",
 *       "filter": "...",
 *       "includeFields": ["id", "title"],
 *       "metafieldNamespaces": ["custom"]
 *     }
 *   ],
 *   "pixels": [
 *     {
 *       "settings": "{\"accountId\":\"...\"}"
 *     }
 *   ]
 * }
 * ```
 *
 * Idempotency: Safe to re-run; always exports current state.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { GraphQLClient } from "../graphql/client.js";
import {
  WEBHOOK_SUBSCRIPTIONS_QUERY,
  WEB_PIXELS_QUERY,
} from "../graphql/queries.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";

export interface WebhookData {
  topic: string;
  format: string;
  uri: string;
  filter?: string | null;
  includeFields?: string[] | null;
  metafieldNamespaces?: string[] | null;
}

export interface PixelData {
  settings: string;
}

export interface IntegrationsDump {
  webhooks: WebhookData[];
  pixels: PixelData[];
}

/**
 * Dump all webhook subscriptions and web pixels from the source store
 */
export async function dumpIntegrations(
  client: GraphQLClient,
  outputFile: string
): Promise<Result<void>> {
  logger.info("Starting integrations dump...");

  try {
    // Ensure output directory exists
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Fetch webhooks and pixels
    const webhooks = await fetchWebhooks(client);
    const pixels = await fetchPixels(client);

    if (!webhooks.ok) {
      return err(webhooks.error);
    }
    if (!pixels.ok) {
      return err(pixels.error);
    }

    logger.info(
      `Found ${webhooks.data.length} webhooks and ${pixels.data.length} pixels`
    );

    // Write to file
    const dump: IntegrationsDump = {
      webhooks: webhooks.data,
      pixels: pixels.data,
    };
    fs.writeFileSync(outputFile, JSON.stringify(dump, null, 2));
    logger.info(`✅ Integrations dumped to ${outputFile}`);

    // Log summary
    if (webhooks.data.length > 0) {
      const topics = webhooks.data.map((w) => w.topic).join(", ");
      logger.info(`   Webhook topics: ${topics}`);
    }
    if (pixels.data.length > 0) {
      logger.info(`   Web pixels: ${pixels.data.length} configured`);
    }

    return ok(undefined);
  } catch (error) {
    logger.error("Error dumping integrations", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Fetch all webhook subscriptions using pagination
 */
async function fetchWebhooks(
  client: GraphQLClient
): Promise<Result<WebhookData[]>> {
  logger.info("Fetching webhook subscriptions...");

  const webhooks: WebhookData[] = [];
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
              format: String(node.format),
              uri: String(node.uri),
              filter: node.filter ? String(node.filter) : null,
              includeFields: node.includeFields || null,
              metafieldNamespaces: node.metafieldNamespaces || null,
            });
          }
        }
      }

      // Check for next page
      hasNextPage = connection.pageInfo?.hasNextPage || false;
      cursor = connection.pageInfo?.endCursor || null;

      logger.debug(
        `Fetched ${connection.edges?.length || 0} webhooks (total: ${
          webhooks.length
        })`
      );
    }

    logger.info(`✅ Fetched ${webhooks.length} webhook subscriptions`);
    return ok(webhooks);
  } catch (error) {
    logger.error("Error fetching webhooks", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Fetch all web pixels using pagination
 */
async function fetchPixels(
  client: GraphQLClient
): Promise<Result<PixelData[]>> {
  logger.info("Fetching web pixels...");

  const pixels: PixelData[] = [];
  let hasNextPage = true;
  let cursor: string | null = null;
  const pageSize = 50;

  try {
    while (hasNextPage) {
      const result: any = await client.request({
        query: WEB_PIXELS_QUERY,
        variables: {
          first: pageSize,
          after: cursor,
        },
      });

      if (!result.ok) {
        return err(result.error);
      }

      const connection: any = result.data.data?.webPixels;
      if (!connection) {
        return err(new Error("No webPixels data returned"));
      }

      // Process edges
      if (connection.edges && Array.isArray(connection.edges)) {
        for (const edge of connection.edges) {
          const node = edge.node;
          if (node && node.settings) {
            pixels.push({
              settings: String(node.settings),
            });
          }
        }
      }

      // Check for next page
      hasNextPage = connection.pageInfo?.hasNextPage || false;
      cursor = connection.pageInfo?.endCursor || null;

      logger.debug(
        `Fetched ${connection.edges?.length || 0} pixels (total: ${
          pixels.length
        })`
      );
    }

    logger.info(`✅ Fetched ${pixels.length} web pixels`);
    return ok(pixels);
  } catch (error) {
    logger.error("Error fetching pixels", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
