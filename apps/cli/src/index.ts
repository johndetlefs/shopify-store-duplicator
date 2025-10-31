#!/usr/bin/env node

/**
 * Shopify Store Duplicator CLI
 *
 * Commands:
 * - defs:dump - Dump definitions from source store
 * - defs:apply - Apply definitions to destination store
 * - defs:diff - Compare definitions
 * - data:dump - Dump data from source store
 * - data:apply - Apply data to destination store
 * - data:diff - Compare data
 * - data:drop - Delete data from destination store
 * - files:apply - Seed files to destination
 * - menus:dump/apply - Handle menus
 * - redirects:dump/apply - Handle redirects
 * - policies:dump/apply - Handle shop policies
 * - discounts:dump/apply - Handle discounts (automatic and code-based)
 */

import { Command } from "commander";
import dotenv from "dotenv";
import { readFile, writeFile } from "fs/promises";
import { createInterface } from "readline";
import {
  createGraphQLClient,
  dumpDefinitions,
  applyDefinitions,
  diffDefinitions,
  dumpAllData,
  dumpMetaobjects,
  dumpProducts,
  dumpCollections,
  dumpPages,
  dumpBlogs,
  dumpArticles,
  applyAllData,
  applyPages,
  applyBlogs,
  applyArticles,
  diffData,
  buildDestinationIndex,
  applyFiles,
  dropFiles,
  dumpMenus,
  applyMenus,
  dumpRedirects,
  applyRedirects,
  dumpPolicies,
  applyPolicies,
  dumpDiscounts,
  applyDiscounts,
  logger,
  type GraphQLClientConfig,
} from "@shopify-duplicator/core";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load environment variables from the workspace root
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const workspaceRoot = resolve(__dirname, "../../../");
dotenv.config({ path: resolve(workspaceRoot, ".env") });

/**
 * Helper to resolve paths relative to workspace root
 */
function resolveWorkspacePath(path: string): string {
  // If absolute path, use as-is
  if (resolve(path) === path) {
    return path;
  }
  // Otherwise, resolve relative to workspace root
  return resolve(workspaceRoot, path);
}

/**
 * Format statistics as a readable table
 */
function formatStatsTable(
  title: string,
  stats: {
    total?: number;
    created?: number;
    updated?: number;
    failed?: number;
    uploaded?: number;
    deleted?: number;
    skipped?: number;
    automaticManagement?: number;
  }
): string {
  const lines: string[] = [];
  lines.push(`\n${title}:`);
  lines.push("─".repeat(40));

  if (stats.total !== undefined)
    lines.push(`  Total:    ${stats.total.toString().padStart(6)}`);
  if (stats.created !== undefined)
    lines.push(`  Created:  ${stats.created.toString().padStart(6)}`);
  if (stats.updated !== undefined)
    lines.push(`  Updated:  ${stats.updated.toString().padStart(6)}`);
  if (stats.uploaded !== undefined)
    lines.push(`  Uploaded: ${stats.uploaded.toString().padStart(6)}`);
  if (stats.deleted !== undefined)
    lines.push(`  Deleted:  ${stats.deleted.toString().padStart(6)}`);
  if (stats.skipped !== undefined)
    lines.push(`  Skipped:  ${stats.skipped.toString().padStart(6)}`);
  if (stats.automaticManagement !== undefined)
    lines.push(
      `  Auto Mgmt: ${stats.automaticManagement.toString().padStart(5)}`
    );
  if (stats.failed !== undefined)
    lines.push(`  Failed:   ${stats.failed.toString().padStart(6)}`);

  return lines.join("\n");
}

/**
 * Prompt user for confirmation by typing a word
 */
async function promptConfirmation(confirmWord: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`Type '${confirmWord}' to confirm: `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === confirmWord.toLowerCase());
    });
  });
}

const program = new Command();

program
  .name("shopify-duplicator")
  .description("Duplicate Shopify store custom data and content")
  .version("1.0.0");

/**
 * Global options for all commands
 */
program
  .option(
    "--src-shop <domain>",
    "Source shop domain",
    process.env.SRC_SHOP_DOMAIN
  )
  .option(
    "--src-token <token>",
    "Source admin token",
    process.env.SRC_ADMIN_TOKEN
  )
  .option(
    "--dst-shop <domain>",
    "Destination shop domain",
    process.env.DST_SHOP_DOMAIN
  )
  .option(
    "--dst-token <token>",
    "Destination admin token",
    process.env.DST_ADMIN_TOKEN
  )
  .option(
    "--api-version <version>",
    "Shopify API version",
    process.env.SHOPIFY_API_VERSION || "2025-10"
  )
  .option("--dry-run", "Preview changes without applying", false)
  .option("--verbose", "Enable debug logging", false);

/**
 * DEFINITIONS COMMANDS
 */

// defs:dump - Dump definitions from source
program
  .command("defs:dump")
  .description("Dump metaobject and metafield definitions from source store")
  .option("-o, --output <file>", "Output file", "./dumps/definitions.json")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.srcShop || !globalOpts.srcToken) {
      logger.error(
        "Missing source shop credentials. Set SRC_SHOP_DOMAIN and SRC_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.srcShop,
      accessToken: globalOpts.srcToken,
      apiVersion: globalOpts.apiVersion,
    });

    logger.info("Dumping definitions from source store");
    const result = await dumpDefinitions(client);

    if (!result.ok) {
      logger.error("Failed to dump definitions", {
        error: result.error.message,
      });
      process.exit(1);
    }

    const json = JSON.stringify(result.data, null, 2);

    const outputPath = resolveWorkspacePath(options.output);

    // Ensure directory exists
    const { mkdir } = await import("fs/promises");
    await mkdir(dirname(outputPath), { recursive: true });

    await writeFile(outputPath, json, "utf-8");
    logger.info(`Definitions saved to ${outputPath}`);
  });

// defs:apply - Apply definitions to destination
program
  .command("defs:apply")
  .description(
    "Apply metaobject and metafield definitions to destination store"
  )
  .option("-f, --file <file>", "Input file", "./dumps/definitions.json")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.dstShop || !globalOpts.dstToken) {
      logger.error(
        "Missing destination shop credentials. Set DST_SHOP_DOMAIN and DST_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    // Read definitions
    const filePath = resolveWorkspacePath(options.file);
    const defsJson = await readFile(filePath, "utf-8");
    const defs = JSON.parse(defsJson);

    const client = createGraphQLClient({
      shop: globalOpts.dstShop,
      accessToken: globalOpts.dstToken,
      apiVersion: globalOpts.apiVersion,
    });

    if (globalOpts.dryRun) {
      logger.info("[DRY RUN] Would apply definitions:", {
        metaobjectDefinitions: defs.metaobjectDefinitions?.length || 0,
        metafieldDefinitions: defs.metafieldDefinitions?.length || 0,
      });
      return;
    }

    logger.info("Applying definitions to destination store");
    const result = await applyDefinitions(client, defs);

    if (!result.ok) {
      logger.error("Failed to apply definitions", {
        error: result.error.message,
      });
      process.exit(1);
    }

    logger.info("Definitions applied successfully", result.data);

    // Report errors
    if (result.data.metaobjects.errors.length > 0) {
      logger.warn(
        "Metaobject definition errors:",
        result.data.metaobjects.errors
      );
    }
    if (result.data.metafields.errors.length > 0) {
      logger.warn(
        "Metafield definition errors:",
        result.data.metafields.errors
      );
    }

    const totalFailed =
      result.data.metaobjects.failed + result.data.metafields.failed;
    if (totalFailed > 0) {
      process.exit(1);
    }
  });

/**
 * DATA COMMANDS
 */

program
  .command("data:dump")
  .description("Dump metaobjects, metafields, and CMS content from source")
  .option("-o, --output <dir>", "Output directory", "./dumps")
  .option("--metaobjects-only", "Dump only metaobjects", false)
  .option("--products-only", "Dump only products", false)
  .option("--collections-only", "Dump only collections", false)
  .option("--pages-only", "Dump only pages", false)
  .option("--blogs-only", "Dump only blogs", false)
  .option("--articles-only", "Dump only articles", false)
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.srcShop || !globalOpts.srcToken) {
      logger.error(
        "Missing source shop credentials. Set SRC_SHOP_DOMAIN and SRC_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.srcShop,
      accessToken: globalOpts.srcToken,
      apiVersion: globalOpts.apiVersion,
    });

    const outputDir = resolveWorkspacePath(options.output);
    logger.info(`Dumping data from source store to ${outputDir}`);

    let result;

    // Selective dump based on flags
    if (options.metaobjectsOnly) {
      result = await dumpMetaobjects(client, outputDir);
    } else if (options.productsOnly) {
      result = await dumpProducts(client, outputDir);
    } else if (options.collectionsOnly) {
      result = await dumpCollections(client, outputDir);
    } else if (options.pagesOnly) {
      result = await dumpPages(client, outputDir);
    } else if (options.blogsOnly) {
      result = await dumpBlogs(client, outputDir);
    } else if (options.articlesOnly) {
      result = await dumpArticles(client, outputDir);
    } else {
      // Dump everything
      result = await dumpAllData(client, outputDir);
    }

    if (!result.ok) {
      logger.error("Data dump failed", { error: result.error.message });
      process.exit(1);
    }

    logger.info("✓ Data dump complete");
  });

program
  .command("data:apply")
  .description("Apply data to destination store")
  .option("-i, --input <dir>", "Input directory", "./dumps")
  .option("--products-only", "Apply products only")
  .option("--collections-only", "Apply collections only")
  .option("--metaobjects-only", "Apply metaobjects only")
  .option("--pages-only", "Apply pages only")
  .option("--blogs-only", "Apply blogs only")
  .option("--articles-only", "Apply articles only")
  .option("--product-metafields-only", "Apply product metafields only")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.dstShop || !globalOpts.dstToken) {
      logger.error(
        "Missing destination shop credentials. Set DST_SHOP_DOMAIN and DST_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.dstShop,
      accessToken: globalOpts.dstToken,
      apiVersion: globalOpts.apiVersion,
    });

    const inputDir = resolveWorkspacePath(options.input);

    if (globalOpts.dryRun) {
      logger.info("[DRY RUN] Would apply data from:", { inputDir });
      return;
    }

    logger.info(`Applying data from ${inputDir} to destination store`);

    // Handle selective application for CMS content types
    if (options.pagesOnly || options.blogsOnly || options.articlesOnly) {
      // Build destination index first
      logger.info("Building destination index...");
      const index = await buildDestinationIndex(client);

      let result: any;

      if (options.pagesOnly) {
        const pagesFile = `${inputDir}/pages.jsonl`;
        result = await applyPages(client, pagesFile, index);

        if (!result.ok) {
          logger.error("Pages apply failed", { error: result.error.message });
          process.exit(1);
        }

        logger.info("\n=== Pages Apply Complete ===");
        console.log(formatStatsTable("Pages", result.data));

        if (result.data.errors.length > 0) {
          logger.warn("Page errors:", result.data.errors.slice(0, 10));
        }

        return;
      }

      if (options.blogsOnly) {
        const blogsFile = `${inputDir}/blogs.jsonl`;
        result = await applyBlogs(client, blogsFile, index);

        if (!result.ok) {
          logger.error("Blogs apply failed", { error: result.error.message });
          process.exit(1);
        }

        logger.info("\n=== Blogs Apply Complete ===");
        console.log(formatStatsTable("Blogs", result.data));

        if (result.data.errors.length > 0) {
          logger.warn("Blog errors:", result.data.errors.slice(0, 10));
        }

        return;
      }

      if (options.articlesOnly) {
        const articlesFile = `${inputDir}/articles.jsonl`;
        result = await applyArticles(client, articlesFile, index);

        if (!result.ok) {
          logger.error("Articles apply failed", {
            error: result.error.message,
          });
          process.exit(1);
        }

        logger.info("\n=== Articles Apply Complete ===");
        console.log(formatStatsTable("Articles", result.data));

        if (result.data.errors.length > 0) {
          logger.warn("Article errors:", result.data.errors.slice(0, 10));
        }

        return;
      }
    }

    // Full or partial application using applyAllData
    const result = await applyAllData(client, inputDir, {
      productsOnly: options.productsOnly,
      collectionsOnly: options.collectionsOnly,
      metaobjectsOnly: options.metaobjectsOnly,
      pagesOnly: options.pagesOnly,
      blogsOnly: options.blogsOnly,
      articlesOnly: options.articlesOnly,
      productMetafieldsOnly: options.productMetafieldsOnly,
    });

    if (!result.ok) {
      logger.error("Data apply failed", { error: result.error.message });
      process.exit(1);
    }

    const logData: any = {
      files: {
        uploaded: result.data.files.uploaded,
        failed: result.data.files.failed,
      },
      metaobjects: {
        total: result.data.metaobjects.total,
        created: result.data.metaobjects.created,
        failed: result.data.metaobjects.failed,
      },
    };

    if (result.data.products) {
      logData.products = {
        total: result.data.products.total,
        created: result.data.products.created,
        failed: result.data.products.failed,
      };
    }

    if (result.data.collections) {
      logData.collections = {
        total: result.data.collections.total,
        created: result.data.collections.created,
        failed: result.data.collections.failed,
      };
    }

    logData.blogs = {
      total: result.data.blogs.total,
      created: result.data.blogs.created,
      updated: result.data.blogs.updated,
      failed: result.data.blogs.failed,
    };

    logData.articles = {
      total: result.data.articles.total,
      created: result.data.articles.created,
      updated: result.data.articles.updated,
      failed: result.data.articles.failed,
    };

    logData.pages = {
      total: result.data.pages.total,
      created: result.data.pages.created,
      updated: result.data.pages.updated,
      failed: result.data.pages.failed,
    };

    logData.metafields = {
      total: result.data.metafields.total,
      created: result.data.metafields.created,
      failed: result.data.metafields.failed,
    };

    // Format and display summary as tables
    logger.info("\n=== Data Apply Complete ===");

    if (result.data.files.uploaded > 0 || result.data.files.failed > 0) {
      console.log(formatStatsTable("Files", result.data.files));
    }

    if (result.data.metaobjects.total > 0) {
      console.log(formatStatsTable("Metaobjects", result.data.metaobjects));
    }

    if (result.data.products && result.data.products.total > 0) {
      console.log(formatStatsTable("Products", result.data.products));
    }

    if (result.data.collections && result.data.collections.total > 0) {
      console.log(formatStatsTable("Collections", result.data.collections));
    }

    if (result.data.pages.total > 0) {
      console.log(formatStatsTable("Pages", result.data.pages));
    }

    if (result.data.blogs.total > 0) {
      console.log(formatStatsTable("Blogs", result.data.blogs));
    }

    if (result.data.articles.total > 0) {
      console.log(formatStatsTable("Articles", result.data.articles));
    }

    if (result.data.metafields.total > 0) {
      console.log(formatStatsTable("Metafields", result.data.metafields));
    }

    console.log("─".repeat(40) + "\n");

    // Report errors
    if (result.data.metaobjects.errors.length > 0) {
      logger.warn(
        "Metaobject errors:",
        result.data.metaobjects.errors.slice(0, 10)
      );
    }
    if (
      result.data.products?.errors &&
      result.data.products.errors.length > 0
    ) {
      logger.warn("Product errors:", result.data.products.errors.slice(0, 10));
    }
    if (
      result.data.collections?.errors &&
      result.data.collections.errors.length > 0
    ) {
      logger.warn(
        "Collection errors:",
        result.data.collections.errors.slice(0, 10)
      );
    }
    if (result.data.blogs.errors.length > 0) {
      logger.warn("Blog errors:", result.data.blogs.errors.slice(0, 10));
    }
    if (result.data.articles.errors.length > 0) {
      logger.warn("Article errors:", result.data.articles.errors.slice(0, 10));
    }
    if (result.data.pages.errors.length > 0) {
      logger.warn("Page errors:", result.data.pages.errors.slice(0, 10));
    }
    if (result.data.metafields.errors.length > 0) {
      logger.warn(
        "Metafield errors:",
        result.data.metafields.errors.slice(0, 10)
      );
    }

    const totalFailed =
      result.data.metaobjects.failed +
      (result.data.products?.failed || 0) +
      (result.data.collections?.failed || 0) +
      result.data.blogs.failed +
      result.data.articles.failed +
      result.data.pages.failed +
      result.data.metafields.failed;
    if (totalFailed > 0) {
      logger.warn(`${totalFailed} items failed to apply`);
      // Don't exit with error - partial success is acceptable
      // Individual errors are already logged with details
    }
  });

/**
 * FILES COMMANDS
 */

program.command("files:apply");

/**
 * FILES COMMANDS
 */

program
  .command("files:apply")
  .description("Seed files to destination store from dump")
  .option("-i, --input <file>", "Files JSONL file", "./dumps/files.jsonl")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.dstShop || !globalOpts.dstToken) {
      logger.error(
        "Missing destination shop credentials. Set DST_SHOP_DOMAIN and DST_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.dstShop,
      accessToken: globalOpts.dstToken,
      apiVersion: globalOpts.apiVersion,
    });

    if (globalOpts.dryRun) {
      logger.info("[DRY RUN] Would apply files from:", options.input);
      return;
    }

    logger.info(`Applying files from ${options.input}`);

    const result = await applyFiles(client, options.input);

    if (!result.ok) {
      logger.error("Files apply failed", { error: result.error.message });
      process.exit(1);
    }

    logger.info("✓ Files apply complete", {
      uploaded: result.data.urlToGid.size,
      mappings: result.data.gidToGid.size,
    });
  });

/**
 * DATA DROP COMMANDS
 */

program
  .command("data:drop")
  .description("Delete data from destination store (DESTRUCTIVE)")
  .option("--files-only", "Delete only files")
  .option("--products-only", "Delete only products (NOT YET IMPLEMENTED)")
  .option("--collections-only", "Delete only collections (NOT YET IMPLEMENTED)")
  .option("--metaobjects-only", "Delete only metaobjects (NOT YET IMPLEMENTED)")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.dstShop || !globalOpts.dstToken) {
      logger.error(
        "Missing destination shop credentials. Set DST_SHOP_DOMAIN and DST_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    // Check which data type to drop
    const shouldDropFiles = options.filesOnly;
    const shouldDropProducts = options.productsOnly;
    const shouldDropCollections = options.collectionsOnly;
    const shouldDropMetaobjects = options.metaobjectsOnly;

    // Require at least one flag
    if (
      !shouldDropFiles &&
      !shouldDropProducts &&
      !shouldDropCollections &&
      !shouldDropMetaobjects
    ) {
      logger.error("You must specify which data to drop:");
      logger.error("  --files-only         Delete all files");
      logger.error("  --products-only      Delete all products (coming soon)");
      logger.error(
        "  --collections-only   Delete all collections (coming soon)"
      );
      logger.error(
        "  --metaobjects-only   Delete all metaobjects (coming soon)"
      );
      logger.error("");
      logger.error("Example: npm run cli -- data:drop --files-only");
      process.exit(1);
    }

    // Warn user about destructive operation
    logger.warn(
      "⚠️  WARNING: This will PERMANENTLY DELETE data from your destination store!"
    );
    logger.warn("");
    if (shouldDropFiles) logger.warn("  - All files will be deleted");
    if (shouldDropProducts) logger.warn("  - All products will be deleted");
    if (shouldDropCollections)
      logger.warn("  - All collections will be deleted");
    if (shouldDropMetaobjects)
      logger.warn("  - All metaobjects will be deleted");
    logger.warn("");
    logger.warn(`Destination store: ${globalOpts.dstShop}`);
    logger.warn("");

    if (globalOpts.dryRun) {
      logger.info("[DRY RUN] Would delete the above data types");
      return;
    }

    // Interactive confirmation
    const confirmed = await promptConfirmation("delete");

    if (!confirmed) {
      logger.info("Aborted. No data was deleted.");
      process.exit(0);
    }

    const client = createGraphQLClient({
      shop: globalOpts.dstShop,
      accessToken: globalOpts.dstToken,
      apiVersion: globalOpts.apiVersion,
    });

    logger.info("");
    logger.info("Starting deletion...");

    // Drop files
    if (shouldDropFiles) {
      logger.info("=== Dropping Files ===");
      const result = await dropFiles(client);

      if (!result.ok) {
        logger.error("Failed to drop files", { error: result.error.message });
        process.exit(1);
      }

      console.log(
        formatStatsTable("Files Dropped", {
          total: result.data.total,
          deleted: result.data.deleted,
          failed: result.data.failed,
        })
      );
    }

    // Future: Drop products
    if (shouldDropProducts) {
      logger.warn("Product deletion not yet implemented");
    }

    // Future: Drop collections
    if (shouldDropCollections) {
      logger.warn("Collection deletion not yet implemented");
    }

    // Future: Drop metaobjects
    if (shouldDropMetaobjects) {
      logger.warn("Metaobject deletion not yet implemented");
    }

    logger.info("");
    logger.info("✓ Drop operation complete");
  });

/**
 * MENUS COMMANDS
 */

program
  .command("menus:dump")
  .description("Dump menus from source store")
  .option("-o, --output <file>", "Output file", "./dumps/menus.json")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.srcShop || !globalOpts.srcToken) {
      logger.error(
        "Missing source shop credentials. Set SRC_SHOP_DOMAIN and SRC_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.srcShop,
      accessToken: globalOpts.srcToken,
      apiVersion: globalOpts.apiVersion,
    });

    const outputPath = resolveWorkspacePath(options.output);
    logger.info(`Dumping menus to ${outputPath}`);

    const result = await dumpMenus(client, outputPath);

    if (!result.ok) {
      logger.error("Menus dump failed", { error: result.error.message });
      process.exit(1);
    }

    logger.info("✓ Menus dump complete");
  });

program
  .command("menus:apply")
  .description("Apply menus to destination store")
  .option("-f, --file <file>", "Input file", "./dumps/menus.json")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.dstShop || !globalOpts.dstToken) {
      logger.error(
        "Missing destination shop credentials. Set DST_SHOP_DOMAIN and DST_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.dstShop,
      accessToken: globalOpts.dstToken,
      apiVersion: globalOpts.apiVersion,
    });

    const filePath = resolveWorkspacePath(options.file);

    if (globalOpts.dryRun) {
      logger.info("[DRY RUN] Would apply menus from:", { filePath });
      return;
    }

    // Build index for URL remapping
    logger.info("Building destination index for menu URL remapping...");
    const index = await buildDestinationIndex(client);

    logger.info(`Applying menus from ${filePath}`);

    const result = await applyMenus(
      client,
      filePath,
      index,
      globalOpts.dstShop
    );

    if (!result.ok) {
      logger.error("Menus apply failed", { error: result.error.message });
      process.exit(1);
    }

    logger.info("✓ Menus apply complete", {
      total: result.data.total,
      created: result.data.created,
      updated: result.data.updated,
      failed: result.data.failed,
    });

    // Report errors
    if (result.data.errors.length > 0) {
      logger.warn("Menu errors:", result.data.errors.slice(0, 10));
    }

    if (result.data.failed > 0) {
      logger.warn(`${result.data.failed} menus failed to apply`);
      process.exit(1);
    }
  });

/**
 * REDIRECTS COMMANDS
 */

program
  .command("redirects:dump")
  .description("Dump redirects from source store")
  .option("-o, --output <file>", "Output file", "./dumps/redirects.json")
  .option(
    "--csv",
    "Export as CSV for manual import via Shopify Admin (faster for bulk imports)"
  )
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.srcShop || !globalOpts.srcToken) {
      logger.error(
        "Missing source shop credentials. Set SRC_SHOP_DOMAIN and SRC_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.srcShop,
      accessToken: globalOpts.srcToken,
      apiVersion: globalOpts.apiVersion,
    });

    let outputPath = resolveWorkspacePath(options.output);

    // If CSV flag is set, change extension if needed
    if (options.csv && !outputPath.endsWith(".csv")) {
      outputPath = outputPath.replace(/\.[^.]+$/, ".csv");
    }

    logger.info(`Dumping redirects to ${outputPath}`);

    const result = await dumpRedirects(client, outputPath, {
      csv: options.csv,
    });

    if (!result.ok) {
      logger.error("Redirects dump failed", { error: result.error.message });
      process.exit(1);
    }

    logger.info("✓ Redirects dump complete");
  });

program
  .command("redirects:apply")
  .description("Apply redirects to destination store")
  .option("-f, --file <file>", "Input file", "./dumps/redirects.json")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.dstShop || !globalOpts.dstToken) {
      logger.error(
        "Missing destination shop credentials. Set DST_SHOP_DOMAIN and DST_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.dstShop,
      accessToken: globalOpts.dstToken,
      apiVersion: globalOpts.apiVersion,
    });

    const filePath = resolveWorkspacePath(options.file);

    if (globalOpts.dryRun) {
      logger.info("[DRY RUN] Would apply redirects from:", { filePath });
      return;
    }

    logger.info(`Applying redirects from ${filePath}`);

    const result = await applyRedirects(client, filePath);

    if (!result.ok) {
      logger.error("Redirects apply failed", { error: result.error.message });
      process.exit(1);
    }

    logger.info("✓ Redirects apply complete", {
      created: result.data.created,
      skipped: result.data.skipped,
      failed: result.data.failed,
    });

    // Report errors
    if (result.data.errors.length > 0) {
      logger.warn("Redirect errors:", result.data.errors.slice(0, 10));
    }

    if (result.data.failed > 0) {
      logger.warn(`${result.data.failed} redirects failed to apply`);
      process.exit(1);
    }
  });

program
  .command("policies:dump")
  .description("Dump shop policies from source store")
  .option("-o, --output <file>", "Output file", "./dumps/policies.json")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.srcShop || !globalOpts.srcToken) {
      logger.error(
        "Missing source shop credentials. Set SRC_SHOP_DOMAIN and SRC_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.srcShop,
      accessToken: globalOpts.srcToken,
      apiVersion: globalOpts.apiVersion,
    });

    const outputPath = resolveWorkspacePath(options.output);

    logger.info(`Dumping policies to ${outputPath}`);

    const result = await dumpPolicies(client, outputPath);

    if (!result.ok) {
      logger.error("Policies dump failed", { error: result.error.message });
      process.exit(1);
    }

    logger.info("✓ Policies dump complete");
  });

program
  .command("policies:apply")
  .description("Apply shop policies to destination store")
  .option("-f, --file <file>", "Input file", "./dumps/policies.json")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.dstShop || !globalOpts.dstToken) {
      logger.error(
        "Missing destination shop credentials. Set DST_SHOP_DOMAIN and DST_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.dstShop,
      accessToken: globalOpts.dstToken,
      apiVersion: globalOpts.apiVersion,
    });

    const filePath = resolveWorkspacePath(options.file);

    if (globalOpts.dryRun) {
      logger.info("[DRY RUN] Would apply policies from:", { filePath });
      return;
    }

    logger.info(`Applying policies from ${filePath}`);

    const result = await applyPolicies(client, filePath);

    if (!result.ok) {
      logger.error("Policies apply failed", { error: result.error.message });
      process.exit(1);
    }

    // Format and display stats table
    console.log(
      formatStatsTable("Policies Apply Results", {
        updated: result.data.updated,
        skipped: result.data.skipped,
        automaticManagement: result.data.automaticManagement,
        failed: result.data.failed,
      })
    );

    // Report automatic management policies separately
    if (result.data.automaticManagement > 0) {
      const autoMgmtPolicies = result.data.errors
        .filter((e) => e.isAutomaticManagement)
        .map((e) => e.policy);
      logger.info(
        `\nNote: ${result.data.automaticManagement} policy/policies have automatic management enabled and were not updated:`
      );
      autoMgmtPolicies.forEach((policy) => {
        logger.info(`  - ${policy}`);
      });
      logger.info(
        "\nTo update these policies, disable automatic management in Shopify Admin → Settings → Policies"
      );
    }

    // Report actual errors (non-automatic management)
    const realErrors = result.data.errors.filter(
      (e) => !e.isAutomaticManagement
    );
    if (realErrors.length > 0) {
      logger.warn("\nPolicy errors:", realErrors);
    }

    // Only exit with error if there are real failures (not automatic management)
    if (result.data.failed > 0) {
      logger.error(`\n${result.data.failed} policies failed to apply`);
      process.exit(1);
    }

    logger.info("\n✓ Policies apply complete");
  });

/**
 * DISCOUNTS COMMANDS
 */

program
  .command("discounts:dump")
  .description("Dump discounts (automatic and code-based) from source store")
  .option("-o, --output <file>", "Output file", "./dumps/discounts.json")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.srcShop || !globalOpts.srcToken) {
      logger.error(
        "Missing source shop credentials. Set SRC_SHOP_DOMAIN and SRC_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.srcShop,
      accessToken: globalOpts.srcToken,
      apiVersion: globalOpts.apiVersion,
    });

    const outputPath = resolveWorkspacePath(options.output);

    logger.info(`Dumping discounts to ${outputPath}`);

    const result = await dumpDiscounts(client, outputPath);

    if (!result.ok) {
      logger.error("Discounts dump failed", { error: result.error.message });
      process.exit(1);
    }

    logger.info("✓ Discounts dump complete");
  });

program
  .command("discounts:apply")
  .description("Apply discounts to destination store")
  .option("-f, --file <file>", "Input file", "./dumps/discounts.json")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.dstShop || !globalOpts.dstToken) {
      logger.error(
        "Missing destination shop credentials. Set DST_SHOP_DOMAIN and DST_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.dstShop,
      accessToken: globalOpts.dstToken,
      apiVersion: globalOpts.apiVersion,
    });

    const filePath = resolveWorkspacePath(options.file);

    if (globalOpts.dryRun) {
      logger.info("[DRY RUN] Would apply discounts from:", { filePath });
      return;
    }

    logger.info(`Applying discounts from ${filePath}`);
    logger.info("Building destination index...");

    // Build destination index for product/collection/variant remapping
    const destinationIndex = await buildDestinationIndex(client);

    const result = await applyDiscounts(client, filePath, destinationIndex);

    if (!result.ok) {
      logger.error("Discounts apply failed", { error: result.error.message });
      process.exit(1);
    }

    // Format and display stats table
    console.log(
      formatStatsTable("Discounts Apply Results", {
        created: result.data.created,
        updated: result.data.updated,
        skipped: result.data.skipped,
        failed: result.data.failed,
      })
    );

    if (result.data.errors.length > 0) {
      logger.warn("\nDiscount errors:");
      result.data.errors.forEach((e) => {
        logger.warn(`  - ${e.title}: ${e.error}`);
      });
    }

    if (result.data.failed > 0) {
      logger.error(`\n${result.data.failed} discounts failed to apply`);
      process.exit(1);
    }

    logger.info("\n✓ Discounts apply complete");
  });

/**
 * DIFF COMMANDS
 */

program
  .command("defs:diff")
  .description("Compare source definitions dump with destination store")
  .option(
    "-f, --file <file>",
    "Source definitions file",
    "./dumps/definitions.json"
  )
  .option(
    "--no-usage-check",
    "Skip checking data dumps for reserved metafield usage (faster)"
  )
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.dstShop || !globalOpts.dstToken) {
      logger.error(
        "Missing destination shop credentials. Set DST_SHOP_DOMAIN and DST_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.dstShop,
      accessToken: globalOpts.dstToken,
      apiVersion: globalOpts.apiVersion,
    });

    // Resolve file path relative to workspace root
    const filePath = resolveWorkspacePath(options.file);
    const dumpsDir = resolveWorkspacePath("./dumps");

    logger.info(`Comparing definitions: ${filePath} vs destination store`);

    const result = await diffDefinitions(client, filePath, {
      checkDataUsage: options.usageCheck !== false, // Enabled by default, disabled with --no-usage-check
      dumpsDir,
    });

    if (!result.ok) {
      logger.error("Definitions diff failed", { error: result.error.message });
      process.exit(1);
    }

    const diff = result.data;

    // Display results
    logger.info("=== DEFINITIONS DIFF RESULTS ===");

    if (diff.summary.isIdentical) {
      logger.info("✓ Custom definitions are identical!");

      // Show reserved metafields even when identical
      if (diff.metafields.missingReserved.length > 0) {
        logger.info(
          `\nℹ️  Shopify-reserved metafield definitions (${diff.metafields.missingReserved.length}) - system-managed, cannot be created via API:`
        );
        diff.metafields.missingReserved
          .slice(0, 10)
          .forEach((triplet) => logger.info(`  - ${triplet}`));
        if (diff.metafields.missingReserved.length > 10) {
          logger.info(
            `  ... and ${diff.metafields.missingReserved.length - 10} more`
          );
        }
        logger.info(
          `  Note: These are automatically available in Shopify stores when needed.`
        );

        // Show usage information if available
        if (diff.reservedUsage) {
          const totalUsing =
            diff.reservedUsage.productsUsingReserved.length +
            diff.reservedUsage.collectionsUsingReserved.length;

          if (totalUsing > 0) {
            logger.warn(
              `\n⚠️  Warning: ${totalUsing} resources are using reserved metafields:`
            );

            if (diff.reservedUsage.productsUsingReserved.length > 0) {
              logger.warn(
                `  - ${diff.reservedUsage.productsUsingReserved.length} products:`
              );
              diff.reservedUsage.productsUsingReserved
                .slice(0, 5)
                .forEach(({ handle, metafields }) =>
                  logger.warn(`      ${handle} (${metafields.join(", ")})`)
                );
              if (diff.reservedUsage.productsUsingReserved.length > 5) {
                logger.warn(
                  `      ... and ${
                    diff.reservedUsage.productsUsingReserved.length - 5
                  } more`
                );
              }
            }

            if (diff.reservedUsage.collectionsUsingReserved.length > 0) {
              logger.warn(
                `  - ${diff.reservedUsage.collectionsUsingReserved.length} collections:`
              );
              diff.reservedUsage.collectionsUsingReserved
                .slice(0, 5)
                .forEach(({ handle, metafields }) =>
                  logger.warn(`      ${handle} (${metafields.join(", ")})`)
                );
              if (diff.reservedUsage.collectionsUsingReserved.length > 5) {
                logger.warn(
                  `      ... and ${
                    diff.reservedUsage.collectionsUsingReserved.length - 5
                  } more`
                );
              }
            }

            logger.warn(
              `  These metafields should still work when applying data (Shopify manages them).`
            );
          } else {
            logger.info(
              `  ✓ No products or collections are using these reserved metafields.`
            );
          }
        }
      }
    } else {
      if (diff.summary.totalActionable > 0) {
        logger.warn(
          `Found ${diff.summary.totalActionable} actionable differences`
        );
      } else {
        logger.info("✓ Custom definitions are identical!");
      }

      // Metaobject differences
      if (diff.metaobjects.missing.length > 0) {
        logger.warn(
          `\n❌ Missing metaobject types (${diff.metaobjects.missing.length}):`
        );
        diff.metaobjects.missing.forEach((type) => logger.warn(`  - ${type}`));
      }

      if (diff.metaobjects.extra.length > 0) {
        logger.warn(
          `\n➕ Extra metaobject types (${diff.metaobjects.extra.length}):`
        );
        diff.metaobjects.extra.forEach((type) => logger.warn(`  - ${type}`));
      }

      if (diff.metaobjects.changed.length > 0) {
        logger.warn(
          `\n⚠️  Changed metaobject types (${diff.metaobjects.changed.length}):`
        );
        diff.metaobjects.changed.forEach(({ type, changes }) => {
          logger.warn(`  - ${type}:`);
          changes.forEach((change) => logger.warn(`      ${change}`));
        });
      }

      // Metafield differences (custom namespaces only)
      if (diff.metafields.missing.length > 0) {
        logger.warn(
          `\n❌ Missing metafield definitions (${diff.metafields.missing.length}):`
        );
        diff.metafields.missing
          .slice(0, 20)
          .forEach((triplet) => logger.warn(`  - ${triplet}`));
        if (diff.metafields.missing.length > 20) {
          logger.warn(`  ... and ${diff.metafields.missing.length - 20} more`);
        }
      }

      if (diff.metafields.extra.length > 0) {
        logger.warn(
          `\n➕ Extra metafield definitions (${diff.metafields.extra.length}):`
        );
        diff.metafields.extra
          .slice(0, 20)
          .forEach((triplet) => logger.warn(`  - ${triplet}`));
        if (diff.metafields.extra.length > 20) {
          logger.warn(`  ... and ${diff.metafields.extra.length - 20} more`);
        }
      }

      if (diff.metafields.changed.length > 0) {
        logger.warn(
          `\n⚠️  Changed metafield definitions (${diff.metafields.changed.length}):`
        );
        diff.metafields.changed.slice(0, 10).forEach(({ triplet, changes }) => {
          logger.warn(`  - ${triplet}:`);
          changes.forEach((change) => logger.warn(`      ${change}`));
        });
        if (diff.metafields.changed.length > 10) {
          logger.warn(`  ... and ${diff.metafields.changed.length - 10} more`);
        }
      }

      // Shopify-reserved metafield definitions (informational only)
      if (diff.metafields.missingReserved.length > 0) {
        logger.info(
          `\nℹ️  Shopify-reserved metafield definitions (${diff.metafields.missingReserved.length}) - system-managed, cannot be created via API:`
        );
        diff.metafields.missingReserved
          .slice(0, 10)
          .forEach((triplet) => logger.info(`  - ${triplet}`));
        if (diff.metafields.missingReserved.length > 10) {
          logger.info(
            `  ... and ${diff.metafields.missingReserved.length - 10} more`
          );
        }
        logger.info(
          `  Note: These are automatically available in Shopify stores when needed.`
        );
      }

      if (diff.summary.totalActionable > 0) {
        process.exit(1);
      }
    }
  });

program
  .command("data:diff")
  .description("Compare source data dump with destination store")
  .option("-d, --dir <directory>", "Dump directory", "./dumps")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    if (!globalOpts.dstShop || !globalOpts.dstToken) {
      logger.error(
        "Missing destination shop credentials. Set DST_SHOP_DOMAIN and DST_ADMIN_TOKEN."
      );
      process.exit(1);
    }

    const client = createGraphQLClient({
      shop: globalOpts.dstShop,
      accessToken: globalOpts.dstToken,
      apiVersion: globalOpts.apiVersion,
    });

    logger.info(`Comparing data: ${options.dir} vs destination store`);

    const result = await diffData(client, options.dir);

    if (!result.ok) {
      logger.error("Data diff failed", { error: result.error.message });
      process.exit(1);
    }

    const diff = result.data;

    // Display results
    logger.info("=== DATA DIFF RESULTS ===");

    if (diff.summary.isIdentical) {
      logger.info("✓ Data is identical!");
    } else {
      logger.warn(
        `Found ${diff.summary.totalMissing} missing, ${diff.summary.totalExtra} extra`
      );

      // Metaobjects by type
      const metaobjectTypes = Object.keys(diff.metaobjects);
      if (metaobjectTypes.length > 0) {
        logger.info("\n📦 Metaobjects:");
        metaobjectTypes.forEach((type) => {
          const typeDiff = diff.metaobjects[type];
          if (typeDiff.missing.length > 0 || typeDiff.extra.length > 0) {
            logger.warn(`  ${type}:`);
            if (typeDiff.missing.length > 0) {
              logger.warn(`    ❌ Missing: ${typeDiff.missing.length} handles`);
              typeDiff.missing
                .slice(0, 5)
                .forEach((h) => logger.warn(`       - ${h}`));
              if (typeDiff.missing.length > 5) {
                logger.warn(
                  `       ... and ${typeDiff.missing.length - 5} more`
                );
              }
            }
            if (typeDiff.extra.length > 0) {
              logger.warn(`    ➕ Extra: ${typeDiff.extra.length} handles`);
            }
          }
        });
      }

      // Products
      if (diff.products.missing.length > 0 || diff.products.extra.length > 0) {
        logger.info("\n🛍️  Products:");
        if (diff.products.missing.length > 0) {
          logger.warn(`  ❌ Missing: ${diff.products.missing.length} products`);
          diff.products.missing
            .slice(0, 10)
            .forEach((h) => logger.warn(`     - ${h}`));
          if (diff.products.missing.length > 10) {
            logger.warn(
              `     ... and ${diff.products.missing.length - 10} more`
            );
          }
        }
        if (diff.products.extra.length > 0) {
          logger.warn(`  ➕ Extra: ${diff.products.extra.length} products`);
        }
      }

      // Collections
      if (
        diff.collections.missing.length > 0 ||
        diff.collections.extra.length > 0
      ) {
        logger.info("\n📚 Collections:");
        if (diff.collections.missing.length > 0) {
          logger.warn(
            `  ❌ Missing: ${diff.collections.missing.length} collections`
          );
          diff.collections.missing
            .slice(0, 10)
            .forEach((h) => logger.warn(`     - ${h}`));
          if (diff.collections.missing.length > 10) {
            logger.warn(
              `     ... and ${diff.collections.missing.length - 10} more`
            );
          }
        }
        if (diff.collections.extra.length > 0) {
          logger.warn(
            `  ➕ Extra: ${diff.collections.extra.length} collections`
          );
        }
      }

      // Pages
      if (diff.pages.missing.length > 0 || diff.pages.extra.length > 0) {
        logger.info("\n📄 Pages:");
        if (diff.pages.missing.length > 0) {
          logger.warn(`  ❌ Missing: ${diff.pages.missing.length} pages`);
          diff.pages.missing
            .slice(0, 10)
            .forEach((h) => logger.warn(`     - ${h}`));
          if (diff.pages.missing.length > 10) {
            logger.warn(`     ... and ${diff.pages.missing.length - 10} more`);
          }
        }
        if (diff.pages.extra.length > 0) {
          logger.warn(`  ➕ Extra: ${diff.pages.extra.length} pages`);
        }
      }

      process.exit(1);
    }
  });

// Parse and execute
program.parse();
