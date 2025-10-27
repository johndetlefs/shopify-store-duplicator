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
 * DATA COMMANDS (Stubs for now - to be implemented)
 */

program
  .command("data:dump")
  .description("Dump metaobjects, metafields, and CMS content from source")
  .option("-o, --output <dir>", "Output directory", "./dumps")
  .action(async (options) => {
    logger.warn("data:dump not yet implemented");
    process.exit(1);
  });

program
  .command("data:apply")
  .description("Apply data to destination store")
  .option("-i, --input <dir>", "Input directory", "./dumps")
  .action(async (options) => {
    logger.warn("data:apply not yet implemented");
    process.exit(1);
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
  .option("-o, --output <file>", "Output file")
  .action(async (options) => {
    logger.warn("menus:dump not yet implemented");
    process.exit(1);
  });

program
  .command("menus:apply")
  .description("Apply menus to destination store")
  .option("-f, --file <file>", "Input file")
  .action(async (options) => {
    logger.warn("menus:apply not yet implemented");
    process.exit(1);
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
