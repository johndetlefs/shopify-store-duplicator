/**
 * Data apply operations: import metaobjects, metafields, and CMS content to destination.
 *
 * Purpose:
 * - Read dumped JSONL files from data:dump
 * - Remap all references using natural keys → destination GIDs
 * - Upsert metaobjects and metafields to destination store
 * - Handle errors gracefully, continue on individual failures
 *
 * Order of operations:
 * 1. Build destination index (handles → GIDs)
 * 2. Apply metaobjects (create entries with remapped references)
 * 3. Apply metafields to products, collections, pages
 * 4. Apply pages (create/update with remapped metafields)
 *
 * Idempotency:
 * - Uses metaobjectUpsert (creates if missing, updates if exists by handle)
 * - Uses metafieldsSet (upserts by namespace/key)
 * - Safe to re-run
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { GraphQLClient } from "../graphql/client.js";
import {
  METAOBJECT_UPSERT,
  METAFIELDS_SET,
  PAGE_CREATE,
  PAGE_UPDATE,
} from "../graphql/queries.js";
import { applyFiles, type FileIndex } from "../files/apply.js";
import { relinkMetaobjects } from "../files/relink.js";
import {
  buildDestinationIndex,
  indexMetaobjectType,
  gidForProductHandle,
  gidForCollectionHandle,
  gidForPageHandle,
  gidForMetaobject,
  gidForVariant,
  type DestinationIndex,
} from "../map/ids.js";
import { chunkArray } from "../utils/chunk.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";

// ============================================================================
// Types (matching dump.ts output)
// ============================================================================

interface DumpedMetaobject {
  id: string;
  handle: string;
  type: string;
  displayName?: string;
  updatedAt?: string;
  fields: DumpedField[];
}

interface DumpedField {
  key: string;
  type: string;
  value: string | null;
  // Natural keys for references
  refMetaobject?: { type: string; handle: string };
  refProduct?: { handle: string };
  refVariant?: { productHandle: string; sku?: string; position?: number };
  refCollection?: { handle: string };
  refPage?: { handle: string };
  refFile?: { url: string };
  // For list references
  refList?: Array<{
    type: string;
    metaobjectHandle?: string;
    metaobjectType?: string;
    productHandle?: string;
    variantSku?: string;
    variantProductHandle?: string;
    collectionHandle?: string;
    pageHandle?: string;
  }>;
}

interface DumpedMetafield {
  namespace: string;
  key: string;
  value: string;
  type: string;
  // Natural keys for references
  refMetaobject?: { type: string; handle: string };
  refProduct?: { handle: string };
  refCollection?: { handle: string };
  refList?: Array<{
    type: string;
    metaobjectHandle?: string;
    metaobjectType?: string;
    productHandle?: string;
  }>;
}

interface DumpedProduct {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string;
  status: string;
  metafields: DumpedMetafield[];
  variants: DumpedVariant[];
}

interface DumpedVariant {
  id: string;
  sku?: string;
  title: string;
  position: number;
  metafields: DumpedMetafield[];
}

interface DumpedCollection {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string;
  metafields: DumpedMetafield[];
}

interface DumpedPage {
  id: string;
  handle: string;
  title: string;
  body?: string;
  bodySummary?: string;
  metafields: DumpedMetafield[];
}

interface ApplyStats {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ handle?: string; error: string }>;
}

// ============================================================================
// Reference Remapping
// ============================================================================

/**
 * Remap a single reference from natural key to destination GID.
 * Returns the GID or undefined if not found.
 */
function remapReference(
  field: DumpedField,
  index: DestinationIndex
): string | undefined {
  if (field.refMetaobject) {
    return gidForMetaobject(
      index,
      field.refMetaobject.type,
      field.refMetaobject.handle
    );
  }

  if (field.refProduct) {
    return gidForProductHandle(index, field.refProduct.handle);
  }

  if (field.refVariant) {
    const skuOrPosition =
      field.refVariant.sku || `pos${field.refVariant.position || 0}`;
    return gidForVariant(index, field.refVariant.productHandle, skuOrPosition);
  }

  if (field.refCollection) {
    return gidForCollectionHandle(index, field.refCollection.handle);
  }

  if (field.refPage) {
    return gidForPageHandle(index, field.refPage.handle);
  }

  // Files: keep the URL as-is (files are handled separately)
  if (field.refFile) {
    return field.refFile.url;
  }

  return undefined;
}

/**
 * Remap a list of references to destination GIDs.
 * Returns array of GIDs (skips any that can't be resolved).
 */
function remapReferenceList(
  refList: DumpedField["refList"],
  index: DestinationIndex
): string[] {
  if (!refList) return [];

  const gids: string[] = [];

  for (const ref of refList) {
    let gid: string | undefined;

    if (ref.metaobjectType && ref.metaobjectHandle) {
      gid = gidForMetaobject(index, ref.metaobjectType, ref.metaobjectHandle);
    } else if (ref.productHandle) {
      gid = gidForProductHandle(index, ref.productHandle);
    } else if (ref.variantProductHandle && ref.variantSku) {
      gid = gidForVariant(index, ref.variantProductHandle, ref.variantSku);
    } else if (ref.collectionHandle) {
      gid = gidForCollectionHandle(index, ref.collectionHandle);
    } else if (ref.pageHandle) {
      gid = gidForPageHandle(index, ref.pageHandle);
    }

    if (gid) {
      gids.push(gid);
    } else {
      logger.warn("Failed to resolve reference in list", { ref });
    }
  }

  return gids;
}

/**
 * Remap metafield reference to destination GID.
 */
function remapMetafieldReference(
  mf: DumpedMetafield,
  index: DestinationIndex
): string | undefined {
  if (mf.refMetaobject) {
    return gidForMetaobject(
      index,
      mf.refMetaobject.type,
      mf.refMetaobject.handle
    );
  }

  if (mf.refProduct) {
    return gidForProductHandle(index, mf.refProduct.handle);
  }

  if (mf.refCollection) {
    return gidForCollectionHandle(index, mf.refCollection.handle);
  }

  return undefined;
}

/**
 * Build the value string for a metaobject field after remapping references.
 */
function buildFieldValue(
  field: DumpedField,
  index: DestinationIndex
): string | null {
  // If there's a reference, remap it
  if (
    field.refMetaobject ||
    field.refProduct ||
    field.refVariant ||
    field.refCollection ||
    field.refPage ||
    field.refFile
  ) {
    const gid = remapReference(field, index);
    if (!gid) {
      logger.warn("Failed to remap field reference", {
        key: field.key,
        type: field.type,
      });
      return null; // Skip this reference
    }
    return gid;
  }

  // If there's a list of references, remap them
  if (field.refList && field.refList.length > 0) {
    const gids = remapReferenceList(field.refList, index);
    // Return as JSON array of GIDs
    return JSON.stringify(gids);
  }

  // No references, return the value as-is
  return field.value;
}

/**
 * Build the value string for a metafield after remapping references.
 */
function buildMetafieldValue(
  mf: DumpedMetafield,
  index: DestinationIndex
): string {
  // If there's a single reference, remap it
  if (mf.refMetaobject || mf.refProduct || mf.refCollection) {
    const gid = remapMetafieldReference(mf, index);
    if (!gid) {
      logger.warn("Failed to remap metafield reference", {
        namespace: mf.namespace,
        key: mf.key,
      });
      return mf.value; // Fall back to original value
    }
    return gid;
  }

  // If there's a list of references, remap them
  if (mf.refList && mf.refList.length > 0) {
    const gids: string[] = [];
    for (const ref of mf.refList) {
      let gid: string | undefined;

      if (ref.metaobjectType && ref.metaobjectHandle) {
        gid = gidForMetaobject(index, ref.metaobjectType, ref.metaobjectHandle);
      } else if (ref.productHandle) {
        gid = gidForProductHandle(index, ref.productHandle);
      }

      if (gid) {
        gids.push(gid);
      }
    }
    return JSON.stringify(gids);
  }

  // No references, return the value as-is
  return mf.value;
}

// ============================================================================
// Apply Metaobjects
// ============================================================================

/**
 * Apply metaobjects of a specific type from a dump file.
 * Applies file relinking before upserting if fileIndex is provided.
 */
async function applyMetaobjectsForType(
  client: GraphQLClient,
  type: string,
  inputFile: string,
  index: DestinationIndex,
  fileIndex?: FileIndex
): Promise<ApplyStats> {
  logger.info(`Applying metaobjects of type: ${type}`);

  const stats: ApplyStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Read JSONL file
  if (!fs.existsSync(inputFile)) {
    logger.warn(`File not found: ${inputFile}, skipping`);
    return stats;
  }

  const content = fs.readFileSync(inputFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  // Parse all metaobjects
  const metaobjects: DumpedMetaobject[] = lines.map((line) => JSON.parse(line));

  // Relink file references if fileIndex provided
  const relinkedMetaobjects = fileIndex
    ? relinkMetaobjects(metaobjects, fileIndex)
    : metaobjects;

  for (const metaobj of relinkedMetaobjects) {
    stats.total++;

    try {
      // Build fields with remapped references
      const fields: Array<{ key: string; value: string | null }> = [];

      for (const field of metaobj.fields) {
        const value = buildFieldValue(field, index);
        fields.push({ key: field.key, value });
      }

      // Execute metaobjectUpsert mutation
      const result = await client.request({
        query: METAOBJECT_UPSERT,
        variables: {
          handle: { type: metaobj.type, handle: metaobj.handle },
          metaobject: { fields },
        },
      });

      if (!result.ok) {
        stats.failed++;
        stats.errors.push({
          handle: metaobj.handle,
          error: result.error.message,
        });
        logger.warn(`Failed to upsert metaobject ${metaobj.handle}`, {
          error: result.error.message,
        });
        continue;
      }

      const response = result.data.data?.metaobjectUpsert;
      if (response?.userErrors && response.userErrors.length > 0) {
        stats.failed++;
        const errorMsg = response.userErrors
          .map((e: any) => e.message)
          .join(", ");
        stats.errors.push({ handle: metaobj.handle, error: errorMsg });
        logger.warn(`Metaobject upsert user errors for ${metaobj.handle}`, {
          errors: response.userErrors,
        });
        continue;
      }

      // Success - we can't distinguish created vs updated with upsert
      stats.created++;
      logger.debug(`✓ Upserted metaobject: ${metaobj.type}:${metaobj.handle}`);
    } catch (error) {
      stats.failed++;
      stats.errors.push({ error: String(error) });
      logger.warn("Failed to process metaobject line", {
        error: String(error),
      });
    }
  }

  logger.info(
    `✓ Applied ${stats.created} metaobjects of type ${type} (${stats.failed} failed)`
  );
  return stats;
}

/**
 * Apply all metaobjects from dump directory.
 */
export async function applyMetaobjects(
  client: GraphQLClient,
  inputDir: string,
  index: DestinationIndex,
  fileIndex?: FileIndex
): Promise<Result<ApplyStats, Error>> {
  logger.info("=== Applying Metaobjects ===");

  const aggregateStats: ApplyStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Find all metaobject-*.jsonl files
  const files = fs
    .readdirSync(inputDir)
    .filter((f) => f.startsWith("metaobjects-") && f.endsWith(".jsonl"));

  if (files.length === 0) {
    logger.warn("No metaobject dump files found");
    return ok(aggregateStats);
  }

  for (const file of files) {
    // Extract type from filename: metaobjects-{type}.jsonl
    const match = file.match(/^metaobjects-(.+)\.jsonl$/);
    if (!match) continue;

    const type = match[1];
    const inputFile = path.join(inputDir, file);

    // Index this type in destination first
    await indexMetaobjectType(client, type, index);

    // Apply metaobjects with file relinking
    const stats = await applyMetaobjectsForType(
      client,
      type,
      inputFile,
      index,
      fileIndex
    );

    // Aggregate stats
    aggregateStats.total += stats.total;
    aggregateStats.created += stats.created;
    aggregateStats.updated += stats.updated;
    aggregateStats.skipped += stats.skipped;
    aggregateStats.failed += stats.failed;
    aggregateStats.errors.push(...stats.errors);
  }

  logger.info("✓ Metaobjects apply complete", {
    total: aggregateStats.total,
    created: aggregateStats.created,
    failed: aggregateStats.failed,
  });

  return ok(aggregateStats);
}

// ============================================================================
// Apply Metafields (for Products, Collections, Pages, Variants)
// ============================================================================

/**
 * Apply metafields to products (and their variants).
 */
export async function applyProductMetafields(
  client: GraphQLClient,
  inputFile: string,
  index: DestinationIndex
): Promise<Result<ApplyStats, Error>> {
  logger.info("=== Applying Product Metafields ===");

  const stats: ApplyStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (!fs.existsSync(inputFile)) {
    logger.warn(`Products dump not found: ${inputFile}`);
    return ok(stats);
  }

  const content = fs.readFileSync(inputFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  // Collect all metafields to set (batch by chunks)
  const allMetafields: Array<{
    namespace: string;
    key: string;
    value: string;
    type: string;
    ownerId: string;
  }> = [];

  for (const line of lines) {
    try {
      const product = JSON.parse(line) as DumpedProduct;
      const productGid = gidForProductHandle(index, product.handle);

      if (!productGid) {
        logger.warn(`Product not found in destination: ${product.handle}`);
        stats.skipped++;
        continue;
      }

      // Product-level metafields
      for (const mf of product.metafields) {
        const value = buildMetafieldValue(mf, index);
        allMetafields.push({
          namespace: mf.namespace,
          key: mf.key,
          value,
          type: mf.type,
          ownerId: productGid,
        });
      }

      // Variant-level metafields
      for (const variant of product.variants) {
        const skuOrPosition = variant.sku || `pos${variant.position}`;
        const variantGid = gidForVariant(index, product.handle, skuOrPosition);

        if (!variantGid) {
          logger.warn(`Variant not found: ${product.handle}:${skuOrPosition}`);
          continue;
        }

        for (const mf of variant.metafields) {
          const value = buildMetafieldValue(mf, index);
          allMetafields.push({
            namespace: mf.namespace,
            key: mf.key,
            value,
            type: mf.type,
            ownerId: variantGid,
          });
        }
      }
    } catch (error) {
      logger.warn("Failed to process product line", { error: String(error) });
    }
  }

  // Batch metafields in chunks of 25 (Shopify limit)
  const chunks = chunkArray(allMetafields, 25);
  logger.info(
    `Setting ${allMetafields.length} product metafields in ${chunks.length} batches`
  );

  for (const chunk of chunks) {
    stats.total += chunk.length;

    try {
      const result = await client.request({
        query: METAFIELDS_SET,
        variables: {
          metafields: chunk.map((mf) => ({
            namespace: mf.namespace,
            key: mf.key,
            value: mf.value,
            type: mf.type,
            ownerId: mf.ownerId,
          })),
        },
      });

      if (!result.ok) {
        stats.failed += chunk.length;
        stats.errors.push({ error: result.error.message });
        logger.warn("Metafields batch failed", { error: result.error.message });
        continue;
      }

      const response = result.data.data?.metafieldsSet;
      if (response?.userErrors && response.userErrors.length > 0) {
        stats.failed += response.userErrors.length;
        response.userErrors.forEach((e: any) => {
          stats.errors.push({ error: e.message });
        });
        logger.warn("Metafields batch had user errors", {
          errors: response.userErrors,
        });
      }

      stats.created += chunk.length - (response?.userErrors?.length || 0);
    } catch (error) {
      stats.failed += chunk.length;
      stats.errors.push({ error: String(error) });
      logger.warn("Metafields batch exception", { error: String(error) });
    }
  }

  logger.info(
    `✓ Applied ${stats.created} product metafields (${stats.failed} failed)`
  );
  return ok(stats);
}

/**
 * Apply metafields to collections.
 */
export async function applyCollectionMetafields(
  client: GraphQLClient,
  inputFile: string,
  index: DestinationIndex
): Promise<Result<ApplyStats, Error>> {
  logger.info("=== Applying Collection Metafields ===");

  const stats: ApplyStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (!fs.existsSync(inputFile)) {
    logger.warn(`Collections dump not found: ${inputFile}`);
    return ok(stats);
  }

  const content = fs.readFileSync(inputFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  const allMetafields: Array<{
    namespace: string;
    key: string;
    value: string;
    type: string;
    ownerId: string;
  }> = [];

  for (const line of lines) {
    try {
      const collection = JSON.parse(line) as DumpedCollection;
      const collectionGid = gidForCollectionHandle(index, collection.handle);

      if (!collectionGid) {
        logger.warn(
          `Collection not found in destination: ${collection.handle}`
        );
        stats.skipped++;
        continue;
      }

      for (const mf of collection.metafields) {
        const value = buildMetafieldValue(mf, index);
        allMetafields.push({
          namespace: mf.namespace,
          key: mf.key,
          value,
          type: mf.type,
          ownerId: collectionGid,
        });
      }
    } catch (error) {
      logger.warn("Failed to process collection line", {
        error: String(error),
      });
    }
  }

  // Batch in chunks of 25
  const chunks = chunkArray(allMetafields, 25);
  logger.info(
    `Setting ${allMetafields.length} collection metafields in ${chunks.length} batches`
  );

  for (const chunk of chunks) {
    stats.total += chunk.length;

    try {
      const result = await client.request({
        query: METAFIELDS_SET,
        variables: {
          metafields: chunk.map((mf) => ({
            namespace: mf.namespace,
            key: mf.key,
            value: mf.value,
            type: mf.type,
            ownerId: mf.ownerId,
          })),
        },
      });

      if (!result.ok) {
        stats.failed += chunk.length;
        stats.errors.push({ error: result.error.message });
        continue;
      }

      const response = result.data.data?.metafieldsSet;
      if (response?.userErrors && response.userErrors.length > 0) {
        stats.failed += response.userErrors.length;
        response.userErrors.forEach((e: any) => {
          stats.errors.push({ error: e.message });
        });
      }

      stats.created += chunk.length - (response?.userErrors?.length || 0);
    } catch (error) {
      stats.failed += chunk.length;
      stats.errors.push({ error: String(error) });
    }
  }

  logger.info(
    `✓ Applied ${stats.created} collection metafields (${stats.failed} failed)`
  );
  return ok(stats);
}

/**
 * Apply metafields to pages.
 */
export async function applyPageMetafields(
  client: GraphQLClient,
  inputFile: string,
  index: DestinationIndex
): Promise<Result<ApplyStats, Error>> {
  logger.info("=== Applying Page Metafields ===");

  const stats: ApplyStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (!fs.existsSync(inputFile)) {
    logger.warn(`Pages dump not found: ${inputFile}`);
    return ok(stats);
  }

  const content = fs.readFileSync(inputFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  const allMetafields: Array<{
    namespace: string;
    key: string;
    value: string;
    type: string;
    ownerId: string;
  }> = [];

  for (const line of lines) {
    try {
      const page = JSON.parse(line) as DumpedPage;
      const pageGid = gidForPageHandle(index, page.handle);

      if (!pageGid) {
        logger.warn(`Page not found in destination: ${page.handle}`);
        stats.skipped++;
        continue;
      }

      for (const mf of page.metafields) {
        const value = buildMetafieldValue(mf, index);
        allMetafields.push({
          namespace: mf.namespace,
          key: mf.key,
          value,
          type: mf.type,
          ownerId: pageGid,
        });
      }
    } catch (error) {
      logger.warn("Failed to process page line", { error: String(error) });
    }
  }

  // Batch in chunks of 25
  const chunks = chunkArray(allMetafields, 25);
  logger.info(
    `Setting ${allMetafields.length} page metafields in ${chunks.length} batches`
  );

  for (const chunk of chunks) {
    stats.total += chunk.length;

    try {
      const result = await client.request({
        query: METAFIELDS_SET,
        variables: {
          metafields: chunk.map((mf) => ({
            namespace: mf.namespace,
            key: mf.key,
            value: mf.value,
            type: mf.type,
            ownerId: mf.ownerId,
          })),
        },
      });

      if (!result.ok) {
        stats.failed += chunk.length;
        stats.errors.push({ error: result.error.message });
        continue;
      }

      const response = result.data.data?.metafieldsSet;
      if (response?.userErrors && response.userErrors.length > 0) {
        stats.failed += response.userErrors.length;
        response.userErrors.forEach((e: any) => {
          stats.errors.push({ error: e.message });
        });
      }

      stats.created += chunk.length - (response?.userErrors?.length || 0);
    } catch (error) {
      stats.failed += chunk.length;
      stats.errors.push({ error: String(error) });
    }
  }

  logger.info(
    `✓ Applied ${stats.created} page metafields (${stats.failed} failed)`
  );
  return ok(stats);
}

/**
 * Apply shop-level metafields.
 * Shop GID is queried directly (there's only one shop per store).
 */
export async function applyShopMetafields(
  client: GraphQLClient,
  inputFile: string,
  index: DestinationIndex
): Promise<Result<ApplyStats, Error>> {
  logger.info("=== Applying Shop Metafields ===");

  const stats: ApplyStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (!fs.existsSync(inputFile)) {
    logger.warn(`Shop metafields dump not found: ${inputFile}`);
    return ok(stats);
  }

  // Query the shop GID
  const shopQueryResult = await client.request<{ shop: { id: string } }>({
    query: `{ shop { id } }`,
    variables: {},
  });

  if (!shopQueryResult.ok || !shopQueryResult.data.data?.shop?.id) {
    logger.error("Failed to query shop ID");
    return err(new Error("Could not retrieve shop ID"));
  }

  const shopGid = shopQueryResult.data.data.shop.id;
  logger.info(`Retrieved shop GID: ${shopGid}`);

  const content = fs.readFileSync(inputFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  const allMetafields: Array<{
    namespace: string;
    key: string;
    value: string;
    type: string;
    ownerId: string;
  }> = [];

  for (const line of lines) {
    try {
      const mf = JSON.parse(line) as DumpedMetafield;
      const value = buildMetafieldValue(mf, index);
      allMetafields.push({
        namespace: mf.namespace,
        key: mf.key,
        value,
        type: mf.type,
        ownerId: shopGid,
      });
    } catch (error) {
      logger.warn("Failed to process shop metafield line", {
        error: String(error),
      });
    }
  }

  // Batch in chunks of 25
  const chunks = chunkArray(allMetafields, 25);
  logger.info(
    `Setting ${allMetafields.length} shop metafields in ${chunks.length} batches`
  );

  for (const chunk of chunks) {
    stats.total += chunk.length;

    try {
      const result = await client.request({
        query: METAFIELDS_SET,
        variables: {
          metafields: chunk.map((mf) => ({
            namespace: mf.namespace,
            key: mf.key,
            value: mf.value,
            type: mf.type,
            ownerId: mf.ownerId,
          })),
        },
      });

      if (!result.ok) {
        stats.failed += chunk.length;
        stats.errors.push({ error: result.error.message });
        continue;
      }

      const response = result.data.data?.metafieldsSet;
      if (response?.userErrors && response.userErrors.length > 0) {
        stats.failed += response.userErrors.length;
        response.userErrors.forEach((e: any) => {
          stats.errors.push({ error: e.message });
        });
      }

      stats.created += chunk.length - (response?.userErrors?.length || 0);
    } catch (error) {
      stats.failed += chunk.length;
      stats.errors.push({ error: String(error) });
      logger.warn("Shop metafields batch exception", { error: String(error) });
    }
  }

  logger.info(
    `✓ Shop metafields: ${stats.created} created, ${stats.failed} failed`
  );
  return ok(stats);
}

// ============================================================================
// Apply Pages (Content)
// ============================================================================

/**
 * Apply pages (create/update page content).
 * This creates pages that don't exist and updates content for existing pages.
 */
export async function applyPages(
  client: GraphQLClient,
  inputFile: string,
  index: DestinationIndex
): Promise<Result<ApplyStats, Error>> {
  logger.info("=== Applying Pages ===");

  const stats: ApplyStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (!fs.existsSync(inputFile)) {
    logger.warn(`Pages dump not found: ${inputFile}`);
    return ok(stats);
  }

  const content = fs.readFileSync(inputFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    stats.total++;

    try {
      const page = JSON.parse(line) as DumpedPage;
      const existingPageGid = gidForPageHandle(index, page.handle);

      if (existingPageGid) {
        // Page exists - update it
        const result = await client.request({
          query: PAGE_UPDATE,
          variables: {
            id: existingPageGid,
            page: {
              title: page.title,
              body: page.body || "",
              // Note: handle cannot be updated after creation
            },
          },
        });

        if (!result.ok) {
          stats.failed++;
          stats.errors.push({
            handle: page.handle,
            error: result.error.message,
          });
          logger.warn(`Failed to update page ${page.handle}`, {
            error: result.error.message,
          });
          continue;
        }

        const response = result.data.data?.pageUpdate;
        if (response?.userErrors && response.userErrors.length > 0) {
          stats.failed++;
          const errorMsg = response.userErrors
            .map((e: any) => e.message)
            .join(", ");
          stats.errors.push({ handle: page.handle, error: errorMsg });
          logger.warn(`Page update user errors for ${page.handle}`, {
            errors: response.userErrors,
          });
          continue;
        }

        stats.updated++;
        logger.debug(`✓ Updated page: ${page.handle}`);
      } else {
        // Page doesn't exist - create it
        const result = await client.request({
          query: PAGE_CREATE,
          variables: {
            page: {
              title: page.title,
              handle: page.handle,
              body: page.body || "",
            },
          },
        });

        if (!result.ok) {
          stats.failed++;
          stats.errors.push({
            handle: page.handle,
            error: result.error.message,
          });
          logger.warn(`Failed to create page ${page.handle}`, {
            error: result.error.message,
          });
          continue;
        }

        const response = result.data.data?.pageCreate;
        if (response?.userErrors && response.userErrors.length > 0) {
          stats.failed++;
          const errorMsg = response.userErrors
            .map((e: any) => e.message)
            .join(", ");
          stats.errors.push({ handle: page.handle, error: errorMsg });
          logger.warn(`Page create user errors for ${page.handle}`, {
            errors: response.userErrors,
          });
          continue;
        }

        stats.created++;

        // Add newly created page to index for subsequent operations
        if (response?.page?.id) {
          index.pages.set(page.handle, response.page.id);
        }

        logger.debug(`✓ Created page: ${page.handle}`);
      }
    } catch (error) {
      stats.failed++;
      stats.errors.push({ error: String(error) });
      logger.warn("Failed to process page line", { error: String(error) });
    }
  }

  logger.info(
    `✓ Applied ${stats.created + stats.updated} pages (${
      stats.created
    } created, ${stats.updated} updated, ${stats.failed} failed)`
  );
  return ok(stats);
}

// ============================================================================
// Main Apply Function
// ============================================================================

/**
 * Apply all data from dump directory to destination store.
 *
 * Order:
 * 1. Build destination index
 * 2. Apply files (upload and build file index for relinking)
 * 3. Apply metaobjects (with remapped refs including files)
 * 4. Apply pages (create/update content)
 * 5. Apply metafields to products, collections, pages, shop
 */
export async function applyAllData(
  client: GraphQLClient,
  inputDir: string
): Promise<
  Result<
    {
      metaobjects: ApplyStats;
      pages: ApplyStats;
      metafields: ApplyStats;
      files: { uploaded: number; failed: number };
    },
    Error
  >
> {
  logger.info("=== Starting Data Apply ===");

  // Step 1: Build destination index
  logger.info("Step 1: Building destination index...");
  const index = await buildDestinationIndex(client);

  // Step 2: Apply files (BEFORE metaobjects so we can relink file references)
  logger.info("Step 2: Applying files...");
  const filesFile = path.join(inputDir, "files.jsonl");
  const filesResult = await applyFiles(client, filesFile);

  let fileIndex: FileIndex;
  if (!filesResult.ok) {
    logger.warn("Files apply failed, continuing without file relinking...");
    fileIndex = { urlToGid: new Map(), gidToGid: new Map() };
  } else {
    fileIndex = filesResult.data;
  }

  // Step 3: Apply metaobjects (with file relinking)
  logger.info("Step 3: Applying metaobjects...");
  const metaobjectsResult = await applyMetaobjects(
    client,
    inputDir,
    index,
    fileIndex
  );
  if (!metaobjectsResult.ok) {
    return err(metaobjectsResult.error);
  }

  // Rebuild index after creating metaobjects to ensure new ones are mapped
  logger.info("Rebuilding index after metaobject creation...");
  const updatedIndex = await buildDestinationIndex(client);

  // Step 4: Apply pages (create/update content before metafields)
  logger.info("Step 4: Applying pages...");
  const pagesFile = path.join(inputDir, "pages.jsonl");
  const pagesResult = await applyPages(client, pagesFile, updatedIndex);
  if (!pagesResult.ok) {
    logger.warn("Pages apply failed, continuing...");
  }

  // Rebuild index after creating pages to ensure new pages are mapped
  logger.info("Rebuilding index after page creation...");
  const finalIndex = await buildDestinationIndex(client);

  // Step 5: Apply metafields
  logger.info("Step 5: Applying metafields...");

  const aggregateMetafields: ApplyStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Products
  const productsFile = path.join(inputDir, "products.jsonl");
  const productMfResult = await applyProductMetafields(
    client,
    productsFile,
    finalIndex
  );
  if (productMfResult.ok) {
    const stats = productMfResult.data;
    aggregateMetafields.total += stats.total;
    aggregateMetafields.created += stats.created;
    aggregateMetafields.failed += stats.failed;
    aggregateMetafields.errors.push(...stats.errors);
  }

  // Collections
  const collectionsFile = path.join(inputDir, "collections.jsonl");
  const collectionMfResult = await applyCollectionMetafields(
    client,
    collectionsFile,
    finalIndex
  );
  if (collectionMfResult.ok) {
    const stats = collectionMfResult.data;
    aggregateMetafields.total += stats.total;
    aggregateMetafields.created += stats.created;
    aggregateMetafields.failed += stats.failed;
    aggregateMetafields.errors.push(...stats.errors);
  }

  // Pages metafields
  const pageMfResult = await applyPageMetafields(client, pagesFile, finalIndex);
  if (pageMfResult.ok) {
    const stats = pageMfResult.data;
    aggregateMetafields.total += stats.total;
    aggregateMetafields.created += stats.created;
    aggregateMetafields.failed += stats.failed;
    aggregateMetafields.errors.push(...stats.errors);
  }

  // Shop metafields
  const shopMetafieldsFile = path.join(inputDir, "shop-metafields.jsonl");
  const shopMfResult = await applyShopMetafields(
    client,
    shopMetafieldsFile,
    finalIndex
  );
  if (shopMfResult.ok) {
    const stats = shopMfResult.data;
    aggregateMetafields.total += stats.total;
    aggregateMetafields.created += stats.created;
    aggregateMetafields.failed += stats.failed;
    aggregateMetafields.errors.push(...stats.errors);
  }

  logger.info("=== Data Apply Complete ===", {
    files: {
      uploaded: fileIndex.urlToGid.size,
    },
    metaobjects: {
      total: metaobjectsResult.data.total,
      created: metaobjectsResult.data.created,
      failed: metaobjectsResult.data.failed,
    },
    pages: {
      total: pagesResult.ok ? pagesResult.data.total : 0,
      created: pagesResult.ok ? pagesResult.data.created : 0,
      updated: pagesResult.ok ? pagesResult.data.updated : 0,
      failed: pagesResult.ok ? pagesResult.data.failed : 0,
    },
    metafields: {
      total: aggregateMetafields.total,
      created: aggregateMetafields.created,
      failed: aggregateMetafields.failed,
    },
  });

  return ok({
    files: {
      uploaded: fileIndex.urlToGid.size,
      failed: 0, // TODO: track failed uploads
    },
    metaobjects: metaobjectsResult.data,
    pages: pagesResult.ok
      ? pagesResult.data
      : {
          total: 0,
          created: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          errors: [],
        },
    metafields: aggregateMetafields,
  });
}
