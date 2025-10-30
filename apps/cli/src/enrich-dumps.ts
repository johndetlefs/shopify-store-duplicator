#!/usr/bin/env tsx

/**
 * Standalone script to enrich existing dumps with reference natural keys
 * Usage: tsx apps/cli/src/enrich-dumps.ts [dumpDir]
 *    or: npm run cli -- enrich-dumps [dumpDir] (after adding to package.json scripts)
 */

import { enrichAllReferences, logger } from "@shopify-duplicator/core";
import type { Result } from "@shopify-duplicator/core";

const dumpDir = process.argv[2] || "./dumps";

logger.info(`Enriching dumps in: ${dumpDir}`);

enrichAllReferences(dumpDir)
  .then((result: Result<void>) => {
    if (result.ok) {
      logger.info("✓ Enrichment complete!");
      process.exit(0);
    } else {
      logger.error("✗ Enrichment failed:", result.error);
      process.exit(1);
    }
  })
  .catch((error: unknown) => {
    logger.error("✗ Fatal error:", { error: String(error) });
    process.exit(1);
  });
