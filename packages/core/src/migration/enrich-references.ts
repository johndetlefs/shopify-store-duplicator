/**
 * Enrich metafield references with natural keys
 *
 * Purpose:
 * - Post-process dumped data to add natural keys to metafield references
 * - Shopify bulk API doesn't support nested connections (metafields > references)
 * - Parse GID strings from metafield values and resolve to handles
 *
 * Process:
 * 1. Build comprehensive GID→natural key mappings from all dumps
 * 2. Re-process all JSONL files with metafields
 * 3. For reference-type metafields, parse GIDs and look up natural keys
 * 4. Add refProduct/refCollection/refMetaobject/refList fields
 * 5. Overwrite files with enriched data
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../utils/logger.js";
import type { Result } from "../utils/types.js";

// ============================================================================
// Types
// ============================================================================

interface GidMapping {
  products: Map<string, string>; // GID → handle
  collections: Map<string, string>; // GID → handle
  pages: Map<string, string>; // GID → handle
  blogs: Map<string, string>; // GID → handle
  articles: Map<string, { blogHandle: string; handle: string }>; // GID → composite key
  metaobjects: Map<string, { type: string; handle: string }>; // GID → {type, handle}
  variants: Map<
    string,
    { productHandle: string; sku?: string; position: number }
  >; // GID → variant info
  files: Map<string, string>; // GID → url
}

interface Metafield {
  namespace: string;
  key: string;
  value: string;
  type: string;
  refProduct?: { handle: string };
  refCollection?: { handle: string };
  refPage?: { handle: string };
  refBlog?: { handle: string };
  refArticle?: { blogHandle: string; handle: string };
  refMetaobject?: { type: string; handle: string };
  refVariant?: { productHandle: string; sku?: string; position: number };
  refFile?: { url: string };
  refList?: Array<{
    type: string;
    handle?: string;
    metaobject?: { type: string; handle: string };
    product?: { handle: string };
    collection?: { handle: string };
    page?: { handle: string };
    file?: { url: string };
  }>;
}

// ============================================================================
// GID Mapping Functions
// ============================================================================

/**
 * Build GID→handle mapping from a JSONL file
 */
function buildGidMap(
  filePath: string,
  extractKey: (obj: any) => { gid: string; key: any }
): Map<string, any> {
  const map = new Map<string, any>();

  if (!fs.existsSync(filePath)) {
    logger.warn(`File not found: ${filePath}`);
    return map;
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const { gid, key } = extractKey(obj);
      if (gid && key) {
        map.set(gid, key);
      }
    } catch (err) {
      logger.warn(`Failed to parse line in ${filePath}:`, {
        error: String(err),
      });
    }
  }

  logger.info(`Built GID map from ${filePath}: ${map.size} entries`);
  return map;
}

/**
 * Build comprehensive GID mappings from all dump files
 */
export function buildGidMappings(dumpDir: string): GidMapping {
  logger.info("Building GID→natural key mappings...");

  // Products
  const products = buildGidMap(path.join(dumpDir, "products.jsonl"), (obj) => ({
    gid: obj.id,
    key: obj.handle,
  }));

  // Collections
  const collections = buildGidMap(
    path.join(dumpDir, "collections.jsonl"),
    (obj) => ({ gid: obj.id, key: obj.handle })
  );

  // Pages
  const pages = buildGidMap(path.join(dumpDir, "pages.jsonl"), (obj) => ({
    gid: obj.id,
    key: obj.handle,
  }));

  // Blogs
  const blogs = buildGidMap(path.join(dumpDir, "blogs.jsonl"), (obj) => ({
    gid: obj.id,
    key: obj.handle,
  }));

  // Articles
  const articles = buildGidMap(path.join(dumpDir, "articles.jsonl"), (obj) => ({
    gid: obj.id,
    key: { blogHandle: obj.blogHandle, handle: obj.handle },
  }));

  // Metaobjects (all types)
  const metaobjects = new Map<string, { type: string; handle: string }>();
  const metaobjectFiles = fs
    .readdirSync(dumpDir)
    .filter((f) => f.startsWith("metaobjects-") && f.endsWith(".jsonl"));

  for (const file of metaobjectFiles) {
    const typeMap = buildGidMap(path.join(dumpDir, file), (obj) => ({
      gid: obj.id,
      key: { type: obj.type, handle: obj.handle },
    }));
    typeMap.forEach((value, key) => metaobjects.set(key, value));
  }

  logger.info(`Built metaobjects map: ${metaobjects.size} entries`);

  // Variants (from products)
  const variants = new Map<
    string,
    { productHandle: string; sku?: string; position: number }
  >();
  if (fs.existsSync(path.join(dumpDir, "products.jsonl"))) {
    const content = fs.readFileSync(
      path.join(dumpDir, "products.jsonl"),
      "utf-8"
    );
    const lines = content.split("\n").filter((line) => line.trim());

    for (const line of lines) {
      try {
        const product = JSON.parse(line);
        if (product.variants) {
          for (const variant of product.variants) {
            variants.set(variant.id, {
              productHandle: product.handle,
              sku: variant.sku,
              position: variant.position,
            });
          }
        }
      } catch (err) {
        // Skip
      }
    }
  }

  logger.info(`Built variants map: ${variants.size} entries`);

  // Files
  const files = buildGidMap(path.join(dumpDir, "files.jsonl"), (obj) => ({
    gid: obj.id,
    key: obj.url || obj.src,
  }));

  return {
    products,
    collections,
    pages,
    blogs,
    articles,
    metaobjects,
    variants,
    files,
  };
}

// ============================================================================
// Reference Enrichment Functions
// ============================================================================

/**
 * Extract GID type from GID string (e.g., "gid://shopify/Product/123" → "Product")
 */
function extractGidType(gid: string): string {
  if (!gid || typeof gid !== "string") return "";
  const match = gid.match(/gid:\/\/shopify\/([^\/]+)\//);
  return match ? match[1] : "";
}

/**
 * Enrich a single metafield with natural keys
 */
function enrichMetafield(
  metafield: Metafield,
  mappings: GidMapping
): Metafield {
  const enriched = { ...metafield };

  // Skip if not a reference type
  if (!metafield.type.includes("reference")) {
    return enriched;
  }

  try {
    // List references
    if (metafield.type.startsWith("list.")) {
      const gids = JSON.parse(metafield.value) as string[];
      enriched.refList = gids.map((gid) => {
        const type = extractGidType(gid);
        const entry: any = { type };

        switch (type) {
          case "Product":
            const productHandle = mappings.products.get(gid);
            if (productHandle) {
              entry.productHandle = productHandle;
            }
            break;

          case "Collection":
            const collectionHandle = mappings.collections.get(gid);
            if (collectionHandle) {
              entry.collectionHandle = collectionHandle;
            }
            break;

          case "Page":
            const pageHandle = mappings.pages.get(gid);
            if (pageHandle) {
              entry.pageHandle = pageHandle;
            }
            break;

          case "Metaobject":
            const moData = mappings.metaobjects.get(gid);
            if (moData) {
              entry.metaobjectType = moData.type;
              entry.metaobjectHandle = moData.handle;
            }
            break;

          case "MediaImage":
          case "GenericFile":
          case "Video":
            const fileUrl = mappings.files.get(gid);
            if (fileUrl) {
              entry.fileUrl = fileUrl;
            }
            break;

          case "ProductVariant":
            const variantData = mappings.variants.get(gid);
            if (variantData) {
              entry.variantProductHandle = variantData.productHandle;
              entry.variantSku = variantData.sku;
              entry.variantPosition = variantData.position;
            }
            break;
        }

        return entry;
      });
    }
    // Single reference
    else {
      const gid = metafield.value;
      const type = extractGidType(gid);

      switch (type) {
        case "Product":
          const productHandle = mappings.products.get(gid);
          if (productHandle) {
            enriched.refProduct = { handle: productHandle };
          }
          break;

        case "Collection":
          const collectionHandle = mappings.collections.get(gid);
          if (collectionHandle) {
            enriched.refCollection = { handle: collectionHandle };
          }
          break;

        case "Page":
          const pageHandle = mappings.pages.get(gid);
          if (pageHandle) {
            enriched.refPage = { handle: pageHandle };
          }
          break;

        case "Blog":
          const blogHandle = mappings.blogs.get(gid);
          if (blogHandle) {
            enriched.refBlog = { handle: blogHandle };
          }
          break;

        case "Article":
          const articleData = mappings.articles.get(gid);
          if (articleData) {
            enriched.refArticle = articleData;
          }
          break;

        case "Metaobject":
          const moData = mappings.metaobjects.get(gid);
          if (moData) {
            enriched.refMetaobject = moData;
          }
          break;

        case "ProductVariant":
          const variantData = mappings.variants.get(gid);
          if (variantData) {
            enriched.refVariant = variantData;
          }
          break;

        case "MediaImage":
        case "GenericFile":
        case "Video":
          const fileUrl = mappings.files.get(gid);
          if (fileUrl) {
            enriched.refFile = { url: fileUrl };
          }
          break;
      }
    }
  } catch (err) {
    logger.warn(
      `Failed to enrich metafield ${metafield.namespace}:${metafield.key}`,
      {
        error: String(err),
        value: metafield.value?.substring(0, 100),
      }
    );
  }

  return enriched;
}

/**
 * Enrich all metafields in an object
 */
function enrichObject(obj: any, mappings: GidMapping): any {
  const enriched = { ...obj };

  // Enrich direct metafields
  if (enriched.metafields && Array.isArray(enriched.metafields)) {
    enriched.metafields = enriched.metafields.map((mf: Metafield) =>
      enrichMetafield(mf, mappings)
    );
  }

  // Enrich variant metafields (for products)
  if (enriched.variants && Array.isArray(enriched.variants)) {
    enriched.variants = enriched.variants.map((variant: any) => {
      if (variant.metafields && Array.isArray(variant.metafields)) {
        return {
          ...variant,
          metafields: variant.metafields.map((mf: Metafield) =>
            enrichMetafield(mf, mappings)
          ),
        };
      }
      return variant;
    });
  }

  // Enrich metaobject fields
  if (enriched.fields && Array.isArray(enriched.fields)) {
    enriched.fields = enriched.fields.map((field: any) => {
      // Skip non-reference fields
      if (!field.type?.includes("reference")) {
        return field;
      }

      const enrichedField = { ...field };

      try {
        // List references
        if (field.type.startsWith("list.")) {
          const gids = JSON.parse(field.value) as string[];
          enrichedField.refList = gids.map((gid: string) => {
            const type = extractGidType(gid);
            const entry: any = { type };

            switch (type) {
              case "Product":
                const productHandle = mappings.products.get(gid);
                if (productHandle) entry.productHandle = productHandle;
                break;
              case "Collection":
                const collectionHandle = mappings.collections.get(gid);
                if (collectionHandle) entry.collectionHandle = collectionHandle;
                break;
              case "Page":
                const pageHandle = mappings.pages.get(gid);
                if (pageHandle) entry.pageHandle = pageHandle;
                break;
              case "Metaobject":
                const moData = mappings.metaobjects.get(gid);
                if (moData) {
                  entry.metaobjectType = moData.type;
                  entry.metaobjectHandle = moData.handle;
                }
                break;
              case "MediaImage":
              case "GenericFile":
              case "Video":
                const fileUrl = mappings.files.get(gid);
                if (fileUrl) entry.fileUrl = fileUrl;
                break;
              // For types without natural keys (e.g., TaxonomyValue), keep the GID
              default:
                entry.gid = gid;
                break;
            }

            return entry;
          });
        }
        // Single reference
        else {
          const gid = field.value;
          if (!gid || typeof gid !== "string") {
            return enrichedField;
          }

          const type = extractGidType(gid);

          switch (type) {
            case "Product":
              const productHandle = mappings.products.get(gid);
              if (productHandle)
                enrichedField.refProduct = { handle: productHandle };
              break;
            case "Collection":
              const collectionHandle = mappings.collections.get(gid);
              if (collectionHandle)
                enrichedField.refCollection = { handle: collectionHandle };
              break;
            case "Page":
              const pageHandle = mappings.pages.get(gid);
              if (pageHandle) enrichedField.refPage = { handle: pageHandle };
              break;
            case "Metaobject":
              const moData = mappings.metaobjects.get(gid);
              if (moData) enrichedField.refMetaobject = moData;
              break;
            case "MediaImage":
            case "GenericFile":
            case "Video":
              const fileUrl = mappings.files.get(gid);
              if (fileUrl) enrichedField.refFile = { url: fileUrl };
              break;
          }
        }
      } catch (err) {
        logger.warn(`Failed to enrich field ${field.key}`, {
          error: String(err),
          value: field.value?.substring(0, 100),
        });
      }

      return enrichedField;
    });
  }

  return enriched;
}

/**
 * Enrich references in a JSONL file
 */
function enrichJsonlFile(
  filePath: string,
  mappings: GidMapping
): { enriched: number; total: number } {
  if (!fs.existsSync(filePath)) {
    return { enriched: 0, total: 0 };
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((line) => line.trim());
  const enrichedLines: string[] = [];

  let enrichedCount = 0;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      const before = JSON.stringify(obj);
      const enriched = enrichObject(obj, mappings);
      const after = JSON.stringify(enriched);

      if (before !== after) {
        enrichedCount++;
      }

      enrichedLines.push(JSON.stringify(enriched));
    } catch (err) {
      logger.warn(`Failed to process line in ${filePath}:`, {
        error: String(err),
      });
      enrichedLines.push(line); // Keep original on error
    }
  }

  // Write back
  fs.writeFileSync(filePath, enrichedLines.join("\n"), "utf-8");

  return { enriched: enrichedCount, total: lines.length };
}

// ============================================================================
// Main Entry Point
// ============================================================================

/**
 * Enrich all references in all dump files
 */
export async function enrichAllReferences(
  dumpDir: string
): Promise<Result<void, Error>> {
  logger.info("=== Enriching References with Natural Keys ===");

  try {
    // Build mappings
    const mappings = buildGidMappings(dumpDir);

    // List of files to enrich
    const filesToEnrich = [
      "products.jsonl",
      "collections.jsonl",
      "pages.jsonl",
      "blogs.jsonl",
      "articles.jsonl",
      "shop-metafields.jsonl",
    ];

    // Add all metaobject files
    const metaobjectFiles = fs
      .readdirSync(dumpDir)
      .filter((f) => f.startsWith("metaobjects-") && f.endsWith(".jsonl"));
    filesToEnrich.push(...metaobjectFiles);

    // Enrich each file
    let totalEnriched = 0;
    let totalProcessed = 0;

    for (const file of filesToEnrich) {
      const filePath = path.join(dumpDir, file);
      const result = enrichJsonlFile(filePath, mappings);
      totalEnriched += result.enriched;
      totalProcessed += result.total;

      if (result.enriched > 0) {
        logger.info(
          `✓ Enriched ${file}: ${result.enriched}/${result.total} records updated`
        );
      }
    }

    logger.info(
      `✓ Reference enrichment complete: ${totalEnriched}/${totalProcessed} total records updated`
    );

    return { ok: true, data: undefined };
  } catch (error) {
    logger.error("Failed to enrich references:", { error: String(error) });
    return {
      ok: false,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
}
