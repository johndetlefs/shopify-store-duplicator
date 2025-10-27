/**
 * Redirects Dump
 *
 * Exports all URL redirects from the source store to a JSON file.
 *
 * Purpose:
 * - Query all redirects using bulk operations
 * - Export path → target mappings
 * - Simple structure (no nested data)
 *
 * Output Format:
 * ```json
 * {
 *   "redirects": [
 *     { "path": "/old-product", "target": "/products/new-product" },
 *     { "path": "/old-page", "target": "/pages/new-page" }
 *   ]
 * }
 * ```
 *
 * Idempotency: Safe to re-run; always exports current state.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { GraphQLClient } from "../graphql/client.js";
import { REDIRECTS_BULK } from "../graphql/queries.js";
import { runBulkQueryAndDownload } from "../bulk/runner.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";

export interface DumpedRedirect {
  path: string;
  target: string;
}

export interface RedirectsDump {
  redirects: DumpedRedirect[];
}

/**
 * Dump all redirects from the source store
 */
export async function dumpRedirects(
  client: GraphQLClient,
  outputFile: string
): Promise<Result<void>> {
  logger.info("Starting redirects dump...");

  try {
    // Ensure output directory exists
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Run bulk operation to fetch all redirects
    logger.info("Fetching redirects via bulk operation...");
    const bulkResult = await runBulkQueryAndDownload(client, REDIRECTS_BULK);
    if (!bulkResult.ok) {
      return err(bulkResult.error);
    }

    // Transform to dumped format
    const redirects: DumpedRedirect[] = [];

    for await (const line of bulkResult.data) {
      // Each line should be a redirect node with path and target
      if (line.path && line.target) {
        redirects.push({
          path: String(line.path),
          target: String(line.target),
        });
      }
    }

    logger.info(`Found ${redirects.length} redirects`);

    // Write to file
    const dump: RedirectsDump = { redirects };
    fs.writeFileSync(outputFile, JSON.stringify(dump, null, 2));
    logger.info(`✅ Redirects dumped to ${outputFile}`);

    return ok(undefined);
  } catch (error) {
    logger.error("Error dumping redirects", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
