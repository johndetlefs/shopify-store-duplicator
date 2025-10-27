/**
 * Definitions Diff
 *
 * Compare metaobject and metafield definitions between source dump and destination store.
 *
 * Purpose:
 * - Validate that definitions were applied correctly
 * - Detect drift between source and destination
 * - Identify missing or extra definitions
 *
 * Use Cases:
 * - Post-migration validation
 * - Pre-apply dry-run checks
 * - Ongoing synchronization monitoring
 */

import * as fs from "node:fs";
import { GraphQLClient } from "../graphql/client.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";
import {
  dumpMetaobjectDefinitions,
  dumpMetafieldDefinitions,
  type DefinitionsDump,
  type MetaobjectDefinition,
  type MetafieldDefinition,
} from "./dump.js";

export interface DefinitionDiffResult {
  metaobjects: {
    missing: string[]; // Types missing in destination
    extra: string[]; // Types in destination but not in source
    changed: Array<{ type: string; changes: string[] }>; // Types with differences
  };
  metafields: {
    missing: string[]; // Triplets missing in destination
    extra: string[]; // Triplets in destination but not in source
    changed: Array<{ triplet: string; changes: string[] }>; // Definitions with differences
  };
  summary: {
    totalIssues: number;
    isIdentical: boolean;
  };
}

/**
 * Compare definitions from a dump file with live destination store
 */
export async function diffDefinitions(
  destinationClient: GraphQLClient,
  sourceDumpFile: string
): Promise<Result<DefinitionDiffResult>> {
  logger.info("Starting definitions diff...");

  try {
    // Read source dump
    if (!fs.existsSync(sourceDumpFile)) {
      return err(new Error(`Source dump file not found: ${sourceDumpFile}`));
    }

    const dumpContent = fs.readFileSync(sourceDumpFile, "utf-8");
    const sourceDump: DefinitionsDump = JSON.parse(dumpContent);

    logger.info(
      `Source dump: ${sourceDump.metaobjectDefinitions.length} metaobject types, ${sourceDump.metafieldDefinitions.length} metafield definitions`
    );

    // Query destination definitions
    logger.info("Querying destination store definitions...");
    const destMetaobjectsResult = await dumpMetaobjectDefinitions(
      destinationClient
    );
    if (!destMetaobjectsResult.ok) {
      return err(destMetaobjectsResult.error);
    }

    const destMetafieldsResult = await dumpMetafieldDefinitions(
      destinationClient
    );
    if (!destMetafieldsResult.ok) {
      return err(destMetafieldsResult.error);
    }

    logger.info(
      `Destination: ${destMetaobjectsResult.data.length} metaobject types, ${destMetafieldsResult.data.length} metafield definitions`
    );

    // Compare metaobject definitions
    const metaobjectDiff = compareMetaobjectDefinitions(
      sourceDump.metaobjectDefinitions,
      destMetaobjectsResult.data
    );

    // Compare metafield definitions
    const metafieldDiff = compareMetafieldDefinitions(
      sourceDump.metafieldDefinitions,
      destMetafieldsResult.data
    );

    const totalIssues =
      metaobjectDiff.missing.length +
      metaobjectDiff.extra.length +
      metaobjectDiff.changed.length +
      metafieldDiff.missing.length +
      metafieldDiff.extra.length +
      metafieldDiff.changed.length;

    const result: DefinitionDiffResult = {
      metaobjects: metaobjectDiff,
      metafields: metafieldDiff,
      summary: {
        totalIssues,
        isIdentical: totalIssues === 0,
      },
    };

    logger.info("Definitions diff complete", {
      totalIssues,
      isIdentical: result.summary.isIdentical,
    });

    return ok(result);
  } catch (error) {
    logger.error("Error during definitions diff", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Compare metaobject definitions by type
 */
function compareMetaobjectDefinitions(
  source: MetaobjectDefinition[],
  destination: MetaobjectDefinition[]
): {
  missing: string[];
  extra: string[];
  changed: Array<{ type: string; changes: string[] }>;
} {
  const sourceByType = new Map(source.map((def) => [def.type, def]));
  const destByType = new Map(destination.map((def) => [def.type, def]));

  const missing: string[] = [];
  const extra: string[] = [];
  const changed: Array<{ type: string; changes: string[] }> = [];

  // Find missing (in source but not in destination)
  for (const type of sourceByType.keys()) {
    if (!destByType.has(type)) {
      missing.push(type);
    }
  }

  // Find extra (in destination but not in source)
  for (const type of destByType.keys()) {
    if (!sourceByType.has(type)) {
      extra.push(type);
    }
  }

  // Find changed (in both but different)
  for (const type of sourceByType.keys()) {
    const sourceDef = sourceByType.get(type)!;
    const destDef = destByType.get(type);

    if (destDef) {
      const changes = compareMetaobjectDefinition(sourceDef, destDef);
      if (changes.length > 0) {
        changed.push({ type, changes });
      }
    }
  }

  return { missing, extra, changed };
}

/**
 * Compare a single metaobject definition
 */
function compareMetaobjectDefinition(
  source: MetaobjectDefinition,
  dest: MetaobjectDefinition
): string[] {
  const changes: string[] = [];

  if (source.name !== dest.name) {
    changes.push(`name: "${source.name}" → "${dest.name}"`);
  }

  if (source.description !== dest.description) {
    changes.push(
      `description: "${source.description || ""}" → "${dest.description || ""}"`
    );
  }

  // Compare field definitions
  const sourceFields = new Map(source.fieldDefinitions.map((f) => [f.key, f]));
  const destFields = new Map(dest.fieldDefinitions.map((f) => [f.key, f]));

  for (const key of sourceFields.keys()) {
    if (!destFields.has(key)) {
      changes.push(`missing field: ${key}`);
    } else {
      const srcField = sourceFields.get(key)!;
      const dstField = destFields.get(key)!;

      if (srcField.type.name !== dstField.type.name) {
        changes.push(
          `field ${key} type: ${srcField.type.name} → ${dstField.type.name}`
        );
      }

      if (srcField.required !== dstField.required) {
        changes.push(
          `field ${key} required: ${srcField.required} → ${dstField.required}`
        );
      }
    }
  }

  for (const key of destFields.keys()) {
    if (!sourceFields.has(key)) {
      changes.push(`extra field: ${key}`);
    }
  }

  return changes;
}

/**
 * Compare metafield definitions by triplet (ownerType/namespace/key)
 */
function compareMetafieldDefinitions(
  source: MetafieldDefinition[],
  destination: MetafieldDefinition[]
): {
  missing: string[];
  extra: string[];
  changed: Array<{ triplet: string; changes: string[] }>;
} {
  const getTriplet = (def: MetafieldDefinition) =>
    `${def.ownerType}/${def.namespace}/${def.key}`;

  const sourceByTriplet = new Map(source.map((def) => [getTriplet(def), def]));
  const destByTriplet = new Map(
    destination.map((def) => [getTriplet(def), def])
  );

  const missing: string[] = [];
  const extra: string[] = [];
  const changed: Array<{ triplet: string; changes: string[] }> = [];

  // Find missing
  for (const triplet of sourceByTriplet.keys()) {
    if (!destByTriplet.has(triplet)) {
      missing.push(triplet);
    }
  }

  // Find extra
  for (const triplet of destByTriplet.keys()) {
    if (!sourceByTriplet.has(triplet)) {
      extra.push(triplet);
    }
  }

  // Find changed
  for (const triplet of sourceByTriplet.keys()) {
    const sourceDef = sourceByTriplet.get(triplet)!;
    const destDef = destByTriplet.get(triplet);

    if (destDef) {
      const changes = compareMetafieldDefinition(sourceDef, destDef);
      if (changes.length > 0) {
        changed.push({ triplet, changes });
      }
    }
  }

  return { missing, extra, changed };
}

/**
 * Compare a single metafield definition
 */
function compareMetafieldDefinition(
  source: MetafieldDefinition,
  dest: MetafieldDefinition
): string[] {
  const changes: string[] = [];

  if (source.name !== dest.name) {
    changes.push(`name: "${source.name}" → "${dest.name}"`);
  }

  if (source.type.name !== dest.type.name) {
    changes.push(`type: ${source.type.name} → ${dest.type.name}`);
  }

  if (source.description !== dest.description) {
    changes.push(
      `description: "${source.description || ""}" → "${dest.description || ""}"`
    );
  }

  return changes;
}
