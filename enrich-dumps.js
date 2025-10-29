#!/usr/bin/env node

/**
 * Standalone script to enrich existing dumps with reference natural keys
 */

import { enrichAllReferences } from "./packages/core/dist/migration/enrich-references.js";
import { logger } from "./packages/core/dist/utils/logger.js";

const dumpDir = process.argv[2] || "./dumps";

logger.info(`Enriching dumps in: ${dumpDir}`);

enrichAllReferences(dumpDir)
  .then((result) => {
    if (result.ok) {
      logger.info("✓ Enrichment complete!");
      process.exit(0);
    } else {
      logger.error("✗ Enrichment failed:", result.error);
      process.exit(1);
    }
  })
  .catch((error) => {
    logger.error("✗ Fatal error:", error);
    process.exit(1);
  });
