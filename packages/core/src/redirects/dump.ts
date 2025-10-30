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
  outputFile: string,
  options: { csv?: boolean } = {}
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
    if (options.csv) {
      // Export as CSV for manual import via Shopify Admin
      const csvContent = generateCsv(redirects);
      fs.writeFileSync(outputFile, csvContent);
      logger.info(`✅ Redirects exported to CSV: ${outputFile}`);
      logger.info(
        `   Import via: Shopify Admin → Content → URL Redirects → Import`
      );
    } else {
      // Export as JSON for programmatic apply
      const dump: RedirectsDump = { redirects };
      fs.writeFileSync(outputFile, JSON.stringify(dump, null, 2));
      logger.info(`✅ Redirects dumped to ${outputFile}`);
    }

    return ok(undefined);
  } catch (error) {
    logger.error("Error dumping redirects", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Generate CSV content in Shopify's redirect import format
 * Format: Redirect from,Redirect to
 */
function generateCsv(redirects: DumpedRedirect[]): string {
  const lines: string[] = [];

  // Header row
  lines.push("Redirect from,Redirect to");

  // Data rows
  for (const redirect of redirects) {
    // Escape quotes and wrap in quotes if needed
    const from = escapeCsvField(redirect.path);
    const to = escapeCsvField(redirect.target);
    lines.push(`${from},${to}`);
  }

  return lines.join("\n");
}

/**
 * Escape CSV field (wrap in quotes if contains comma, quote, or newline)
 */
function escapeCsvField(value: string): string {
  // If field contains comma, quote, or newline, wrap in quotes and escape existing quotes
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
