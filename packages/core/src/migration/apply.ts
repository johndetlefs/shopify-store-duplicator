/**
 * Data apply operations: import metaobjects, metafields, and CMS content to destination.
 *
 * Purpose:
 * - Read dumped JSONL files from data:dump
 * - Remap all references using natural keys → destination GIDs
 * - Upsert metaobjects and metafields to destination store
 * - Handle errors gracefully, continue on individual failures
 *
 * Order of operations (10 phases):
 * 1. Build destination index (handles → GIDs)
 * 2. Upload files & build file index for relinking
 * 3. Apply products (with variants and publications) - before metaobjects
 * 4. Apply collections (with publications) - before metaobjects
 * 5. Apply blogs - before articles
 * 6. Apply articles (with blog relationship) - before metaobjects
 * 7. Apply pages (create/update with full HTML content) - before metaobjects
 * 8. Rebuild index (capture newly created resources)
 * 9. Apply metaobjects (with remapped refs and file relinking) - can now reference all resources
 * 10. Apply metafields to all resources (products, variants, collections, pages, blogs, articles, shop, metaobjects)
 *
 * Idempotency:
 * - Uses metaobjectUpsert (creates if missing, updates if exists by handle)
 * - Uses metafieldsSet (upserts by namespace/key)
 * - Files: matches by filename, updates alt text if changed, skips unchanged
 * - Publications: unpublishes from all channels, then publishes to matching source channels
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
  BLOG_CREATE,
  BLOG_UPDATE,
  ARTICLE_CREATE,
  ARTICLE_UPDATE,
  PRODUCT_CREATE,
  PRODUCT_UPDATE,
  PRODUCT_VARIANT_BULK_CREATE,
  PRODUCT_VARIANT_BULK_UPDATE,
  COLLECTION_CREATE,
  COLLECTION_UPDATE,
} from "../graphql/queries.js";
import { applyFiles, type FileIndex } from "../files/apply.js";
import { relinkMetaobjects } from "../files/relink.js";
import {
  buildDestinationIndex,
  indexMetaobjectType,
  gidForProductHandle,
  gidForCollectionHandle,
  gidForPageHandle,
  gidForBlogHandle,
  gidForArticle,
  gidForMetaobject,
  gidForVariant,
  type DestinationIndex,
} from "../map/ids.js";
import { chunkArray } from "../utils/chunk.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";
import { createProgressBar } from "../utils/progress.js";

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
    gid?: string; // For types without natural keys (e.g., TaxonomyValue)
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
  vendor?: string;
  productType?: string;
  tags?: string[];
  options?: Array<{
    id: string;
    name: string;
    position: number;
    values: string[];
  }>;
  media?: Array<{
    id: string;
    url: string;
    alt?: string;
    mediaType: string;
  }>;
  publications?: Array<{
    node: {
      publication: {
        id: string;
        name: string;
      };
      publishDate?: string;
      isPublished: boolean;
    };
  }>;
  metafields: DumpedMetafield[];
  variants: DumpedVariant[];
}

interface DumpedVariant {
  id: string;
  sku?: string;
  title: string;
  position: number;
  price?: string;
  compareAtPrice?: string;
  barcode?: string;
  inventoryQuantity?: number;
  inventoryPolicy?: string;
  taxable?: boolean;
  selectedOptions?: Array<{
    name: string;
    value: string;
  }>;
  inventoryItem?: {
    id: string;
    tracked: boolean;
    measurement?: {
      weight?: {
        value: number;
        unit: string;
      };
    };
  };
  metafields: DumpedMetafield[];
}

interface DumpedCollection {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string;
  ruleSet?: any; // Collection rules for automated collections
  publications?: Array<{
    node: {
      publication: {
        id: string;
        name: string;
      };
      publishDate?: string;
      isPublished: boolean;
    };
  }>;
  metafields: DumpedMetafield[];
}

interface DumpedPage {
  id: string;
  handle: string;
  title: string;
  body?: string;
  bodySummary?: string;
  templateSuffix?: string;
  metafields: DumpedMetafield[];
}

interface DumpedBlog {
  id: string;
  handle: string;
  title: string;
  templateSuffix?: string;
  metafields: DumpedMetafield[];
}

interface DumpedArticle {
  id: string;
  handle: string;
  blogHandle: string;
  title: string;
  body?: string;
  templateSuffix?: string;
  image?: {
    altText?: string;
    url?: string;
  };
  author?: string;
  tags?: string[];
  publishedAt?: string;
  metafields: DumpedMetafield[];
}

interface ApplyStats {
  total: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  publicationsSynced?: number; // Number of resources that had publications synced
  publicationErrors?: number; // Number of resources that failed publication sync
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
    } else if (ref.gid) {
      // For types without natural keys (e.g., TaxonomyValue), use the GID directly
      gid = ref.gid;
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
 * Returns null if a reference cannot be resolved (resource doesn't exist in destination).
 */
function buildMetafieldValue(
  mf: DumpedMetafield,
  index: DestinationIndex
): string | null {
  // If there's a single reference, remap it
  if (mf.refMetaobject || mf.refProduct || mf.refCollection) {
    const gid = remapMetafieldReference(mf, index);
    if (!gid) {
      logger.warn(
        "Skipping metafield with invalid reference (resource not found in destination)",
        {
          namespace: mf.namespace,
          key: mf.key,
          refType: mf.refMetaobject
            ? "metaobject"
            : mf.refProduct
            ? "product"
            : "collection",
          refHandle:
            mf.refMetaobject?.handle ||
            mf.refProduct?.handle ||
            mf.refCollection?.handle,
        }
      );
      return null; // Skip this metafield - reference is invalid
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
      } else {
        // Log warning for each missing reference in list
        logger.warn("Skipping reference in list (not found in destination)", {
          namespace: mf.namespace,
          key: mf.key,
          refType: ref.metaobjectType ? "metaobject" : "product",
          refHandle: ref.metaobjectHandle || ref.productHandle,
        });
      }
    }
    // If no valid references were found, return null to skip the metafield
    if (gids.length === 0) {
      logger.warn("Skipping metafield - no valid references in list", {
        namespace: mf.namespace,
        key: mf.key,
      });
      return null;
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

  // Create progress bar for metaobject processing
  const progressBar = createProgressBar(relinkedMetaobjects.length, {
    format: `Metaobjects (${type}) :bar :percent (:current/:total) :eta`,
  });

  for (const metaobj of relinkedMetaobjects) {
    stats.total++;
    progressBar.tick();

    try {
      // Build fields with remapped references
      const fields: Array<{ key: string; value: string | null }> = [];

      for (const field of metaobj.fields) {
        const value = buildFieldValue(field, index);
        // Skip null values - let Shopify use defaults or leave empty
        if (value !== null) {
          fields.push({ key: field.key, value });
        }
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

  // Complete the progress bar
  progressBar.complete();

  logger.info(
    `✓ Applied ${stats.created} metaobjects of type ${type} (${stats.failed} failed)`
  );
  return stats;
}

// ============================================================================
// Publications (Sales Channels) Sync
// ============================================================================

/**
 * Sync publications for a resource (product or collection).
 *
 * IDEMPOTENT STRATEGY:
 * 1. Get source publications from dump (which channels it was published to)
 * 2. Map source publication names to destination publication IDs
 * 3. Unpublish from ALL destination publications first
 * 4. Publish ONLY to channels that match source
 *
 * This ensures the destination exactly matches the source state, regardless of current state.
 * Safe to re-run - will always converge to source state.
 *
 * @param client GraphQL client for destination store
 * @param resourceId The GID of the product or collection in destination
 * @param sourcePublications Array of publications from source dump
 * @param index Destination index with publication name → GID mapping
 * @param resourceHandle Handle of the resource (for logging)
 */
async function syncPublications(
  client: GraphQLClient,
  resourceId: string,
  sourcePublications:
    | Array<{
        node: {
          publication: { id: string; name: string };
          publishDate?: string;
          isPublished: boolean;
        };
      }>
    | undefined,
  index: DestinationIndex,
  resourceHandle: string
): Promise<{ synced: number; errors: string[] }> {
  const errors: string[] = [];

  // If no publications in source, nothing to sync
  if (!sourcePublications || sourcePublications.length === 0) {
    logger.debug(`No publications to sync for ${resourceHandle}`);
    return { synced: 0, errors };
  }

  // Get list of publications to publish to (only ones that exist in destination)
  const publicationsToPublish: string[] = [];
  for (const pub of sourcePublications) {
    if (!pub.node.isPublished) continue; // Skip unpublished

    const pubName = pub.node.publication.name;
    const destPubId = index.publications.get(pubName);

    if (!destPubId) {
      logger.debug(
        `Publication "${pubName}" not found in destination, skipping for ${resourceHandle}`
      );
      continue;
    }

    publicationsToPublish.push(destPubId);
  }

  if (publicationsToPublish.length === 0) {
    logger.debug(`No matching publications for ${resourceHandle}`);
    return { synced: 0, errors };
  }

  // Unpublish from ALL publications first (to ensure clean state)
  // We'll query all destination publications and unpublish from each
  const allPublicationIds = Array.from(index.publications.values());

  if (allPublicationIds.length > 0) {
    try {
      const unpublishInput = allPublicationIds.map((pubId) => ({
        publicationId: pubId,
      }));

      const unpublishResult = await client.request({
        query: `
          mutation publishableUnpublish($id: ID!, $input: [PublicationInput!]!) {
            publishableUnpublish(id: $id, input: $input) {
              userErrors {
                field
                message
              }
            }
          }
        `,
        variables: { id: resourceId, input: unpublishInput },
      });

      if (!unpublishResult.ok) {
        logger.debug(
          `Error unpublishing ${resourceHandle}: ${unpublishResult.error.message}`
        );
        // Continue anyway
      } else if (
        unpublishResult.data.data.publishableUnpublish?.userErrors?.length > 0
      ) {
        const errorMsg =
          unpublishResult.data.data.publishableUnpublish.userErrors
            .map((e: any) => e.message)
            .join(", ");
        logger.debug(`Unpublish warnings for ${resourceHandle}: ${errorMsg}`);
      }
    } catch (error) {
      logger.debug(`Error unpublishing ${resourceHandle}: ${error}`);
      // Continue anyway - we'll try to publish
    }
  }

  // Now publish to target channels
  try {
    const publishInput = publicationsToPublish.map((pubId) => ({
      publicationId: pubId,
    }));

    const publishResult = await client.request({
      query: `
        mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
          publishablePublish(id: $id, input: $input) {
            userErrors {
              field
              message
            }
          }
        }
      `,
      variables: { id: resourceId, input: publishInput },
    });

    if (!publishResult.ok) {
      errors.push(publishResult.error.message);
      logger.warn(
        `Publish errors for ${resourceHandle}: ${publishResult.error.message}`
      );
      return { synced: 0, errors };
    }

    if (publishResult.data.data.publishablePublish?.userErrors?.length > 0) {
      const errorMsg = publishResult.data.data.publishablePublish.userErrors
        .map((e: any) => e.message)
        .join(", ");
      errors.push(errorMsg);
      logger.warn(`Publish errors for ${resourceHandle}: ${errorMsg}`);
      return { synced: 0, errors };
    }

    logger.debug(
      `✓ Synced publications for ${resourceHandle} (published to ${publicationsToPublish.length} channels)`
    );
    return { synced: publicationsToPublish.length, errors };
  } catch (error) {
    const errorMsg = String(error);
    errors.push(errorMsg);
    logger.warn(
      `Failed to sync publications for ${resourceHandle}: ${errorMsg}`
    );
    return { synced: 0, errors };
  }
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
        if (value !== null) {
          allMetafields.push({
            namespace: mf.namespace,
            key: mf.key,
            value,
            type: mf.type,
            ownerId: productGid,
          });
        }
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
          if (value !== null) {
            allMetafields.push({
              namespace: mf.namespace,
              key: mf.key,
              value,
              type: mf.type,
              ownerId: variantGid,
            });
          }
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

  // Create progress bar for metafield batch processing
  const progressBar = createProgressBar(chunks.length, {
    format: "Product Metafields :bar :percent (:current/:total) :eta",
  });

  for (const chunk of chunks) {
    stats.total += chunk.length;
    progressBar.tick();

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

  // Complete the progress bar
  progressBar.complete();

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
        if (value !== null) {
          allMetafields.push({
            namespace: mf.namespace,
            key: mf.key,
            value,
            type: mf.type,
            ownerId: collectionGid,
          });
        }
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

  // Create progress bar for metafield batch processing
  const progressBar = createProgressBar(chunks.length, {
    format: "Collection Metafields :bar :percent (:current/:total) :eta",
  });

  for (const chunk of chunks) {
    stats.total += chunk.length;
    progressBar.tick();

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

  // Complete the progress bar
  progressBar.complete();

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
        if (value !== null) {
          allMetafields.push({
            namespace: mf.namespace,
            key: mf.key,
            value,
            type: mf.type,
            ownerId: pageGid,
          });
        }
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

  // Create progress bar for metafield batch processing
  const progressBar = createProgressBar(chunks.length, {
    format: "Page Metafields :bar :percent (:current/:total) :eta",
  });

  for (const chunk of chunks) {
    stats.total += chunk.length;
    progressBar.tick();

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

  // Complete the progress bar
  progressBar.complete();

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
      if (value !== null) {
        allMetafields.push({
          namespace: mf.namespace,
          key: mf.key,
          value,
          type: mf.type,
          ownerId: shopGid,
        });
      }
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
// Apply Products
// ============================================================================

/**
 * Apply products (create/update product data).
 * This creates products that don't exist and updates basic fields for existing products.
 * Note: This creates products with basic info only. Variants, pricing, inventory handled separately.
 */
export async function applyProducts(
  client: GraphQLClient,
  inputFile: string,
  index: DestinationIndex,
  fileIndex?: FileIndex
): Promise<Result<ApplyStats, Error>> {
  logger.info("=== Applying Products ===");

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

  // Track products that need variant processing
  const productsNeedingVariants: Array<{
    product: DumpedProduct;
    productId: string;
  }> = [];

  // Create progress bar for product processing
  const progressBar = createProgressBar(lines.length, {
    format: "Products :bar :percent (:current/:total) :eta",
  });

  // Phase 1: Create/update all products (without variants)
  for (const line of lines) {
    stats.total++;
    progressBar.tick();

    try {
      const product = JSON.parse(line) as DumpedProduct;
      const existingProductGid = gidForProductHandle(index, product.handle);

      // Ensure title is not null or empty - use handle as fallback
      const productTitle =
        product.title && product.title.trim()
          ? product.title
          : product.handle
              .split("-")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" ");

      if (existingProductGid) {
        // Product exists - update it
        const updateInput: any = {
          id: existingProductGid,
          title: productTitle,
          descriptionHtml: product.descriptionHtml || "",
          status: product.status || "ACTIVE",
        };

        const result = await client.request({
          query: PRODUCT_UPDATE,
          variables: {
            product: updateInput,
          },
        });

        if (!result.ok) {
          stats.failed++;
          stats.errors.push({
            handle: product.handle,
            error: result.error.message,
          });
          logger.warn(`Failed to update product ${product.handle}`, {
            error: result.error.message,
          });
          continue;
        }

        const response = result.data.data?.productUpdate;
        if (response?.userErrors && response.userErrors.length > 0) {
          stats.failed++;
          const errorMsg = response.userErrors
            .map((e: any) => e.message)
            .join(", ");
          stats.errors.push({ handle: product.handle, error: errorMsg });
          logger.warn(`Product update user errors for ${product.handle}`, {
            errors: response.userErrors,
          });
          continue;
        }

        // Update media separately if present (idempotent: delete existing, then add)
        if (product.media && product.media.length > 0 && fileIndex) {
          const {
            PRODUCT_CREATE_MEDIA,
            PRODUCT_DELETE_MEDIA,
            GET_PRODUCT_MEDIA,
          } = await import("../graphql/queries.js");

          // Step 1: Query existing media
          const existingMediaResult = await client.request({
            query: GET_PRODUCT_MEDIA,
            variables: { id: existingProductGid },
          });

          // Step 2: Delete existing media if any
          if (
            existingMediaResult.ok &&
            existingMediaResult.data.data?.product?.media?.edges?.length > 0
          ) {
            const mediaIds =
              existingMediaResult.data.data.product.media.edges.map(
                (edge: any) => edge.node.id
              );

            const deleteResult = await client.request({
              query: PRODUCT_DELETE_MEDIA,
              variables: {
                productId: existingProductGid,
                mediaIds: mediaIds,
              },
            });

            if (!deleteResult.ok) {
              logger.warn(
                `Failed to delete existing media for product ${product.handle}`,
                { error: deleteResult.error.message }
              );
            } else if (
              deleteResult.data.data?.productDeleteMedia?.mediaUserErrors
                ?.length > 0
            ) {
              logger.warn(
                `Media deletion warnings for product ${product.handle}`,
                {
                  errors:
                    deleteResult.data.data.productDeleteMedia.mediaUserErrors,
                }
              );
            } else {
              logger.debug(
                `✓ Deleted ${mediaIds.length} existing media items from product: ${product.handle}`
              );
            }
          }

          // Step 3: Add new media
          const mediaInputs = product.media
            .map((m) => {
              // Use destination URL for productCreateMedia (not GID)
              const destUrl = fileIndex.gidToUrl.get(m.id);
              if (destUrl) {
                return {
                  mediaContentType:
                    m.mediaType === "MediaImage" ? "IMAGE" : "VIDEO",
                  alt: m.alt || "",
                  originalSource: destUrl,
                };
              }
              return null;
            })
            .filter((m) => m !== null);

          if (mediaInputs.length > 0) {
            const mediaResult = await client.request({
              query: PRODUCT_CREATE_MEDIA,
              variables: {
                productId: existingProductGid,
                media: mediaInputs,
              },
            });

            if (!mediaResult.ok) {
              logger.warn(`Failed to add media to product ${product.handle}`, {
                error: mediaResult.error.message,
              });
            } else {
              const mediaResponse = mediaResult.data.data?.productCreateMedia;
              if (
                mediaResponse?.mediaUserErrors &&
                mediaResponse.mediaUserErrors.length > 0
              ) {
                logger.warn(`Media user errors for product ${product.handle}`, {
                  errors: mediaResponse.mediaUserErrors,
                });
              } else {
                logger.debug(
                  `✓ Added ${mediaInputs.length} media items to product: ${product.handle}`
                );
              }
            }
          }
        }

        stats.updated++;
        logger.debug(`✓ Updated product: ${product.handle}`);

        // Sync publications for updated product
        if (product.publications) {
          const pubResult = await syncPublications(
            client,
            existingProductGid,
            product.publications,
            index,
            product.handle
          );
          if (pubResult.synced > 0) {
            stats.publicationsSynced = (stats.publicationsSynced || 0) + 1;
          }
          if (pubResult.errors.length > 0) {
            stats.publicationErrors = (stats.publicationErrors || 0) + 1;
          }
        }

        // Queue variants for later processing (after index rebuild)
        if (product.variants && product.variants.length > 0) {
          const hasRealVariants =
            product.variants.length > 1 ||
            (product.variants[0] &&
              product.variants[0].selectedOptions &&
              product.variants[0].selectedOptions.length > 0);

          if (hasRealVariants) {
            productsNeedingVariants.push({
              product,
              productId: existingProductGid,
            });
          }
        }
      } else {
        // Product doesn't exist - create it with options
        const productInput: any = {
          title: productTitle,
          handle: product.handle,
          descriptionHtml: product.descriptionHtml || "",
          status: product.status || "ACTIVE",
        };

        // Add optional fields if present
        if (product.vendor) productInput.vendor = product.vendor;
        if (product.productType) productInput.productType = product.productType;
        if (product.tags && product.tags.length > 0)
          productInput.tags = product.tags;

        // Add product options if present
        if (product.options && product.options.length > 0) {
          productInput.productOptions = product.options.map((opt) => ({
            name: opt.name,
            position: opt.position,
            values: opt.values.map((v) => ({ name: v })),
          }));
        }

        // Prepare media parameter separately (not in productInput)
        const mediaParam: any[] = [];
        if (product.media && product.media.length > 0 && fileIndex) {
          for (const m of product.media) {
            // Use destination URL for media (not GID)
            const destUrl = fileIndex.gidToUrl.get(m.id);
            if (destUrl) {
              mediaParam.push({
                mediaContentType:
                  m.mediaType === "MediaImage" ? "IMAGE" : "VIDEO",
                alt: m.alt || "",
                originalSource: destUrl,
              });
            }
          }
        }

        const variables: any = {
          product: productInput,
        };

        if (mediaParam.length > 0) {
          variables.media = mediaParam;
        }

        const result = await client.request({
          query: PRODUCT_CREATE,
          variables,
        });

        if (!result.ok) {
          stats.failed++;
          stats.errors.push({
            handle: product.handle,
            error: result.error.message,
          });
          logger.warn(`Failed to create product ${product.handle}`, {
            error: result.error.message,
          });
          continue;
        }

        const response = result.data.data?.productCreate;
        if (response?.userErrors && response.userErrors.length > 0) {
          stats.failed++;
          const errorMsg = response.userErrors
            .map((e: any) => e.message)
            .join(", ");
          stats.errors.push({ handle: product.handle, error: errorMsg });
          logger.warn(`Product create user errors for ${product.handle}`, {
            errors: response.userErrors,
          });
          continue;
        }

        const createdProductId = response?.product?.id;
        if (!createdProductId) {
          stats.failed++;
          stats.errors.push({
            handle: product.handle,
            error: "No product ID returned",
          });
          logger.warn(`No product ID returned for ${product.handle}`);
          continue;
        }

        stats.created++;
        logger.debug(`✓ Created product: ${product.handle}`);

        // Sync publications for newly created product
        if (product.publications) {
          const pubResult = await syncPublications(
            client,
            createdProductId,
            product.publications,
            index,
            product.handle
          );
          if (pubResult.synced > 0) {
            stats.publicationsSynced = (stats.publicationsSynced || 0) + 1;
          }
          if (pubResult.errors.length > 0) {
            stats.publicationErrors = (stats.publicationErrors || 0) + 1;
          }
        }

        // Queue variants for later processing (after index rebuild)
        if (product.variants && product.variants.length > 0) {
          const hasRealVariants =
            product.variants.length > 1 ||
            (product.variants[0] &&
              product.variants[0].selectedOptions &&
              product.variants[0].selectedOptions.length > 0);

          if (hasRealVariants) {
            productsNeedingVariants.push({
              product,
              productId: createdProductId,
            });
          }
        }
      }
    } catch (err) {
      stats.failed++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      stats.errors.push({ handle: "unknown", error: errorMsg });
      logger.warn("Error applying product", { error: errorMsg });
    }
  }

  // Complete the progress bar
  progressBar.complete();

  logger.info(
    `✓ Applied ${stats.total} products: ${stats.created} created, ${stats.updated} updated, ${stats.failed} failed`
  );
  if (stats.publicationsSynced) {
    logger.info(
      `  Publications synced: ${stats.publicationsSynced} products${
        stats.publicationErrors ? ` (${stats.publicationErrors} errors)` : ""
      }`
    );
  }

  // Phase 2: Rebuild index once and process all variants
  if (productsNeedingVariants.length > 0) {
    logger.info(
      `Rebuilding index to process variants for ${productsNeedingVariants.length} products...`
    );
    index = await buildDestinationIndex(client);

    logger.info(
      `Processing variants for ${productsNeedingVariants.length} products...`
    );

    // Create progress bar for variant processing
    const variantProgressBar = createProgressBar(
      productsNeedingVariants.length,
      {
        format: "Variants :bar :percent (:current/:total) :eta",
      }
    );

    for (const { product, productId } of productsNeedingVariants) {
      variantProgressBar.tick();

      try {
        const variantsToUpdate: any[] = [];
        const variantsToCreate: any[] = [];

        for (const v of product.variants) {
          const variantInput: any = {
            price: v.price || "0.00",
          };

          // Add optional fields at variant level
          if (v.compareAtPrice) variantInput.compareAtPrice = v.compareAtPrice;
          if (v.barcode) variantInput.barcode = v.barcode;
          if (v.taxable !== undefined) variantInput.taxable = v.taxable;
          if (v.inventoryPolicy)
            variantInput.inventoryPolicy = v.inventoryPolicy;

          // Build inventoryItem object for SKU, tracking, and weight
          const inventoryItem: any = {};
          if (v.sku) inventoryItem.sku = v.sku;
          if (v.inventoryItem?.tracked !== undefined) {
            inventoryItem.tracked = v.inventoryItem.tracked;
          }
          if (v.inventoryItem?.measurement?.weight) {
            inventoryItem.measurement = {
              weight: {
                value: v.inventoryItem.measurement.weight.value,
                unit: v.inventoryItem.measurement.weight.unit.toUpperCase(),
              },
            };
          }
          if (Object.keys(inventoryItem).length > 0) {
            variantInput.inventoryItem = inventoryItem;
          }

          if (v.selectedOptions && v.selectedOptions.length > 0) {
            variantInput.optionValues = v.selectedOptions.map((opt) => ({
              optionName: opt.name,
              name: opt.value,
            }));
          }

          // Check if variant exists in destination
          // Try both SKU and position keys since Shopify may auto-create variants without SKU
          let existingVariantGid: string | undefined;
          if (v.sku) {
            existingVariantGid = gidForVariant(index, product.handle, v.sku);
          }
          if (!existingVariantGid && v.position) {
            existingVariantGid = gidForVariant(
              index,
              product.handle,
              `pos${v.position}`
            );
          }

          if (existingVariantGid) {
            // Variant exists - add to update list with ID
            variantInput.id = existingVariantGid;
            variantsToUpdate.push(variantInput);
          } else {
            // Variant doesn't exist - add to create list
            variantsToCreate.push(variantInput);
          }
        }

        // Update existing variants
        if (variantsToUpdate.length > 0) {
          const updateResult = await client.request({
            query: PRODUCT_VARIANT_BULK_UPDATE,
            variables: {
              productId: productId,
              variants: variantsToUpdate,
            },
          });

          if (!updateResult.ok) {
            logger.warn(
              `Failed to update variants for product ${product.handle}`,
              {
                error: updateResult.error.message,
              }
            );
          } else {
            const updateResponse =
              updateResult.data.data?.productVariantsBulkUpdate;
            if (
              updateResponse?.userErrors &&
              updateResponse.userErrors.length > 0
            ) {
              logger.warn(`Variant update user errors for ${product.handle}`, {
                errors: updateResponse.userErrors,
              });
            } else {
              logger.debug(
                `✓ Updated ${variantsToUpdate.length} variants for ${product.handle}`
              );
            }
          }
        }

        // Create new variants
        if (variantsToCreate.length > 0) {
          const createResult = await client.request({
            query: PRODUCT_VARIANT_BULK_CREATE,
            variables: {
              productId: productId,
              variants: variantsToCreate,
            },
          });

          if (!createResult.ok) {
            logger.warn(
              `Failed to create new variants for product ${product.handle}`,
              {
                error: createResult.error.message,
              }
            );
          } else {
            const createResponse =
              createResult.data.data?.productVariantsBulkCreate;
            if (
              createResponse?.userErrors &&
              createResponse.userErrors.length > 0
            ) {
              logger.warn(
                `Variant creation user errors for ${product.handle}`,
                {
                  errors: createResponse.userErrors,
                }
              );
            } else {
              logger.debug(
                `✓ Created ${variantsToCreate.length} new variants for ${product.handle}`
              );
            }
          }
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        logger.warn(`Error processing variants for ${product.handle}`, {
          error: errorMsg,
        });
      }
    }

    // Complete the variant progress bar
    variantProgressBar.complete();

    logger.info(
      `✓ Processed variants for ${productsNeedingVariants.length} products`
    );
  }

  return ok(stats);
}

// ============================================================================
// Apply Collections
// ============================================================================

/**
 * Apply collections (create/update collection data).
 * This creates collections that don't exist and updates basic fields for existing collections.
 */
export async function applyCollections(
  client: GraphQLClient,
  inputFile: string,
  index: DestinationIndex
): Promise<Result<ApplyStats, Error>> {
  logger.info("=== Applying Collections ===");

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

  // Create progress bar for collection processing
  const progressBar = createProgressBar(lines.length, {
    format: "Collections :bar :percent (:current/:total) :eta",
  });

  for (const line of lines) {
    stats.total++;
    progressBar.tick();

    try {
      const collection = JSON.parse(line) as DumpedCollection;
      const existingCollectionGid = gidForCollectionHandle(
        index,
        collection.handle
      );

      // Ensure title is not null or empty - use handle as fallback
      const collectionTitle =
        collection.title && collection.title.trim()
          ? collection.title
          : collection.handle
              .split("-")
              .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
              .join(" ");

      if (existingCollectionGid) {
        // Collection exists - update it
        const updateInput: any = {
          id: existingCollectionGid,
          title: collectionTitle,
          descriptionHtml: collection.descriptionHtml || "",
        };

        // Include ruleSet if present (for automated collections)
        if (collection.ruleSet) {
          updateInput.ruleSet = collection.ruleSet;
        }

        const result = await client.request({
          query: COLLECTION_UPDATE,
          variables: {
            input: updateInput,
          },
        });

        if (!result.ok) {
          stats.failed++;
          stats.errors.push({
            handle: collection.handle,
            error: result.error.message,
          });
          logger.warn(`Failed to update collection ${collection.handle}`, {
            error: result.error.message,
          });
          continue;
        }

        const response = result.data.data?.collectionUpdate;
        if (response?.userErrors && response.userErrors.length > 0) {
          stats.failed++;
          const errorMsg = response.userErrors
            .map((e: any) => e.message)
            .join(", ");
          stats.errors.push({ handle: collection.handle, error: errorMsg });
          logger.warn(
            `Collection update user errors for ${collection.handle}`,
            {
              errors: response.userErrors,
            }
          );
          continue;
        }

        stats.updated++;
        logger.debug(`✓ Updated collection: ${collection.handle}`);

        // Sync publications for updated collection
        if (collection.publications) {
          const pubResult = await syncPublications(
            client,
            existingCollectionGid,
            collection.publications,
            index,
            collection.handle
          );
          if (pubResult.synced > 0) {
            stats.publicationsSynced = (stats.publicationsSynced || 0) + 1;
          }
          if (pubResult.errors.length > 0) {
            stats.publicationErrors = (stats.publicationErrors || 0) + 1;
          }
        }
      } else {
        // Collection doesn't exist - create it
        const createInput: any = {
          title: collectionTitle,
          handle: collection.handle,
          descriptionHtml: collection.descriptionHtml || "",
        };

        // Include ruleSet if present (for automated collections)
        if (collection.ruleSet) {
          createInput.ruleSet = collection.ruleSet;
        }

        const result = await client.request({
          query: COLLECTION_CREATE,
          variables: {
            input: createInput,
          },
        });

        if (!result.ok) {
          stats.failed++;
          stats.errors.push({
            handle: collection.handle,
            error: result.error.message,
          });
          logger.warn(`Failed to create collection ${collection.handle}`, {
            error: result.error.message,
          });
          continue;
        }

        const response = result.data.data?.collectionCreate;
        if (response?.userErrors && response.userErrors.length > 0) {
          stats.failed++;
          const errorMsg = response.userErrors
            .map((e: any) => e.message)
            .join(", ");
          stats.errors.push({ handle: collection.handle, error: errorMsg });
          logger.warn(
            `Collection create user errors for ${collection.handle}`,
            {
              errors: response.userErrors,
            }
          );
          continue;
        }

        stats.created++;
        logger.debug(`✓ Created collection: ${collection.handle}`);

        const createdCollectionId = response?.collection?.id;

        // Sync publications for newly created collection
        if (createdCollectionId && collection.publications) {
          const pubResult = await syncPublications(
            client,
            createdCollectionId,
            collection.publications,
            index,
            collection.handle
          );
          if (pubResult.synced > 0) {
            stats.publicationsSynced = (stats.publicationsSynced || 0) + 1;
          }
          if (pubResult.errors.length > 0) {
            stats.publicationErrors = (stats.publicationErrors || 0) + 1;
          }
        }
      }
    } catch (err) {
      stats.failed++;
      const errorMsg = err instanceof Error ? err.message : String(err);
      stats.errors.push({ handle: "unknown", error: errorMsg });
      logger.warn("Error applying collection", { error: errorMsg });
    }
  }

  // Complete the progress bar
  progressBar.complete();

  logger.info(
    `✓ Applied ${stats.total} collections: ${stats.created} created, ${stats.updated} updated, ${stats.failed} failed`
  );
  if (stats.publicationsSynced) {
    logger.info(
      `  Publications synced: ${stats.publicationsSynced} collections${
        stats.publicationErrors ? ` (${stats.publicationErrors} errors)` : ""
      }`
    );
  }

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

  // Create progress bar for page processing
  const progressBar = createProgressBar(lines.length, {
    format: "Pages :bar :percent (:current/:total) :eta",
  });

  for (const line of lines) {
    stats.total++;
    progressBar.tick();

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
              templateSuffix: page.templateSuffix || null,
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
              templateSuffix: page.templateSuffix || null,
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

  // Complete the progress bar
  progressBar.complete();

  logger.info(
    `✓ Applied ${stats.created + stats.updated} pages (${
      stats.created
    } created, ${stats.updated} updated, ${stats.failed} failed)`
  );
  return ok(stats);
}

// ============================================================================
// Apply Blogs
// ============================================================================

/**
 * Apply blogs (create/update blog entries).
 * Blogs are created or updated by handle.
 */
export async function applyBlogs(
  client: GraphQLClient,
  inputFile: string,
  index: DestinationIndex
): Promise<Result<ApplyStats, Error>> {
  logger.info("=== Applying Blogs ===");

  const stats: ApplyStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (!fs.existsSync(inputFile)) {
    logger.warn(`Blogs dump not found: ${inputFile}`);
    return ok(stats);
  }

  const content = fs.readFileSync(inputFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  // Create progress bar for blog processing
  const progressBar = createProgressBar(lines.length, {
    format: "Blogs :bar :percent (:current/:total) :eta",
  });

  for (const line of lines) {
    stats.total++;
    progressBar.tick();
    try {
      const blog = JSON.parse(line) as DumpedBlog;

      const existingGid = gidForBlogHandle(index, blog.handle);

      if (existingGid) {
        // Blog exists - update it
        const result = await client.request({
          query: BLOG_UPDATE,
          variables: {
            id: existingGid,
            blog: {
              title: blog.title,
              templateSuffix: blog.templateSuffix || null,
            },
          },
        });

        if (!result.ok) {
          stats.failed++;
          stats.errors.push({
            handle: blog.handle,
            error: result.error.message,
          });
          logger.warn(`Failed to update blog ${blog.handle}`, {
            error: result.error.message,
          });
          continue;
        }

        const response = result.data.data?.blogUpdate;
        if (response?.userErrors && response.userErrors.length > 0) {
          stats.failed++;
          const errorMsg = response.userErrors
            .map((e: any) => e.message)
            .join(", ");
          stats.errors.push({ handle: blog.handle, error: errorMsg });
          logger.warn(`Blog update user errors for ${blog.handle}`, {
            errors: response.userErrors,
          });
          continue;
        }

        stats.updated++;
        logger.debug(`✓ Updated blog: ${blog.handle}`);
      } else {
        // Blog doesn't exist - create it
        const result = await client.request({
          query: BLOG_CREATE,
          variables: {
            blog: {
              title: blog.title,
              handle: blog.handle,
              templateSuffix: blog.templateSuffix || null,
            },
          },
        });

        if (!result.ok) {
          stats.failed++;
          stats.errors.push({
            handle: blog.handle,
            error: result.error.message,
          });
          logger.warn(`Failed to create blog ${blog.handle}`, {
            error: result.error.message,
          });
          continue;
        }

        const response = result.data.data?.blogCreate;
        if (response?.userErrors && response.userErrors.length > 0) {
          stats.failed++;
          const errorMsg = response.userErrors
            .map((e: any) => e.message)
            .join(", ");
          stats.errors.push({ handle: blog.handle, error: errorMsg });
          logger.warn(`Blog create user errors for ${blog.handle}`, {
            errors: response.userErrors,
          });
          continue;
        }

        stats.created++;

        // Add newly created blog to index for subsequent operations
        if (response?.blog?.id) {
          index.blogs.set(blog.handle, response.blog.id);
        }

        logger.debug(`✓ Created blog: ${blog.handle}`);
      }
    } catch (error) {
      stats.failed++;
      stats.errors.push({ error: String(error) });
      logger.warn("Failed to process blog line", { error: String(error) });
    }
  }

  // Complete the progress bar
  progressBar.complete();

  logger.info(
    `✓ Applied ${stats.created + stats.updated} blogs (${
      stats.created
    } created, ${stats.updated} updated, ${stats.failed} failed)`
  );
  return ok(stats);
}

// ============================================================================
// Apply Articles
// ============================================================================

/**
 * Apply articles (create/update article entries).
 * Articles belong to blogs and are identified by {blogHandle}:{articleHandle}.
 */
export async function applyArticles(
  client: GraphQLClient,
  inputFile: string,
  index: DestinationIndex
): Promise<Result<ApplyStats, Error>> {
  logger.info("=== Applying Articles ===");

  const stats: ApplyStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (!fs.existsSync(inputFile)) {
    logger.warn(`Articles dump not found: ${inputFile}`);
    return ok(stats);
  }

  const content = fs.readFileSync(inputFile, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  // Create progress bar for article processing
  const progressBar = createProgressBar(lines.length, {
    format: "Articles :bar :percent (:current/:total) :eta",
  });

  for (const line of lines) {
    stats.total++;
    progressBar.tick();
    try {
      const article = JSON.parse(line) as DumpedArticle;

      // Resolve blog GID from blogHandle
      const blogGid = gidForBlogHandle(index, article.blogHandle);
      if (!blogGid) {
        stats.failed++;
        stats.errors.push({
          handle: `${article.blogHandle}:${article.handle}`,
          error: `Blog not found: ${article.blogHandle}`,
        });
        logger.warn(
          `Cannot create article ${article.handle} - blog ${article.blogHandle} not found`
        );
        continue;
      }

      const existingGid = gidForArticle(
        index,
        article.blogHandle,
        article.handle
      );

      if (existingGid) {
        // Article exists - update it
        const articleInput: any = {
          title: article.title,
          body: article.body || "",
          tags: article.tags || [],
          templateSuffix: article.templateSuffix || null,
        };

        // Author is an object with a name property
        if (article.author) {
          articleInput.author = { name: article.author };
        }

        // Add image if present
        if (article.image) {
          articleInput.image = article.image;
        }

        const result = await client.request({
          query: ARTICLE_UPDATE,
          variables: {
            id: existingGid,
            article: articleInput,
          },
        });

        if (!result.ok) {
          stats.failed++;
          stats.errors.push({
            handle: `${article.blogHandle}:${article.handle}`,
            error: result.error.message,
          });
          logger.warn(
            `Failed to update article ${article.blogHandle}:${article.handle}`,
            {
              error: result.error.message,
            }
          );
          continue;
        }

        const response = result.data.data?.articleUpdate;
        if (response?.userErrors && response.userErrors.length > 0) {
          stats.failed++;
          const errorMsg = response.userErrors
            .map((e: any) => e.message)
            .join(", ");
          stats.errors.push({
            handle: `${article.blogHandle}:${article.handle}`,
            error: errorMsg,
          });
          logger.warn(
            `Article update user errors for ${article.blogHandle}:${article.handle}`,
            {
              errors: response.userErrors,
            }
          );
          continue;
        }

        stats.updated++;
        logger.debug(
          `✓ Updated article: ${article.blogHandle}:${article.handle}`
        );
      } else {
        // Article doesn't exist - create it
        const articleInput: any = {
          blogId: blogGid,
          title: article.title,
          handle: article.handle,
          body: article.body || "",
          // Author is required - use stored value or default to "Staff"
          author: article.author ? { name: article.author } : { name: "Staff" },
          tags: article.tags || [],
          publishedAt: article.publishedAt,
          templateSuffix: article.templateSuffix || null,
        };

        // Add image if present
        if (article.image) {
          articleInput.image = article.image;
        }

        const result = await client.request({
          query: ARTICLE_CREATE,
          variables: {
            article: articleInput,
          },
        });

        if (!result.ok) {
          stats.failed++;
          stats.errors.push({
            handle: `${article.blogHandle}:${article.handle}`,
            error: result.error.message,
          });
          logger.warn(
            `Failed to create article ${article.blogHandle}:${article.handle}`,
            {
              error: result.error.message,
            }
          );
          continue;
        }

        const response = result.data.data?.articleCreate;
        if (response?.userErrors && response.userErrors.length > 0) {
          stats.failed++;
          const errorMsg = response.userErrors
            .map((e: any) => e.message)
            .join(", ");
          stats.errors.push({
            handle: `${article.blogHandle}:${article.handle}`,
            error: errorMsg,
          });
          logger.warn(
            `Article create user errors for ${article.blogHandle}:${article.handle}`,
            {
              errors: response.userErrors,
            }
          );
          continue;
        }

        stats.created++;

        // Add newly created article to index for subsequent operations
        if (response?.article?.id) {
          const key = `${article.blogHandle}:${article.handle}`;
          index.articles.set(key, response.article.id);
        }

        logger.debug(
          `✓ Created article: ${article.blogHandle}:${article.handle}`
        );
      }
    } catch (error) {
      stats.failed++;
      stats.errors.push({ error: String(error) });
      logger.warn("Failed to process article line", { error: String(error) });
    }
  }

  // Complete the progress bar
  progressBar.complete();

  logger.info(
    `✓ Applied ${stats.created + stats.updated} articles (${
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
 * 3. Apply products (with variants and publications) - before metaobjects
 * 4. Apply collections (with publications) - before metaobjects
 * 5. Apply blogs - before articles
 * 6. Apply articles (with blog relationship) - before metaobjects
 * 7. Apply pages (create/update content) - before metaobjects
 * 8. Apply metaobjects (with remapped refs including files) - can now reference all resources
 * 9. Apply metafields to products, variants, collections, pages, blogs, articles, shop, metaobjects
 */
export interface ApplyOptions {
  productsOnly?: boolean;
  collectionsOnly?: boolean;
  metaobjectsOnly?: boolean;
  pagesOnly?: boolean;
  blogsOnly?: boolean;
  articlesOnly?: boolean;
  productMetafieldsOnly?: boolean;
}

export async function applyAllData(
  client: GraphQLClient,
  inputDir: string,
  options: ApplyOptions = {}
): Promise<
  Result<
    {
      metaobjects: ApplyStats;
      blogs: ApplyStats;
      articles: ApplyStats;
      pages: ApplyStats;
      metafields: ApplyStats;
      files: { uploaded: number; failed: number };
      products?: ApplyStats;
      collections?: ApplyStats;
    },
    Error
  >
> {
  logger.info("=== Starting Data Apply ===");

  // Determine what to apply
  const applyAll =
    !options.productsOnly &&
    !options.collectionsOnly &&
    !options.metaobjectsOnly &&
    !options.pagesOnly &&
    !options.blogsOnly &&
    !options.articlesOnly &&
    !options.productMetafieldsOnly;

  // Step 1: Build destination index
  logger.info("Step 1: Building destination index...");
  let index = await buildDestinationIndex(client);

  // Step 2: Apply files (BEFORE metaobjects so we can relink file references)
  let fileIndex: FileIndex = {
    urlToGid: new Map(),
    gidToGid: new Map(),
    gidToUrl: new Map(),
  };
  if (applyAll || options.metaobjectsOnly) {
    logger.info("Step 2: Applying files...");
    const filesFile = path.join(inputDir, "files.jsonl");
    const filesResult = await applyFiles(client, filesFile);

    if (!filesResult.ok) {
      logger.warn("Files apply failed, continuing without file relinking...");
    } else {
      fileIndex = filesResult.data;
    }
  }

  // Step 3: Apply products (before metaobjects so metaobjects can reference them)
  let productsResult: Result<ApplyStats, Error> | undefined;
  if (applyAll || options.productsOnly) {
    logger.info("Step 3: Applying products...");
    const productsFile = path.join(inputDir, "products.jsonl");
    productsResult = await applyProducts(
      client,
      productsFile,
      index,
      fileIndex
    );
    if (!productsResult.ok) {
      logger.warn("Products apply failed, continuing...");
    }

    // Rebuild index after creating products to ensure new products are mapped
    logger.info("Rebuilding index after product creation...");
    index = await buildDestinationIndex(client);
  }

  // Step 4: Apply collections (before metaobjects so metaobjects can reference them)
  let collectionsResult: Result<ApplyStats, Error> | undefined;
  if (applyAll || options.collectionsOnly) {
    logger.info("Step 4: Applying collections...");
    const collectionsFile = path.join(inputDir, "collections.jsonl");
    collectionsResult = await applyCollections(client, collectionsFile, index);
    if (!collectionsResult.ok) {
      logger.warn("Collections apply failed, continuing...");
    }

    // Rebuild index after creating collections to ensure new collections are mapped
    logger.info("Rebuilding index after collection creation...");
    index = await buildDestinationIndex(client);
  }

  // Step 5: Apply blogs (before articles and metaobjects)
  let blogsResult: Result<ApplyStats, Error>;
  if (applyAll || options.blogsOnly) {
    logger.info("Step 5: Applying blogs...");
    const blogsFile = path.join(inputDir, "blogs.jsonl");
    blogsResult = await applyBlogs(client, blogsFile, index);
    if (!blogsResult.ok) {
      logger.warn("Blogs apply failed, continuing...");
    }

    // Rebuild index after creating blogs to ensure new blogs are mapped
    logger.info("Rebuilding index after blog creation...");
    index = await buildDestinationIndex(client);
  } else {
    blogsResult = ok({
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    });
  }

  // Step 6: Apply articles (before metaobjects so metaobjects can reference them)
  let articlesResult: Result<ApplyStats, Error>;
  if (applyAll || options.articlesOnly) {
    logger.info("Step 6: Applying articles...");
    const articlesFile = path.join(inputDir, "articles.jsonl");
    articlesResult = await applyArticles(client, articlesFile, index);
    if (!articlesResult.ok) {
      logger.warn("Articles apply failed, continuing...");
    }

    // Rebuild index after creating articles to ensure new articles are mapped
    logger.info("Rebuilding index after article creation...");
    index = await buildDestinationIndex(client);
  } else {
    articlesResult = ok({
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    });
  }

  // Step 7: Apply pages (before metaobjects so metaobjects can reference them)
  let pagesResult: Result<ApplyStats, Error>;
  if (applyAll || options.pagesOnly) {
    logger.info("Step 7: Applying pages...");
    const pagesFile = path.join(inputDir, "pages.jsonl");
    pagesResult = await applyPages(client, pagesFile, index);
    if (!pagesResult.ok) {
      logger.warn("Pages apply failed, continuing...");
    }

    // Rebuild index after creating pages to ensure new pages are mapped
    logger.info("Rebuilding index after page creation...");
    index = await buildDestinationIndex(client);
  } else {
    pagesResult = ok({
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    });
  }

  // Step 8: Apply metaobjects (AFTER all resources so metaobjects can reference them)
  let metaobjectsResult: Result<ApplyStats, Error>;
  if (applyAll || options.metaobjectsOnly) {
    logger.info("Step 8: Applying metaobjects...");
    metaobjectsResult = await applyMetaobjects(
      client,
      inputDir,
      index,
      fileIndex
    );
    if (!metaobjectsResult.ok) {
      return err(metaobjectsResult.error);
    }
  } else {
    metaobjectsResult = ok({
      total: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    });
  }

  const finalIndex = index;

  // Step 9: Apply metafields (to all resources)
  const aggregateMetafields: ApplyStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  if (applyAll || options.productMetafieldsOnly) {
    logger.info("Step 9: Applying metafields...");

    // Products metafields
    if (applyAll || options.productMetafieldsOnly) {
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
    }

    // Collections metafields
    if (applyAll) {
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
    }

    // Pages metafields
    if (applyAll) {
      const pagesFile = path.join(inputDir, "pages.jsonl");
      const pageMfResult = await applyPageMetafields(
        client,
        pagesFile,
        finalIndex
      );
      if (pageMfResult.ok) {
        const stats = pageMfResult.data;
        aggregateMetafields.total += stats.total;
        aggregateMetafields.created += stats.created;
        aggregateMetafields.failed += stats.failed;
        aggregateMetafields.errors.push(...stats.errors);
      }
    }

    // Shop metafields
    if (applyAll) {
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
    }
  }

  const metaobjectsData = metaobjectsResult.ok
    ? metaobjectsResult.data
    : { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  const blogsData = blogsResult.ok
    ? blogsResult.data
    : { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  const articlesData = articlesResult.ok
    ? articlesResult.data
    : { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  const pagesData = pagesResult.ok
    ? pagesResult.data
    : { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, errors: [] };

  // Data apply complete - stats will be displayed as tables in CLI
  return ok({
    files: {
      uploaded: fileIndex.urlToGid.size,
      failed: 0, // TODO: track failed uploads
    },
    metaobjects: metaobjectsData,
    products: productsResult?.ok ? productsResult.data : undefined,
    collections: collectionsResult?.ok ? collectionsResult.data : undefined,
    blogs: blogsData,
    articles: articlesData,
    pages: pagesData,
    metafields: aggregateMetafields,
  });
}
