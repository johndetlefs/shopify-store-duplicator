/**
 * Data Diff
 *
 * Compare dumped data against live destination store.
 *
 * Purpose:
 * - Validate that data was applied correctly
 * - Detect missing or extra resources
 * - Identify synchronization gaps
 *
 * Comparison by natural keys:
 * - Metaobjects: {type}:{handle}
 * - Products: handle
 * - Collections: handle
 * - Pages: handle
 *
 * Note: This is a high-level comparison (presence/absence).
 * Field-level comparison would be too verbose for practical use.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { GraphQLClient } from "../graphql/client.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";
import { runBulkQueryAndDownload } from "../bulk/runner.js";
import {
  METAOBJECTS_BY_TYPE_BULK,
  PRODUCTS_BULK,
  COLLECTIONS_BULK,
  PAGES_BULK,
} from "../graphql/queries.js";

export interface DataDiffResult {
  metaobjects: Record<
    string,
    {
      missing: string[]; // Handles missing in destination
      extra: string[]; // Handles in destination but not in source
    }
  >;
  products: {
    missing: string[];
    extra: string[];
  };
  collections: {
    missing: string[];
    extra: string[];
  };
  pages: {
    missing: string[];
    extra: string[];
  };
  summary: {
    totalMissing: number;
    totalExtra: number;
    totalIssues: number;
    isIdentical: boolean;
  };
}

/**
 * Compare data from dump files with live destination store
 */
export async function diffData(
  destinationClient: GraphQLClient,
  dumpDir: string
): Promise<Result<DataDiffResult>> {
  logger.info("Starting data diff...");

  try {
    const result: DataDiffResult = {
      metaobjects: {},
      products: { missing: [], extra: [] },
      collections: { missing: [], extra: [] },
      pages: { missing: [], extra: [] },
      summary: {
        totalMissing: 0,
        totalExtra: 0,
        totalIssues: 0,
        isIdentical: true,
      },
    };

    // Compare metaobjects by type
    const metaobjectsDir = path.join(dumpDir, "metaobjects");
    if (fs.existsSync(metaobjectsDir)) {
      const types = fs
        .readdirSync(metaobjectsDir)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(".json", ""));

      for (const type of types) {
        logger.info(`Comparing metaobjects of type: ${type}`);
        const typeResult = await compareMetaobjectsByType(
          destinationClient,
          metaobjectsDir,
          type
        );
        if (typeResult.ok) {
          result.metaobjects[type] = typeResult.data;
          result.summary.totalMissing += typeResult.data.missing.length;
          result.summary.totalExtra += typeResult.data.extra.length;
        } else {
          logger.warn(`Failed to compare metaobjects type ${type}:`, {
            error: typeResult.error.message,
          });
        }
      }
    }

    // Compare products
    const productsFile = path.join(dumpDir, "products.json");
    if (fs.existsSync(productsFile)) {
      logger.info("Comparing products...");
      const productsResult = await compareProducts(
        destinationClient,
        productsFile
      );
      if (productsResult.ok) {
        result.products = productsResult.data;
        result.summary.totalMissing += productsResult.data.missing.length;
        result.summary.totalExtra += productsResult.data.extra.length;
      }
    }

    // Compare collections
    const collectionsFile = path.join(dumpDir, "collections.json");
    if (fs.existsSync(collectionsFile)) {
      logger.info("Comparing collections...");
      const collectionsResult = await compareCollections(
        destinationClient,
        collectionsFile
      );
      if (collectionsResult.ok) {
        result.collections = collectionsResult.data;
        result.summary.totalMissing += collectionsResult.data.missing.length;
        result.summary.totalExtra += collectionsResult.data.extra.length;
      }
    }

    // Compare pages
    const pagesFile = path.join(dumpDir, "pages.json");
    if (fs.existsSync(pagesFile)) {
      logger.info("Comparing pages...");
      const pagesResult = await comparePages(destinationClient, pagesFile);
      if (pagesResult.ok) {
        result.pages = pagesResult.data;
        result.summary.totalMissing += pagesResult.data.missing.length;
        result.summary.totalExtra += pagesResult.data.extra.length;
      }
    }

    result.summary.totalIssues =
      result.summary.totalMissing + result.summary.totalExtra;
    result.summary.isIdentical = result.summary.totalIssues === 0;

    logger.info("Data diff complete", {
      totalMissing: result.summary.totalMissing,
      totalExtra: result.summary.totalExtra,
      isIdentical: result.summary.isIdentical,
    });

    return ok(result);
  } catch (error) {
    logger.error("Error during data diff", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Compare metaobjects of a specific type
 */
async function compareMetaobjectsByType(
  client: GraphQLClient,
  dumpDir: string,
  type: string
): Promise<Result<{ missing: string[]; extra: string[] }>> {
  try {
    // Read source dump
    const dumpFile = path.join(dumpDir, `${type}.json`);
    const dumpContent = fs.readFileSync(dumpFile, "utf-8");
    const sourceData = JSON.parse(dumpContent);

    const sourceHandles = new Set<string>(
      sourceData.map((obj: any) => obj.handle).filter(Boolean)
    );

    // Query destination
    const bulkQuery = METAOBJECTS_BY_TYPE_BULK(type);
    const bulkResult = await runBulkQueryAndDownload(client, bulkQuery);
    if (!bulkResult.ok) {
      return err(bulkResult.error);
    }

    const destHandles = new Set<string>();
    for await (const entry of bulkResult.data) {
      if (entry.handle) {
        destHandles.add(entry.handle);
      }
    }

    // Compare
    const missing = Array.from(sourceHandles).filter(
      (h) => !destHandles.has(h)
    );
    const extra = Array.from(destHandles).filter((h) => !sourceHandles.has(h));

    return ok({ missing, extra });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Compare products
 */
async function compareProducts(
  client: GraphQLClient,
  dumpFile: string
): Promise<Result<{ missing: string[]; extra: string[] }>> {
  try {
    // Read source dump
    const dumpContent = fs.readFileSync(dumpFile, "utf-8");
    const sourceData = JSON.parse(dumpContent);

    const sourceHandles = new Set(
      sourceData.map((p: any) => p.handle).filter(Boolean)
    );

    // Query destination
    const bulkResult = await runBulkQueryAndDownload(client, PRODUCTS_BULK);
    if (!bulkResult.ok) {
      return err(bulkResult.error);
    }

    const destHandles = new Set<string>();
    for await (const entry of bulkResult.data) {
      if (entry.handle && entry.__typename === "Product") {
        destHandles.add(entry.handle);
      }
    }

    // Compare
    const missing = Array.from(sourceHandles).filter(
      (h) => !destHandles.has(h as string)
    ) as string[];
    const extra = Array.from(destHandles).filter((h) => !sourceHandles.has(h));

    return ok({ missing, extra });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Compare collections
 */
async function compareCollections(
  client: GraphQLClient,
  dumpFile: string
): Promise<Result<{ missing: string[]; extra: string[] }>> {
  try {
    // Read source dump
    const dumpContent = fs.readFileSync(dumpFile, "utf-8");
    const sourceData = JSON.parse(dumpContent);

    const sourceHandles = new Set<string>(
      sourceData.map((c: any) => c.handle).filter(Boolean)
    );

    // Query destination
    const bulkResult = await runBulkQueryAndDownload(client, COLLECTIONS_BULK);
    if (!bulkResult.ok) {
      return err(bulkResult.error);
    }

    const destHandles = new Set<string>();
    for await (const entry of bulkResult.data) {
      if (entry.handle && entry.__typename === "Collection") {
        destHandles.add(entry.handle);
      }
    }

    // Compare
    const missing = Array.from(sourceHandles).filter(
      (h) => !destHandles.has(h)
    );
    const extra = Array.from(destHandles).filter((h) => !sourceHandles.has(h));

    return ok({ missing, extra });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Compare pages
 */
async function comparePages(
  client: GraphQLClient,
  dumpFile: string
): Promise<Result<{ missing: string[]; extra: string[] }>> {
  try {
    // Read source dump
    const dumpContent = fs.readFileSync(dumpFile, "utf-8");
    const sourceData = JSON.parse(dumpContent);

    const sourceHandles = new Set<string>(
      sourceData.map((p: any) => p.handle).filter(Boolean)
    );

    // Query destination
    const bulkResult = await runBulkQueryAndDownload(client, PAGES_BULK);
    if (!bulkResult.ok) {
      return err(bulkResult.error);
    }

    const destHandles = new Set<string>();
    for await (const entry of bulkResult.data) {
      if (entry.handle && entry.__typename === "Page") {
        destHandles.add(entry.handle);
      }
    }

    // Compare
    const missing = Array.from(sourceHandles).filter(
      (h) => !destHandles.has(h)
    );
    const extra = Array.from(destHandles).filter((h) => !sourceHandles.has(h));

    return ok({ missing, extra });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
