/**
 * Data dump operations: export metaobjects, products, collections, variants, pages, articles, blogs.
 *
 * Purpose:
 * - Extract all custom data from source store using bulk operations
 * - Preserve natural keys (handles) for deterministic remapping
 * - Export to JSONL format for efficient storage and streaming
 *
 * Output Format:
 * - Each entity type saved to separate JSONL file
 * - References preserved with both GID and natural key (handle/type/sku)
 * - Metafields extracted and saved with owner references
 *
 * Idempotency:
 * - Safe to re-run; overwrites previous dump files
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { runBulkQueryAndDownload } from "../bulk/runner.js";
import {
  METAOBJECTS_BY_TYPE_BULK,
  PRODUCTS_BULK,
  COLLECTIONS_BULK,
  PAGES_BULK,
  SHOP_BULK,
  BLOGS_BULK,
  ARTICLES_BULK,
  METAOBJECT_DEFINITIONS_QUERY,
} from "../graphql/queries.js";
import { GraphQLClient } from "../graphql/client.js";
import { logger } from "../utils/logger.js";
import { err, type Result } from "../utils/types.js";
import { dumpFiles } from "../files/dump.js";
import { enrichAllReferences } from "./enrich-references.js";

// ============================================================================
// Types
// ============================================================================

interface MetaobjectEntry {
  id: string;
  handle: string;
  type: string;
  displayName?: string;
  updatedAt?: string;
  fields: MetaobjectField[];
}

interface MetaobjectField {
  key: string;
  type: string;
  value: string | null;
  reference?: Reference;
  references?: Reference[];
}

interface Reference {
  __typename: string;
  id: string;
  handle?: string;
  type?: string; // for Metaobject
  sku?: string; // for ProductVariant
  productHandle?: string; // for ProductVariant
  url?: string; // for files
}

interface ProductNode {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string;
  status: string;
  metafields?: MetafieldEdge[];
  variants?: VariantEdge[];
}

interface VariantEdge {
  node: {
    id: string;
    sku?: string;
    title: string;
    position: number;
    metafields?: MetafieldEdge[];
  };
}

interface MetafieldEdge {
  node: {
    id: string;
    namespace: string;
    key: string;
    value: string;
    type: string;
    reference?: Reference;
    references?: { edges: { node: Reference }[] };
  };
}

interface CollectionNode {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string;
  metafields?: MetafieldEdge[];
}

interface PageNode {
  id: string;
  handle: string;
  title: string;
  body?: string;
  bodySummary?: string;
  metafields?: MetafieldEdge[];
}

interface BlogNode {
  id: string;
  handle: string;
  title: string;
  metafields?: MetafieldEdge[];
}

interface ArticleNode {
  id: string;
  handle: string;
  title: string;
  body?: string;
  blog: {
    handle: string;
  };
  metafields?: MetafieldEdge[];
}

interface MetaobjectDefinitionNode {
  id: string;
  name: string;
  type: string;
}

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
    blogHandle?: string;
    articleHandle?: string;
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
    collectionHandle?: string;
    pageHandle?: string;
    blogHandle?: string;
    articleHandle?: string;
  }>;
}

interface DumpedCollection {
  id: string;
  handle: string;
  title: string;
  descriptionHtml?: string;
  ruleSet?: any; // Collection rules for automated collections
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

interface DumpedBlog {
  id: string;
  handle: string;
  title: string;
  metafields: DumpedMetafield[];
}

interface DumpedArticle {
  id: string;
  handle: string;
  title: string;
  body?: string;
  blogHandle: string;
  metafields: DumpedMetafield[];
}

// ============================================================================
// Helpers: Extract Natural Keys from References
// ============================================================================

/**
 * Extract natural key from a single reference
 */
function extractReferenceKey(ref: Reference | undefined): Partial<DumpedField> {
  const field: Partial<DumpedField> = {};

  if (!ref) return field;

  switch (ref.__typename) {
    case "Metaobject":
      if (ref.type && ref.handle) {
        field.refMetaobject = { type: ref.type, handle: ref.handle };
      }
      break;
    case "Product":
      if (ref.handle) {
        field.refProduct = { handle: ref.handle };
      }
      break;
    case "ProductVariant":
      if (ref.productHandle) {
        field.refVariant = {
          productHandle: ref.productHandle,
          sku: ref.sku,
        };
      }
      break;
    case "Collection":
      if (ref.handle) {
        field.refCollection = { handle: ref.handle };
      }
      break;
    case "Page":
      if (ref.handle) {
        field.refPage = { handle: ref.handle };
      }
      break;
    case "MediaImage":
    case "Video":
    case "GenericFile":
      if (ref.url) {
        field.refFile = { url: ref.url };
      }
      break;
    // TaxonomyValue and other types don't have natural keys - we keep them as GIDs
  }

  return field;
}

/**
 * Extract natural keys from a list of references
 */
function extractReferenceList(refs: Reference[]): DumpedField["refList"] {
  return refs.map((ref) => {
    const item: any = { type: ref.__typename };

    switch (ref.__typename) {
      case "Metaobject":
        item.metaobjectType = ref.type;
        item.metaobjectHandle = ref.handle;
        break;
      case "Product":
        item.productHandle = ref.handle;
        break;
      case "ProductVariant":
        item.variantProductHandle = ref.productHandle;
        item.variantSku = ref.sku;
        break;
      case "Collection":
        item.collectionHandle = ref.handle;
        break;
      case "Page":
        item.pageHandle = ref.handle;
        break;
    }

    return item;
  });
}

/**
 * Extract resource type from a Shopify GID
 * e.g., "gid://shopify/Product/123" -> "Product"
 */
function extractGidType(gid: string): string {
  const match = gid.match(/gid:\/\/shopify\/([^\/]+)\//);
  return match ? match[1] : "Unknown";
}

/**
 * Get typename from object - either from __typename field or extract from id
 */
function getTypename(obj: any): string {
  if (obj.__typename) {
    return obj.__typename;
  }
  if (obj.id) {
    return extractGidType(obj.id);
  }
  return "Unknown";
}

/**
 * Transform metaobject field to dumped format with natural keys
 */
function transformMetaobjectField(field: MetaobjectField): DumpedField {
  const dumped: DumpedField = {
    key: field.key,
    type: field.type,
    value: field.value,
  };

  // Single reference
  if (field.reference) {
    const refKeys = extractReferenceKey(field.reference);
    Object.assign(dumped, refKeys);
  }

  // List of references - for bulk operations, these come as JSON string in value
  // For list reference types (e.g., "list.product_taxonomy_value_reference"), the value is a JSON array of GIDs
  // We store the raw value as-is since it will be used during apply
  // Note: For non-remappable types (like TaxonomyValue), the GID can be used directly
  if (
    field.type.startsWith("list.") &&
    field.type.includes("_reference") &&
    field.value
  ) {
    try {
      const gids = JSON.parse(field.value);
      if (Array.isArray(gids)) {
        // Extract types from GIDs for logging/debugging purposes
        dumped.refList = gids.map((gid: string) => ({
          type: extractGidType(gid),
          gid: gid,
        }));
      }
    } catch (e) {
      logger.warn(
        `Failed to parse list reference value for field ${field.key}`,
        {
          value: field.value?.substring(0, 100),
        }
      );
    }
  }

  return dumped;
}

/**
 * Resolve list-type metafield references by querying GIDs
 */
async function resolveListReferences(
  client: GraphQLClient,
  gids: string[]
): Promise<DumpedField["refList"]> {
  if (gids.length === 0) return [];

  const { RESOLVE_NODES_QUERY } = await import("../graphql/queries.js");

  const result = await client.request<{
    nodes: Array<
      | { id: string; handle: string; __typename: "Product" }
      | { id: string; handle: string; __typename: "Collection" }
      | { id: string; type: string; handle: string; __typename: "Metaobject" }
      | { id: string; handle: string; __typename: "Page" }
      | { id: string; handle: string; __typename: "Blog" }
      | {
          id: string;
          handle: string;
          blog: { handle: string };
          __typename: "Article";
        }
      | null
    >;
  }>({
    query: RESOLVE_NODES_QUERY,
    variables: { ids: gids },
  });

  if (!result.ok) {
    logger.warn("Failed to resolve list references", { error: result.error });
    return [];
  }

  const refList: DumpedField["refList"] = [];
  const nodes = result.data.data?.nodes || [];

  for (const node of nodes) {
    if (!node) continue;

    if (node.__typename === "Product") {
      refList.push({ type: "product", productHandle: node.handle });
    } else if (node.__typename === "Collection") {
      refList.push({ type: "collection", collectionHandle: node.handle });
    } else if (node.__typename === "Metaobject") {
      refList.push({
        type: "metaobject",
        metaobjectType: node.type,
        metaobjectHandle: node.handle,
      });
    } else if (node.__typename === "Page") {
      refList.push({ type: "page", pageHandle: node.handle });
    } else if (node.__typename === "Blog") {
      refList.push({ type: "blog", blogHandle: node.handle });
    } else if (node.__typename === "Article") {
      refList.push({
        type: "article",
        blogHandle: node.blog.handle,
        articleHandle: node.handle,
      });
    }
  }

  return refList;
}

/**
 * Batch resolve list-type metafield GIDs to natural keys.
 * Returns a map from GID to natural key object.
 */
async function batchResolveListGids(
  client: GraphQLClient,
  gids: Set<string>
): Promise<Map<string, NonNullable<DumpedField["refList"]>[number]>> {
  type RefListItem = NonNullable<DumpedField["refList"]>[number];
  const gidToNaturalKey = new Map<string, RefListItem>();

  if (gids.size === 0) return gidToNaturalKey;

  const { RESOLVE_NODES_QUERY } = await import("../graphql/queries.js");
  const gidsArray = Array.from(gids);

  logger.info(
    `Batch resolving ${gidsArray.length} list-type metafield references...`
  );

  // Process in chunks of 250 (Shopify limit for nodes query)
  for (let i = 0; i < gidsArray.length; i += 250) {
    const chunk = gidsArray.slice(i, i + 250);
    const result = await client.request<{
      nodes: Array<
        | { id: string; handle: string; __typename: "Product" }
        | { id: string; handle: string; __typename: "Collection" }
        | { id: string; type: string; handle: string; __typename: "Metaobject" }
        | { id: string; handle: string; __typename: "Page" }
        | { id: string; handle: string; __typename: "Blog" }
        | {
            id: string;
            handle: string;
            blog: { handle: string };
            __typename: "Article";
          }
        | null
      >;
    }>({
      query: RESOLVE_NODES_QUERY,
      variables: { ids: chunk },
    });

    if (result.ok) {
      const nodes = result.data.data?.nodes || [];
      for (let j = 0; j < nodes.length; j++) {
        const node = nodes[j];
        const gid = chunk[j];
        if (!node) continue;

        if (node.__typename === "Product") {
          gidToNaturalKey.set(gid, {
            type: "product",
            productHandle: node.handle,
          });
        } else if (node.__typename === "Collection") {
          gidToNaturalKey.set(gid, {
            type: "collection",
            collectionHandle: node.handle,
          });
        } else if (node.__typename === "Metaobject") {
          gidToNaturalKey.set(gid, {
            type: "metaobject",
            metaobjectType: node.type,
            metaobjectHandle: node.handle,
          });
        } else if (node.__typename === "Page") {
          gidToNaturalKey.set(gid, { type: "page", pageHandle: node.handle });
        } else if (node.__typename === "Blog") {
          gidToNaturalKey.set(gid, { type: "blog", blogHandle: node.handle });
        } else if (node.__typename === "Article") {
          gidToNaturalKey.set(gid, {
            type: "article",
            blogHandle: node.blog.handle,
            articleHandle: node.handle,
          });
        }
      }
    }
  }

  logger.info(`✓ Resolved ${gidToNaturalKey.size} list references`);
  return gidToNaturalKey;
}

/**
 * Transform metafield to dumped format with natural keys.
 * For list-type references, pass the client to resolve GIDs.
 */
async function transformMetafield(
  mf: MetafieldEdge["node"],
  client?: GraphQLClient
): Promise<DumpedMetafield> {
  const dumped: DumpedMetafield = {
    namespace: mf.namespace,
    key: mf.key,
    value: mf.value,
    type: mf.type,
  };

  // Single reference
  if (mf.reference) {
    const refKeys = extractReferenceKey(mf.reference);
    if (refKeys.refMetaobject) dumped.refMetaobject = refKeys.refMetaobject;
    if (refKeys.refProduct) dumped.refProduct = refKeys.refProduct;
    if (refKeys.refCollection) dumped.refCollection = refKeys.refCollection;
  }

  // List of references - check if value is JSON array of GIDs
  if (mf.type.startsWith("list.") && mf.type.includes("_reference") && client) {
    try {
      const parsed = JSON.parse(mf.value);
      if (
        Array.isArray(parsed) &&
        parsed.every(
          (item) => typeof item === "string" && item.startsWith("gid://")
        )
      ) {
        // Resolve the GIDs to handles
        dumped.refList = await resolveListReferences(client, parsed);
      }
    } catch (err) {
      // Not JSON or not an array of GIDs, skip
      logger.debug("List-type metafield value is not a JSON array of GIDs", {
        namespace: mf.namespace,
        key: mf.key,
        type: mf.type,
      });
    }
  }

  // Legacy: List of references from nested query (if present)
  if (mf.references?.edges) {
    const refs = mf.references.edges.map((e) => e.node);
    dumped.refList = extractReferenceList(refs);
  }

  return dumped;
}

/**
 * Transform metafield to dumped format with natural keys
 */
function transformMetafieldSync(mf: MetafieldEdge["node"]): DumpedMetafield {
  const dumped: DumpedMetafield = {
    namespace: mf.namespace,
    key: mf.key,
    value: mf.value,
    type: mf.type,
  };

  // Single reference
  if (mf.reference) {
    const refKeys = extractReferenceKey(mf.reference);
    if (refKeys.refMetaobject) dumped.refMetaobject = refKeys.refMetaobject;
    if (refKeys.refProduct) dumped.refProduct = refKeys.refProduct;
    if (refKeys.refCollection) dumped.refCollection = refKeys.refCollection;
  }

  // List of references
  if (mf.references?.edges) {
    const refs = mf.references.edges.map((e) => e.node);
    dumped.refList = extractReferenceList(refs);
  }

  return dumped;
}

// ============================================================================
// Core Dump Functions
// ============================================================================

/**
 * Dump all metaobject definitions to get list of types
 */
async function getMetaobjectTypes(
  client: GraphQLClient
): Promise<Result<string[], Error>> {
  logger.info("Fetching metaobject definitions to determine types...");

  const types: string[] = [];
  let hasNextPage = true;
  let cursor: string | undefined;

  while (hasNextPage) {
    const result = await client.request<{
      metaobjectDefinitions: {
        edges: { node: MetaobjectDefinitionNode }[];
        pageInfo: { hasNextPage: boolean; endCursor?: string };
      };
    }>({
      query: METAOBJECT_DEFINITIONS_QUERY,
      variables: { first: 250, after: cursor },
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const defs = result.data.data?.metaobjectDefinitions;
    if (!defs) {
      return {
        ok: false,
        error: new Error("No metaobjectDefinitions in response"),
      };
    }

    types.push(
      ...defs.edges.map((e: { node: MetaobjectDefinitionNode }) => e.node.type)
    );
    hasNextPage = defs.pageInfo.hasNextPage;
    cursor = defs.pageInfo.endCursor;
  }

  logger.info(`Found ${types.length} metaobject types: ${types.join(", ")}`);

  return { ok: true, data: types };
}

/**
 * Dump metaobjects of a specific type
 */
async function dumpMetaobjectsForType(
  client: GraphQLClient,
  type: string,
  outputDir: string
): Promise<Result<void, Error>> {
  logger.info(`Dumping metaobjects of type: ${type}...`);

  const bulkQuery = METAOBJECTS_BY_TYPE_BULK(type);
  const result = await runBulkQueryAndDownload(client, bulkQuery);

  if (!result.ok) {
    logger.error(`Failed to dump metaobjects for type ${type}:`, {
      error: result.error.message,
      status: result.error.status,
      response: result.error.response,
    });
    return { ok: false, error: result.error };
  }

  // Parse JSONL stream and transform
  const transformed: DumpedMetaobject[] = [];

  for await (const entry of result.data) {
    try {
      const metaobj = entry as MetaobjectEntry;
      const dumped: DumpedMetaobject = {
        id: metaobj.id,
        handle: metaobj.handle,
        type: metaobj.type,
        displayName: metaobj.displayName,
        updatedAt: metaobj.updatedAt,
        fields: metaobj.fields.map(transformMetaobjectField),
      };
      transformed.push(dumped);
    } catch (err) {
      logger.warn(`Failed to parse metaobject entry:`, { error: String(err) });
    }
  }

  // Write to file
  const outputFile = path.join(outputDir, `metaobjects-${type}.jsonl`);
  const content = transformed.map((obj) => JSON.stringify(obj)).join("\n");
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(
    `✓ Dumped ${transformed.length} metaobjects of type ${type} to ${outputFile}`
  );
  return { ok: true, data: undefined };
}

/**
 * Dump all metaobjects (all types)
 */
export async function dumpMetaobjects(
  client: GraphQLClient,
  outputDir: string
): Promise<Result<void, Error>> {
  logger.info("=== Dumping Metaobjects ===");

  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Get all metaobject types
  const typesResult = await getMetaobjectTypes(client);
  if (!typesResult.ok) {
    return { ok: false, error: typesResult.error };
  }

  // Dump each type
  for (const type of typesResult.data) {
    const result = await dumpMetaobjectsForType(client, type, outputDir);
    if (!result.ok) {
      logger.error(`Failed to dump type ${type}, continuing...`);
    }
  }

  logger.info("✓ Metaobjects dump complete");
  return { ok: true, data: undefined };
}

/**
 * Dump all products with variants and metafields
 *
 * Note: Shopify bulk operations return flattened JSONL where nested resources
 * (variants, metafields) are separate objects with __parentId references.
 * We need to reconstruct the hierarchical structure.
 */
export async function dumpProducts(
  client: GraphQLClient,
  outputDir: string
): Promise<Result<void, Error>> {
  logger.info("=== Dumping Products ===");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const result = await runBulkQueryAndDownload(client, PRODUCTS_BULK);
  if (!result.ok) {
    logger.error("Failed to dump products:", {
      error: result.error.message,
      status: result.error.status,
    });
    return { ok: false, error: result.error };
  }

  // Build hierarchical structure from flat JSONL
  const productsMap = new Map<string, DumpedProduct>();
  const variantsMap = new Map<string, DumpedVariant>();
  const listReferenceGids = new Set<string>(); // Collect all GIDs from list-type metafields

  for await (const entry of result.data) {
    try {
      const obj = entry as any;

      // Determine object type from __typename or id pattern
      const typename = getTypename(obj);
      const parentId = obj.__parentId;

      if (typename === "Product") {
        // Top-level product
        const product: DumpedProduct = {
          id: obj.id,
          handle: obj.handle,
          title: obj.title,
          descriptionHtml: obj.descriptionHtml,
          status: obj.status,
          vendor: obj.vendor,
          productType: obj.productType,
          tags: obj.tags,
          options: obj.options?.map((opt: any) => ({
            id: opt.id,
            name: opt.name,
            position: opt.position,
            values: opt.values,
          })),
          media: [],
          metafields: [],
          variants: [],
        };
        productsMap.set(obj.id, product);
      } else if (typename === "MediaImage" || typename === "Video") {
        // Media (child of product)
        if (parentId) {
          const product = productsMap.get(parentId);
          if (product) {
            const media = {
              id: obj.id,
              url:
                typename === "MediaImage"
                  ? obj.image?.url
                  : obj.sources?.[0]?.url,
              alt: obj.alt || "",
              mediaType: typename,
            };
            if (media.url) {
              product.media = product.media || [];
              product.media.push(media);
            }
          }
        }
      } else if (typename === "ProductVariant") {
        // Variant (child of product)
        const variant: DumpedVariant = {
          id: obj.id,
          sku: obj.sku,
          title: obj.title,
          position: obj.position,
          price: obj.price,
          compareAtPrice: obj.compareAtPrice,
          barcode: obj.barcode,
          inventoryQuantity: obj.inventoryQuantity,
          inventoryPolicy: obj.inventoryPolicy,
          taxable: obj.taxable,
          selectedOptions: obj.selectedOptions,
          inventoryItem: obj.inventoryItem
            ? {
                id: obj.inventoryItem.id,
                tracked: obj.inventoryItem.tracked,
                measurement: obj.inventoryItem.measurement,
              }
            : undefined,
          metafields: [],
        };
        variantsMap.set(obj.id, variant);

        // Add to parent product if we've seen it
        if (parentId) {
          const product = productsMap.get(parentId);
          if (product) {
            product.variants.push(variant);
          }
        }
      } else if (typename === "Metafield") {
        // Metafield (child of product or variant)
        const metafield: DumpedMetafield = {
          namespace: obj.namespace,
          key: obj.key,
          value: obj.value,
          type: obj.type,
        };

        // Handle reference if present
        if (obj.reference) {
          const refKeys = extractReferenceKey(obj.reference);
          if (refKeys.refMetaobject)
            metafield.refMetaobject = refKeys.refMetaobject;
          if (refKeys.refProduct) metafield.refProduct = refKeys.refProduct;
          if (refKeys.refCollection)
            metafield.refCollection = refKeys.refCollection;
        }

        // Handle list references if present
        if (obj.references?.edges) {
          const refs = obj.references.edges.map((e: any) => e.node);
          metafield.refList = extractReferenceList(refs);
        } else if (
          obj.type.startsWith("list.") &&
          obj.type.includes("_reference")
        ) {
          // No references field (removed to save connections), but value contains GIDs
          try {
            const parsed = JSON.parse(obj.value);
            if (
              Array.isArray(parsed) &&
              parsed.every(
                (item: any) =>
                  typeof item === "string" && item.startsWith("gid://")
              )
            ) {
              // Collect GIDs for batch resolution later
              parsed.forEach((gid: string) => listReferenceGids.add(gid));
              // Mark this metafield as needing resolution (we'll store the parent ID temporarily)
              (metafield as any)._listGids = parsed;
            }
          } catch (err) {
            // Not JSON, skip
          }
        }

        // Add to parent (product or variant)
        if (parentId) {
          const product = productsMap.get(parentId);
          const variant = variantsMap.get(parentId);

          if (product) {
            product.metafields.push(metafield);
          } else if (variant) {
            variant.metafields.push(metafield);
          }
        }
      }
    } catch (err) {
      logger.warn("Failed to parse product-related entry:", {
        error: String(err),
      });
    }
  }

  // Resolve all list references in one batch
  const gidToNaturalKey = await batchResolveListGids(client, listReferenceGids);

  // Now resolve the _listGids in all metafields
  for (const product of productsMap.values()) {
    for (const metafield of product.metafields) {
      if ((metafield as any)._listGids) {
        const gids = (metafield as any)._listGids as string[];
        metafield.refList = gids
          .map((gid: string) => gidToNaturalKey.get(gid))
          .filter(
            (item): item is NonNullable<typeof item> => item !== undefined
          );
        delete (metafield as any)._listGids;
      }
    }
    for (const variant of product.variants) {
      for (const metafield of variant.metafields) {
        if ((metafield as any)._listGids) {
          const gids = (metafield as any)._listGids as string[];
          metafield.refList = gids
            .map((gid: string) => gidToNaturalKey.get(gid))
            .filter(
              (item): item is NonNullable<typeof item> => item !== undefined
            );
          delete (metafield as any)._listGids;
        }
      }
    }
  }

  // Convert to array
  const transformed = Array.from(productsMap.values());

  // Write to file
  const outputFile = path.join(outputDir, "products.jsonl");
  const content = transformed.map((obj) => JSON.stringify(obj)).join("\n");
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(`✓ Dumped ${transformed.length} products to ${outputFile}`);
  return { ok: true, data: undefined };
}

/**
 * Dump all collections with metafields
 *
 * Note: Shopify bulk operations return flattened JSONL where metafields
 * are separate objects with __parentId references.
 */
export async function dumpCollections(
  client: GraphQLClient,
  outputDir: string
): Promise<Result<void, Error>> {
  logger.info("=== Dumping Collections ===");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const result = await runBulkQueryAndDownload(client, COLLECTIONS_BULK);
  if (!result.ok) {
    logger.error("Failed to dump collections:", {
      error: result.error.message,
      status: result.error.status,
    });
    return { ok: false, error: result.error };
  }

  // Build hierarchical structure from flat JSONL
  const collectionsMap = new Map<string, DumpedCollection>();
  const listReferenceGids = new Set<string>();

  for await (const entry of result.data) {
    try {
      const obj = entry as any;
      const typename = getTypename(obj);
      const parentId = obj.__parentId;

      if (typename === "Collection") {
        // Top-level collection
        const collection: DumpedCollection = {
          id: obj.id,
          handle: obj.handle,
          title: obj.title,
          descriptionHtml: obj.descriptionHtml,
          metafields: [],
        };
        // Include ruleSet if present (for automated collections)
        if (obj.ruleSet) {
          collection.ruleSet = obj.ruleSet;
        }
        collectionsMap.set(obj.id, collection);
      } else if (typename === "Metafield") {
        // Metafield (child of collection)
        const metafield: DumpedMetafield = {
          namespace: obj.namespace,
          key: obj.key,
          value: obj.value,
          type: obj.type,
        };

        // Handle reference if present
        if (obj.reference) {
          const refKeys = extractReferenceKey(obj.reference);
          if (refKeys.refMetaobject)
            metafield.refMetaobject = refKeys.refMetaobject;
          if (refKeys.refProduct) metafield.refProduct = refKeys.refProduct;
          if (refKeys.refCollection)
            metafield.refCollection = refKeys.refCollection;
        }

        // Handle list references if present
        if (obj.references?.edges) {
          const refs = obj.references.edges.map((e: any) => e.node);
          metafield.refList = extractReferenceList(refs);
        } else if (
          obj.type.startsWith("list.") &&
          obj.type.includes("_reference")
        ) {
          try {
            const parsed = JSON.parse(obj.value);
            if (
              Array.isArray(parsed) &&
              parsed.every(
                (item: any) =>
                  typeof item === "string" && item.startsWith("gid://")
              )
            ) {
              parsed.forEach((gid: string) => listReferenceGids.add(gid));
              (metafield as any)._listGids = parsed;
            }
          } catch (err) {
            // Not JSON, skip
          }
        }

        // Add to parent collection
        if (parentId) {
          const collection = collectionsMap.get(parentId);
          if (collection) {
            collection.metafields.push(metafield);
          }
        }
      }
    } catch (err) {
      logger.warn("Failed to parse collection entry:", { error: String(err) });
    }
  }

  // Resolve all list references in one batch
  const gidToNaturalKey = await batchResolveListGids(client, listReferenceGids);

  // Resolve the _listGids in all metafields
  for (const collection of collectionsMap.values()) {
    for (const metafield of collection.metafields) {
      if ((metafield as any)._listGids) {
        const gids = (metafield as any)._listGids as string[];
        metafield.refList = gids
          .map((gid: string) => gidToNaturalKey.get(gid))
          .filter(
            (item): item is NonNullable<typeof item> => item !== undefined
          );
        delete (metafield as any)._listGids;
      }
    }
  }

  // Convert to array
  const transformed = Array.from(collectionsMap.values());

  // Write to file
  const outputFile = path.join(outputDir, "collections.jsonl");
  const content = transformed.map((obj) => JSON.stringify(obj)).join("\n");
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(`✓ Dumped ${transformed.length} collections to ${outputFile}`);
  return { ok: true, data: undefined };
}

/**
 * Dump all pages with metafields
 *
 * Note: Shopify bulk operations return flattened JSONL.
 */
export async function dumpPages(
  client: GraphQLClient,
  outputDir: string
): Promise<Result<void, Error>> {
  logger.info("=== Dumping Pages ===");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const result = await runBulkQueryAndDownload(client, PAGES_BULK);
  if (!result.ok) {
    logger.error("Failed to dump pages:", {
      error: result.error.message,
      status: result.error.status,
    });
    return { ok: false, error: result.error };
  }

  // Build hierarchical structure from flat JSONL
  const pagesMap = new Map<string, DumpedPage>();

  for await (const entry of result.data) {
    try {
      const obj = entry as any;
      const typename = getTypename(obj);
      const parentId = obj.__parentId;

      if (typename === "Page" || typename === "OnlineStorePage") {
        // Top-level page
        const page: DumpedPage = {
          id: obj.id,
          handle: obj.handle,
          title: obj.title,
          body: obj.body,
          bodySummary: obj.bodySummary,
          metafields: [],
        };
        pagesMap.set(obj.id, page);
      } else if (typename === "Metafield") {
        // Metafield (child of page)
        const metafield: DumpedMetafield = {
          namespace: obj.namespace,
          key: obj.key,
          value: obj.value,
          type: obj.type,
        };

        // Handle reference if present
        if (obj.reference) {
          const refKeys = extractReferenceKey(obj.reference);
          if (refKeys.refMetaobject)
            metafield.refMetaobject = refKeys.refMetaobject;
          if (refKeys.refProduct) metafield.refProduct = refKeys.refProduct;
          if (refKeys.refCollection)
            metafield.refCollection = refKeys.refCollection;
        }

        // Add to parent page
        if (parentId) {
          const page = pagesMap.get(parentId);
          if (page) {
            page.metafields.push(metafield);
          }
        }
      }
    } catch (err) {
      logger.warn("Failed to parse page entry:", { error: String(err) });
    }
  }

  // Convert to array
  const transformed = Array.from(pagesMap.values());

  // Write to file
  const outputFile = path.join(outputDir, "pages.jsonl");
  const content = transformed.map((obj) => JSON.stringify(obj)).join("\n");
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(`✓ Dumped ${transformed.length} pages to ${outputFile}`);
  return { ok: true, data: undefined };
}

/**
 * Dump shop-level metafields
 *
 * Note: Shopify bulk operations return flattened JSONL.
 */
export async function dumpShopMetafields(
  client: GraphQLClient,
  outputDir: string
): Promise<Result<void, Error>> {
  logger.info("=== Dumping Shop Metafields ===");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const result = await runBulkQueryAndDownload(client, SHOP_BULK);
  if (!result.ok) {
    logger.error("Failed to dump shop metafields:", {
      error: result.error.message,
      status: result.error.status,
    });
    return { ok: false, error: result.error };
  }

  // Parse JSONL stream - shop and metafields are flattened
  const shopMetafields: DumpedMetafield[] = [];
  let shopId: string | undefined;

  for await (const entry of result.data) {
    try {
      const obj = entry as any;
      const typename = getTypename(obj);
      const parentId = obj.__parentId;

      if (typename === "Shop") {
        shopId = obj.id;
      } else if (typename === "Metafield") {
        const metafield: DumpedMetafield = {
          namespace: obj.namespace,
          key: obj.key,
          value: obj.value,
          type: obj.type,
        };

        // Handle reference if present
        if (obj.reference) {
          const refKeys = extractReferenceKey(obj.reference);
          if (refKeys.refMetaobject)
            metafield.refMetaobject = refKeys.refMetaobject;
          if (refKeys.refProduct) metafield.refProduct = refKeys.refProduct;
          if (refKeys.refCollection)
            metafield.refCollection = refKeys.refCollection;
        }

        // Handle list references if present
        if (obj.references?.edges) {
          const refs = obj.references.edges.map((e: any) => e.node);
          metafield.refList = extractReferenceList(refs);
        }

        shopMetafields.push(metafield);
      }
    } catch (err) {
      logger.warn("Failed to parse shop entry:", { error: String(err) });
    }
  }

  // Write to file
  const outputFile = path.join(outputDir, "shop-metafields.jsonl");
  const content = shopMetafields.map((mf) => JSON.stringify(mf)).join("\n");
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(
    `✓ Dumped ${shopMetafields.length} shop metafields to ${outputFile}`
  );
  return { ok: true, data: undefined };
}

/**
 * Dump all blogs with metafields
 *
 * Note: Shopify bulk operations return flattened JSONL.
 */
export async function dumpBlogs(
  client: GraphQLClient,
  outputDir: string
): Promise<Result<void, Error>> {
  logger.info("=== Dumping Blogs ===");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const result = await runBulkQueryAndDownload(client, BLOGS_BULK);
  if (!result.ok) {
    logger.error("Failed to dump blogs:", {
      error: result.error.message,
      status: result.error.status,
    });
    return { ok: false, error: result.error };
  }

  // Build hierarchical structure from flat JSONL
  const blogsMap = new Map<string, DumpedBlog>();

  for await (const entry of result.data) {
    try {
      const obj = entry as any;
      const typename = getTypename(obj);
      const parentId = obj.__parentId;

      if (typename === "Blog" || typename === "OnlineStoreBlog") {
        // Top-level blog
        const blog: DumpedBlog = {
          id: obj.id,
          handle: obj.handle,
          title: obj.title,
          metafields: [],
        };
        blogsMap.set(obj.id, blog);
      } else if (typename === "Metafield") {
        // Metafield (child of blog)
        const metafield: DumpedMetafield = {
          namespace: obj.namespace,
          key: obj.key,
          value: obj.value,
          type: obj.type,
        };

        // Handle reference if present
        if (obj.reference) {
          const refKeys = extractReferenceKey(obj.reference);
          if (refKeys.refMetaobject)
            metafield.refMetaobject = refKeys.refMetaobject;
          if (refKeys.refProduct) metafield.refProduct = refKeys.refProduct;
          if (refKeys.refCollection)
            metafield.refCollection = refKeys.refCollection;
        }

        // Handle list references if present
        if (obj.references?.edges) {
          const refs = obj.references.edges.map((e: any) => e.node);
          metafield.refList = extractReferenceList(refs);
        }

        // Add to parent blog
        if (parentId) {
          const blog = blogsMap.get(parentId);
          if (blog) {
            blog.metafields.push(metafield);
          }
        }
      }
    } catch (err) {
      logger.warn("Failed to parse blog entry:", { error: String(err) });
    }
  }

  // Convert to array
  const transformed = Array.from(blogsMap.values());

  // Write to file
  const outputFile = path.join(outputDir, "blogs.jsonl");
  const content = transformed.map((obj) => JSON.stringify(obj)).join("\n");
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(`✓ Dumped ${transformed.length} blogs to ${outputFile}`);
  return { ok: true, data: undefined };
}

/**
 * Dump all articles with metafields
 *
 * Note: Shopify bulk operations return flattened JSONL.
 */
export async function dumpArticles(
  client: GraphQLClient,
  outputDir: string
): Promise<Result<void, Error>> {
  logger.info("=== Dumping Articles ===");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const result = await runBulkQueryAndDownload(client, ARTICLES_BULK);
  if (!result.ok) {
    logger.error("Failed to dump articles:", {
      error: result.error.message,
      status: result.error.status,
    });
    return { ok: false, error: result.error };
  }

  // Build hierarchical structure from flat JSONL
  const articlesMap = new Map<string, DumpedArticle>();
  const blogReferences = new Map<string, string>(); // article ID -> blog handle

  for await (const entry of result.data) {
    try {
      const obj = entry as any;
      const typename = getTypename(obj);
      const parentId = obj.__parentId;

      if (typename === "Article" || typename === "OnlineStoreArticle") {
        // Top-level article
        const article: DumpedArticle = {
          id: obj.id,
          handle: obj.handle,
          title: obj.title,
          body: obj.body,
          blogHandle: obj.blog?.handle || "",
          metafields: [],
        };
        articlesMap.set(obj.id, article);
      } else if (typename === "Blog" || typename === "OnlineStoreBlog") {
        // Blog referenced by article (as __parentId)
        if (parentId) {
          blogReferences.set(parentId, obj.handle);
        }
      } else if (typename === "Metafield") {
        // Metafield (child of article)
        const metafield: DumpedMetafield = {
          namespace: obj.namespace,
          key: obj.key,
          value: obj.value,
          type: obj.type,
        };

        // Handle reference if present
        if (obj.reference) {
          const refKeys = extractReferenceKey(obj.reference);
          if (refKeys.refMetaobject)
            metafield.refMetaobject = refKeys.refMetaobject;
          if (refKeys.refProduct) metafield.refProduct = refKeys.refProduct;
          if (refKeys.refCollection)
            metafield.refCollection = refKeys.refCollection;
        }

        // Handle list references if present
        if (obj.references?.edges) {
          const refs = obj.references.edges.map((e: any) => e.node);
          metafield.refList = extractReferenceList(refs);
        }

        // Add to parent article
        if (parentId) {
          const article = articlesMap.get(parentId);
          if (article) {
            article.metafields.push(metafield);
          }
        }
      }
    } catch (err) {
      logger.warn("Failed to parse article entry:", { error: String(err) });
    }
  }

  // Update blog handles from references if needed
  for (const [articleId, blogHandle] of blogReferences) {
    const article = articlesMap.get(articleId);
    if (article && !article.blogHandle) {
      article.blogHandle = blogHandle;
    }
  }

  // Convert to array
  const transformed = Array.from(articlesMap.values());

  // Write to file
  const outputFile = path.join(outputDir, "articles.jsonl");
  const content = transformed.map((obj) => JSON.stringify(obj)).join("\n");
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(`✓ Dumped ${transformed.length} articles to ${outputFile}`);
  return { ok: true, data: undefined };
}

/**
 * Dump all data: metaobjects, products, collections, pages, blogs, articles
 */
export async function dumpAllData(
  client: GraphQLClient,
  outputDir: string
): Promise<Result<void, Error>> {
  logger.info("=== Starting Full Data Dump ===");

  // Dump in order (metaobjects first, then resources)
  const metaobjectsResult = await dumpMetaobjects(client, outputDir);
  if (!metaobjectsResult.ok) {
    logger.error("Metaobjects dump failed, aborting");
    return metaobjectsResult;
  }

  const productsResult = await dumpProducts(client, outputDir);
  if (!productsResult.ok) {
    logger.warn("Products dump failed, continuing...");
  }

  const collectionsResult = await dumpCollections(client, outputDir);
  if (!collectionsResult.ok) {
    logger.warn("Collections dump failed, continuing...");
  }

  const pagesResult = await dumpPages(client, outputDir);
  if (!pagesResult.ok) {
    logger.warn("Pages dump failed, continuing...");
  }

  const shopMetafieldsResult = await dumpShopMetafields(client, outputDir);
  if (!shopMetafieldsResult.ok) {
    logger.warn("Shop metafields dump failed, continuing...");
  }

  const filesResult = await dumpFiles(client, outputDir);
  if (!filesResult.ok) {
    logger.warn("Files dump failed, continuing...");
  }

  const blogsResult = await dumpBlogs(client, outputDir);
  if (!blogsResult.ok) {
    logger.warn("Blogs dump failed, continuing...");
  }

  const articlesResult = await dumpArticles(client, outputDir);
  if (!articlesResult.ok) {
    logger.warn("Articles dump failed, continuing...");
  }

  // Enrich all references with natural keys (post-processing step)
  logger.info("=== Enriching References ===");
  const enrichResult = await enrichAllReferences(outputDir);
  if (!enrichResult.ok) {
    logger.error("Reference enrichment failed:", enrichResult.error);
    return enrichResult;
  }

  logger.info("=== Data Dump Complete ===");
  return { ok: true, data: undefined };
}
