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
 * - files:apply - Seed files to destination
 * - menus:dump/apply - Handle menus
 * - redirects:dump/apply - Handle redirects
 */

import { Command } from "commander";
import dotenv from "dotenv";
import { readFile, writeFile } from "fs/promises";
import {
  createGraphQLClient,
  dumpDefinitions,
  applyDefinitions,
  dumpAllData,
  dumpMetaobjects,
  dumpProducts,
  dumpCollections,
  dumpPages,
  applyAllData,
  applyMetaobjects,
  applyProductMetafields,
  applyCollectionMetafields,
  applyPageMetafields,
  buildDestinationIndex,
  dumpMenus,
  applyMenus,
  logger,
  type GraphQLClientConfig,
} from "@shopify-duplicator/core";

// Load environment variables
dotenv.config();

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
  .option("-o, --output <file>", "Output file (default: stdout)")
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

    if (options.output) {
      await writeFile(options.output, json, "utf-8");
      logger.info(`Definitions saved to ${options.output}`);
    } else {
      console.log(json);
    }
  });

// defs:apply - Apply definitions to destination
program
  .command("defs:apply")
  .description(
    "Apply metaobject and metafield definitions to destination store"
  )
  .option("-f, --file <file>", "Input file (default: stdin)")
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
    let defsJson: string;
    if (options.file) {
      defsJson = await readFile(options.file, "utf-8");
    } else {
      // Read from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      defsJson = Buffer.concat(chunks).toString("utf-8");
    }

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

// defs:diff - Compare definitions
program
  .command("defs:diff")
  .description("Compare source definitions with destination store")
  .option("-f, --file <file>", "Source definitions file")
  .action(async (options) => {
    const globalOpts = program.opts();

    if (globalOpts.verbose) {
      process.env.LOG_LEVEL = "debug";
    }

    logger.warn("defs:diff not yet implemented");
    process.exit(1);
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

    logger.info(`Dumping data from source store to ${options.output}`);

    let result;

    // Selective dump based on flags
    if (options.metaobjectsOnly) {
      result = await dumpMetaobjects(client, options.output);
    } else if (options.productsOnly) {
      result = await dumpProducts(client, options.output);
    } else if (options.collectionsOnly) {
      result = await dumpCollections(client, options.output);
    } else if (options.pagesOnly) {
      result = await dumpPages(client, options.output);
    } else {
      // Dump everything
      result = await dumpAllData(client, options.output);
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
      logger.info("[DRY RUN] Would apply data from:", options.input);
      return;
    }

    logger.info(`Applying data from ${options.input} to destination store`);

    const result = await applyAllData(client, options.input);

    if (!result.ok) {
      logger.error("Data apply failed", { error: result.error.message });
      process.exit(1);
    }

    logger.info("✓ Data apply complete", {
      metaobjects: {
        total: result.data.metaobjects.total,
        created: result.data.metaobjects.created,
        failed: result.data.metaobjects.failed,
      },
      pages: {
        total: result.data.pages.total,
        created: result.data.pages.created,
        updated: result.data.pages.updated,
        failed: result.data.pages.failed,
      },
      metafields: {
        total: result.data.metafields.total,
        created: result.data.metafields.created,
        failed: result.data.metafields.failed,
      },
    });

    // Report errors
    if (result.data.metaobjects.errors.length > 0) {
      logger.warn(
        "Metaobject errors:",
        result.data.metaobjects.errors.slice(0, 10)
      );
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
      result.data.pages.failed +
      result.data.metafields.failed;
    if (totalFailed > 0) {
      logger.warn(`${totalFailed} items failed to apply`);
      process.exit(1);
    }
  });

program
  .command("data:diff")
  .description("Compare source data with destination")
  .option("-i, --input <dir>", "Input directory", "./dumps")
  .action(async (options) => {
    logger.warn("data:diff not yet implemented");
    process.exit(1);
  });

/**
 * FILES COMMANDS
 */

program
  .command("files:apply")
  .description("Seed files to destination store")
  .option("-i, --input <file>", "Files manifest JSON")
  .action(async (options) => {
    logger.warn("files:apply not yet implemented");
    process.exit(1);
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

    logger.info(`Dumping menus to ${options.output}`);

    const result = await dumpMenus(client, options.output);

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

    if (globalOpts.dryRun) {
      logger.info("[DRY RUN] Would apply menus from:", options.file);
      return;
    }

    // Build index for URL remapping
    logger.info("Building destination index for menu URL remapping...");
    const index = await buildDestinationIndex(client);

    logger.info(`Applying menus from ${options.file}`);

    const result = await applyMenus(
      client,
      options.file,
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
  .option("-o, --output <file>", "Output file")
  .action(async (options) => {
    logger.warn("redirects:dump not yet implemented");
    process.exit(1);
  });

program
  .command("redirects:apply")
  .description("Apply redirects to destination store")
  .option("-f, --file <file>", "Input file")
  .action(async (options) => {
    logger.warn("redirects:apply not yet implemented");
    process.exit(1);
  });

// Parse and execute
program.parse();
