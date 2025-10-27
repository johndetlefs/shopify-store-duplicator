/**
 * Redirects Apply
 *
 * Imports URL redirects into the destination store.
 *
 * Purpose:
 * - Read redirects from JSON dump
 * - Create redirects in destination using urlRedirectCreate mutation
 * - Skip redirects that already exist (idempotent)
 * - Track success/failure stats
 *
 * Idempotency:
 * - Queries existing redirects first
 * - Only creates redirects that don't exist
 * - Safe to re-run
 *
 * Note: Shopify doesn't have a bulk redirect creation mutation,
 * so we create them one at a time with throttling.
 */

import * as fs from "node:fs";
import { GraphQLClient } from "../graphql/client.js";
import { REDIRECT_CREATE } from "../graphql/queries.js";
import { runBulkQueryAndDownload } from "../bulk/runner.js";
import { REDIRECTS_BULK } from "../graphql/queries.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";
import type { DumpedRedirect, RedirectsDump } from "./dump.js";

export interface ApplyStats {
  created: number;
  skipped: number;
  failed: number;
  errors: Array<{ path: string; error: string }>;
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

    const existingPaths = new Set(existingResult.data);
    logger.info(`Found ${existingPaths.size} existing redirects`);

    // Apply redirects
    const stats: ApplyStats = {
      created: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    for (const redirect of dump.redirects) {
      // Skip if already exists
      if (existingPaths.has(redirect.path)) {
        stats.skipped++;
        logger.debug(`Skipping existing redirect: ${redirect.path}`);
        continue;
      }

      // Create redirect
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

      // Throttle to avoid rate limits (2 requests per second)
      await sleep(500);
    }

    logger.info("Redirects apply complete", {
      created: stats.created,
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
): Promise<Result<string[]>> {
  try {
    const bulkResult = await runBulkQueryAndDownload(client, REDIRECTS_BULK);
    if (!bulkResult.ok) {
      return err(bulkResult.error);
    }

    const paths: string[] = [];
    for await (const line of bulkResult.data) {
      if (line.path) {
        paths.push(String(line.path));
      }
    }

    return ok(paths);
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
 * Sleep for the given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
