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
  contentHtml?: string;
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
  contentHtml?: string;
  blogHandle: string;
  metafields: DumpedMetafield[];
}

// ============================================================================
// Helpers: Extract Natural Keys from References
// ============================================================================

/**
 * Extract natural key from a single reference
 */
function extractReferenceKey(ref: Reference | undefined): DumpedField {
  const field: DumpedField = {
    key: "",
    type: "",
    value: null,
  };

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

  // List of references
  if (field.references && field.references.length > 0) {
    dumped.refList = extractReferenceList(field.references);
  }

  return dumped;
}

/**
 * Transform metafield to dumped format with natural keys
 */
function transformMetafield(mf: MetafieldEdge["node"]): DumpedMetafield {
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
    logger.error(`Failed to dump metaobjects for type ${type}:`, result.error);
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
    logger.error("Failed to dump products:", result.error);
    return { ok: false, error: result.error };
  }

  // Parse JSONL stream
  const transformed: DumpedProduct[] = [];

  for await (const entry of result.data) {
    try {
      const product = entry as ProductNode;
      const dumped: DumpedProduct = {
        id: product.id,
        handle: product.handle,
        title: product.title,
        descriptionHtml: product.descriptionHtml,
        status: product.status,
        metafields:
          product.metafields?.map((e) => transformMetafield(e.node)) || [],
        variants:
          product.variants?.map((e) => ({
            id: e.node.id,
            sku: e.node.sku,
            title: e.node.title,
            position: e.node.position,
            metafields:
              e.node.metafields?.map((mf) => transformMetafield(mf.node)) || [],
          })) || [],
      };
      transformed.push(dumped);
    } catch (err) {
      logger.warn("Failed to parse product entry:", { error: String(err) });
    }
  }

  // Write to file
  const outputFile = path.join(outputDir, "products.jsonl");
  const content = transformed.map((obj) => JSON.stringify(obj)).join("\n");
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(`✓ Dumped ${transformed.length} products to ${outputFile}`);
  return { ok: true, data: undefined };
}

/**
 * Dump all collections with metafields
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
    logger.error("Failed to dump collections:", result.error);
    return { ok: false, error: result.error };
  }

  // Parse JSONL stream
  const transformed: DumpedCollection[] = [];

  for await (const entry of result.data) {
    try {
      const collection = entry as CollectionNode;
      const dumped: DumpedCollection = {
        id: collection.id,
        handle: collection.handle,
        title: collection.title,
        descriptionHtml: collection.descriptionHtml,
        metafields:
          collection.metafields?.map((e) => transformMetafield(e.node)) || [],
      };
      transformed.push(dumped);
    } catch (err) {
      logger.warn("Failed to parse collection entry:", { error: String(err) });
    }
  }

  // Write to file
  const outputFile = path.join(outputDir, "collections.jsonl");
  const content = transformed.map((obj) => JSON.stringify(obj)).join("\n");
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(`✓ Dumped ${transformed.length} collections to ${outputFile}`);
  return { ok: true, data: undefined };
}

/**
 * Dump all pages with metafields
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
    logger.error("Failed to dump pages:", result.error);
    return { ok: false, error: result.error };
  }

  // Parse JSONL stream
  const transformed: DumpedPage[] = [];

  for await (const entry of result.data) {
    try {
      const page = entry as PageNode;
      const dumped: DumpedPage = {
        id: page.id,
        handle: page.handle,
        title: page.title,
        body: page.body,
        bodySummary: page.bodySummary,
        metafields:
          page.metafields?.map((e) => transformMetafield(e.node)) || [],
      };
      transformed.push(dumped);
    } catch (err) {
      logger.warn("Failed to parse page entry:", { error: String(err) });
    }
  }

  // Write to file
  const outputFile = path.join(outputDir, "pages.jsonl");
  const content = transformed.map((obj) => JSON.stringify(obj)).join("\n");
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(`✓ Dumped ${transformed.length} pages to ${outputFile}`);
  return { ok: true, data: undefined };
}

/**
 * Dump shop-level metafields
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
    logger.error("Failed to dump shop metafields:", result.error);
    return { ok: false, error: result.error };
  }

  // Parse JSONL stream - shop is returned as a single object
  let shopMetafields: DumpedMetafield[] = [];

  for await (const entry of result.data) {
    try {
      // The bulk query returns the shop object
      const shop = entry as {
        id: string;
        name: string;
        metafields?: MetafieldEdge[];
      };
      if (shop.metafields) {
        shopMetafields = shop.metafields.map((e) => transformMetafield(e.node));
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
    logger.error("Failed to dump blogs:", result.error);
    return { ok: false, error: result.error };
  }

  // Parse JSONL stream
  const transformed: DumpedBlog[] = [];

  for await (const entry of result.data) {
    try {
      const blog = entry as BlogNode;
      const dumped: DumpedBlog = {
        id: blog.id,
        handle: blog.handle,
        title: blog.title,
        metafields:
          blog.metafields?.map((e) => transformMetafield(e.node)) || [],
      };
      transformed.push(dumped);
    } catch (err) {
      logger.warn("Failed to parse blog entry:", { error: String(err) });
    }
  }

  // Write to file
  const outputFile = path.join(outputDir, "blogs.jsonl");
  const content = transformed.map((obj) => JSON.stringify(obj)).join("\n");
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(`✓ Dumped ${transformed.length} blogs to ${outputFile}`);
  return { ok: true, data: undefined };
}

/**
 * Dump all articles with metafields
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
    logger.error("Failed to dump articles:", result.error);
    return { ok: false, error: result.error };
  }

  // Parse JSONL stream
  const transformed: DumpedArticle[] = [];

  for await (const entry of result.data) {
    try {
      const article = entry as ArticleNode;
      const dumped: DumpedArticle = {
        id: article.id,
        handle: article.handle,
        title: article.title,
        contentHtml: article.contentHtml,
        blogHandle: article.blog.handle,
        metafields:
          article.metafields?.map((e) => transformMetafield(e.node)) || [],
      };
      transformed.push(dumped);
    } catch (err) {
      logger.warn("Failed to parse article entry:", { error: String(err) });
    }
  }

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

  logger.info("=== Data Dump Complete ===");
  return { ok: true, data: undefined };
}
