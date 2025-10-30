/**
 * Redirects Apply
 *
 * Imports URL redirects into the destination store.
 *
 * Purpose:
 * - Read redirects from JSON dump
 * - Create/update redirects in destination using urlRedirectCreate/urlRedirectUpdate mutations
 * - Skip redirects that already exist with matching targets (fully idempotent)
 * - Track success/failure stats
 *
 * Idempotency (Upsert Pattern):
 * - Queries existing redirects first (path → {id, target})
 * - If path doesn't exist → CREATE redirect
 * - If path exists but target differs → UPDATE redirect
 * - If path exists and target matches → SKIP (unchanged)
 * - Safe to re-run, handles user errors/corrections
 *
 * Note: Shopify doesn't have a bulk redirect creation mutation,
 * so we create/update them one at a time with throttling.
 */

import * as fs from "node:fs";
import { GraphQLClient } from "../graphql/client.js";
import { REDIRECT_CREATE, REDIRECT_UPDATE } from "../graphql/queries.js";
import { runBulkQueryAndDownload } from "../bulk/runner.js";
import { REDIRECTS_BULK } from "../graphql/queries.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";
import type { DumpedRedirect, RedirectsDump } from "./dump.js";

export interface ApplyStats {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ path: string; error: string }>;
}

interface ExistingRedirect {
  id: string;
  target: string;
}

/**
 * Apply redirects from a dump file to the destination store
 */
export async function applyRedirects(
  client: GraphQLClient,
  inputFile: string
): Promise<Result<ApplyStats>> {
  logger.info("Starting redirects apply...");

  try {
    // Read dump file
    if (!fs.existsSync(inputFile)) {
      return err(new Error(`Input file not found: ${inputFile}`));
    }

    const content = fs.readFileSync(inputFile, "utf-8");
    const dump: RedirectsDump = JSON.parse(content);

    if (!dump.redirects || !Array.isArray(dump.redirects)) {
      return err(new Error("Invalid dump format: missing 'redirects' array"));
    }

    logger.info(`Loaded ${dump.redirects.length} redirects from dump`);

    // Fetch existing redirects to avoid duplicates
    logger.info("Fetching existing redirects...");
    const existingResult = await fetchExistingRedirects(client);
    if (!existingResult.ok) {
      return err(existingResult.error);
    }

    const existingRedirects = existingResult.data;
    logger.info(`Found ${existingRedirects.size} existing redirects`);

    // Apply redirects
    const stats: ApplyStats = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    for (const redirect of dump.redirects) {
      const existing = existingRedirects.get(redirect.path);

      // If redirect doesn't exist, create it
      if (!existing) {
        const createResult = await createRedirect(client, redirect);
        if (createResult.ok) {
          stats.created++;
          logger.info(
            `✅ Created redirect: ${redirect.path} → ${redirect.target}`
          );
        } else {
          stats.failed++;
          stats.errors.push({
            path: redirect.path,
            error: createResult.error.message,
          });
          logger.warn(`❌ Failed to create redirect: ${redirect.path}`, {
            error: createResult.error.message,
          });
        }
      }
      // If target has changed, update it
      else if (existing.target !== redirect.target) {
        const updateResult = await updateRedirect(
          client,
          existing.id,
          redirect
        );
        if (updateResult.ok) {
          stats.updated++;
          logger.info(
            `🔄 Updated redirect: ${redirect.path} (${existing.target} → ${redirect.target})`
          );
        } else {
          stats.failed++;
          stats.errors.push({
            path: redirect.path,
            error: updateResult.error.message,
          });
          logger.warn(`❌ Failed to update redirect: ${redirect.path}`, {
            error: updateResult.error.message,
          });
        }
      }
      // If path and target match, skip
      else {
        stats.skipped++;
        logger.debug(
          `⏭️  Skipping unchanged redirect: ${redirect.path} → ${redirect.target}`
        );
      }

      // Throttle to avoid rate limits (2 requests per second)
      await sleep(500);
    }

    logger.info("Redirects apply complete", {
      created: stats.created,
      updated: stats.updated,
      skipped: stats.skipped,
      failed: stats.failed,
    });

    return ok(stats);
  } catch (error) {
    logger.error("Error applying redirects", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Fetch all existing redirect paths from the destination store
 */
async function fetchExistingRedirects(
  client: GraphQLClient
): Promise<Result<Map<string, ExistingRedirect>>> {
  try {
    const bulkResult = await runBulkQueryAndDownload(client, REDIRECTS_BULK);
    if (!bulkResult.ok) {
      return err(bulkResult.error);
    }

    const redirects = new Map<string, ExistingRedirect>();
    for await (const line of bulkResult.data) {
      if (line.path && line.target && line.id) {
        redirects.set(String(line.path), {
          id: String(line.id),
          target: String(line.target),
        });
      }
    }

    return ok(redirects);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Create a single redirect using the urlRedirectCreate mutation
 */
async function createRedirect(
  client: GraphQLClient,
  redirect: DumpedRedirect
): Promise<Result<void>> {
  try {
    const result = await client.request({
      query: REDIRECT_CREATE,
      variables: {
        urlRedirect: {
          path: redirect.path,
          target: redirect.target,
        },
      },
    });

    if (!result.ok) {
      return err(result.error);
    }

    const response = result.data.data?.urlRedirectCreate;
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
 * Update an existing redirect using the urlRedirectUpdate mutation
 */
async function updateRedirect(
  client: GraphQLClient,
  id: string,
  redirect: DumpedRedirect
): Promise<Result<void>> {
  try {
    const result = await client.request({
      query: REDIRECT_UPDATE,
      variables: {
        id,
        urlRedirect: {
          path: redirect.path,
          target: redirect.target,
        },
      },
    });

    if (!result.ok) {
      return err(result.error);
    }

    const response = result.data.data?.urlRedirectUpdate;
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
 * Sleep for the given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
