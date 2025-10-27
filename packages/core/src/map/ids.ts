/**
 * Deterministic mapping from natural keys (handles, type+handle) to destination GIDs.
 *
 * KEY PRINCIPLE: Never rely on source GIDs. Always map via natural keys:
 * - Products/Collections/Pages/Articles → handle
 * - Metaobjects → {type}:{handle}
 * - Variants → (productHandle, sku) or (productHandle, position)
 *
 * This module builds lookup indexes from the destination store.
 */

import { logger } from "../utils/logger.js";
import { type GraphQLClient } from "../graphql/client.js";
import {
  PRODUCTS_HANDLES_QUERY,
  PRODUCTS_WITH_VARIANTS_QUERY,
  COLLECTIONS_HANDLES_QUERY,
  PAGES_HANDLES_QUERY,
  METAOBJECTS_HANDLES_QUERY,
} from "../graphql/queries.js";

export interface DestinationIndex {
  products: Map<string, string>; // handle → GID
  collections: Map<string, string>; // handle → GID
  pages: Map<string, string>; // handle → GID
  metaobjects: Map<string, string>; // {type}:{handle} → GID
  variants: Map<string, string>; // {productHandle}:{sku|position} → GID
}

/**
 * Build a complete index of natural keys → GIDs from the destination store.
 * This allows us to resolve references deterministically when applying data.
 */
export async function buildDestinationIndex(
  client: GraphQLClient
): Promise<DestinationIndex> {
  logger.info("Building destination index");

  const index: DestinationIndex = {
    products: new Map(),
    collections: new Map(),
    pages: new Map(),
    metaobjects: new Map(),
    variants: new Map(),
  };

  // Index products
  logger.debug("Indexing products");
  for await (const product of client.paginate(
    PRODUCTS_HANDLES_QUERY,
    {},
    {
      getEdges: (data) => data.products.edges,
      getPageInfo: (data) => data.products.pageInfo,
    }
  )) {
    if (product.handle) {
      index.products.set(product.handle, product.id);
    }
  }
  logger.debug(`Indexed ${index.products.size} products`);

  // Index variants (requires separate query with variant data)
  logger.debug("Indexing variants");
  let variantCount = 0;
  for await (const product of client.paginate(
    PRODUCTS_WITH_VARIANTS_QUERY,
    {},
    {
      getEdges: (data) => data.products.edges,
      getPageInfo: (data) => data.products.pageInfo,
    }
  )) {
    if (!product.handle || !product.variants?.edges) continue;

    for (const variantEdge of product.variants.edges) {
      const variant = variantEdge.node;
      if (!variant.id) continue;

      // Primary key: {productHandle}:{sku}
      if (variant.sku) {
        const key = `${product.handle}:${variant.sku}`;
        index.variants.set(key, variant.id);
        variantCount++;
      }

      // Fallback key: {productHandle}:pos{position}
      if (variant.position !== undefined) {
        const fallbackKey = `${product.handle}:pos${variant.position}`;
        // Only set if not already set by SKU
        if (!index.variants.has(fallbackKey)) {
          index.variants.set(fallbackKey, variant.id);
        }
      }
    }
  }
  logger.debug(`Indexed ${variantCount} variants`);

  // Index collections
  logger.debug("Indexing collections");
  for await (const collection of client.paginate(
    COLLECTIONS_HANDLES_QUERY,
    {},
    {
      getEdges: (data) => data.collections.edges,
      getPageInfo: (data) => data.collections.pageInfo,
    }
  )) {
    if (collection.handle) {
      index.collections.set(collection.handle, collection.id);
    }
  }
  logger.debug(`Indexed ${index.collections.size} collections`);

  // Index pages
  logger.debug("Indexing pages");
  for await (const page of client.paginate(
    PAGES_HANDLES_QUERY,
    {},
    {
      getEdges: (data) => data.pages.edges,
      getPageInfo: (data) => data.pages.pageInfo,
    }
  )) {
    if (page.handle) {
      index.pages.set(page.handle, page.id);
    }
  }
  logger.debug(`Indexed ${index.pages.size} pages`);

  logger.info("Destination index built", {
    products: index.products.size,
    variants: index.variants.size,
    collections: index.collections.size,
    pages: index.pages.size,
  });

  return index;
}

/**
 * Add metaobjects of a specific type to the index.
 * Call this for each metaobject type you need to map.
 */
export async function indexMetaobjectType(
  client: GraphQLClient,
  type: string,
  index: DestinationIndex
): Promise<void> {
  logger.debug(`Indexing metaobjects of type: ${type}`);

  for await (const metaobject of client.paginate(
    METAOBJECTS_HANDLES_QUERY,
    { type },
    {
      getEdges: (data) => data.metaobjects.edges,
      getPageInfo: (data) => data.metaobjects.pageInfo,
    }
  )) {
    if (metaobject.handle && metaobject.type) {
      const key = `${metaobject.type}:${metaobject.handle}`;
      index.metaobjects.set(key, metaobject.id);
    }
  }

  const count = Array.from(index.metaobjects.keys()).filter((k) =>
    k.startsWith(`${type}:`)
  ).length;
  logger.debug(`Indexed ${count} metaobjects of type ${type}`);
}

/**
 * Resolve a product handle to a destination GID.
 */
export function gidForProductHandle(
  index: DestinationIndex,
  handle: string
): string | undefined {
  return index.products.get(handle);
}

/**
 * Resolve a collection handle to a destination GID.
 */
export function gidForCollectionHandle(
  index: DestinationIndex,
  handle: string
): string | undefined {
  return index.collections.get(handle);
}

/**
 * Resolve a page handle to a destination GID.
 */
export function gidForPageHandle(
  index: DestinationIndex,
  handle: string
): string | undefined {
  return index.pages.get(handle);
}

/**
 * Resolve a metaobject by type + handle to a destination GID.
 */
export function gidForMetaobject(
  index: DestinationIndex,
  type: string,
  handle: string
): string | undefined {
  const key = `${type}:${handle}`;
  return index.metaobjects.get(key);
}

/**
 * Resolve a variant by product handle + SKU (or position fallback).
 */
export function gidForVariant(
  index: DestinationIndex,
  productHandle: string,
  skuOrPosition: string | number
): string | undefined {
  const key = `${productHandle}:${skuOrPosition}`;
  return index.variants.get(key);
}

/**
 * Resolve a reference based on its type and natural key.
 * Returns the destination GID or undefined if not found.
 */
export function resolveReference(
  index: DestinationIndex,
  refType: string,
  naturalKey: string
): string | undefined {
  switch (refType) {
    case "Product":
      return gidForProductHandle(index, naturalKey);
    case "Collection":
      return gidForCollectionHandle(index, naturalKey);
    case "Page":
      return gidForPageHandle(index, naturalKey);
    case "Metaobject": {
      // naturalKey should be {type}:{handle}
      const parts = naturalKey.split(":");
      if (parts.length >= 2) {
        const type = parts[0];
        const handle = parts.slice(1).join(":"); // Handle colons in handle
        return gidForMetaobject(index, type, handle);
      }
      return index.metaobjects.get(naturalKey);
    }
    case "ProductVariant": {
      // naturalKey should be {productHandle}:{sku|position}
      const parts = naturalKey.split(":");
      if (parts.length >= 2) {
        return gidForVariant(index, parts[0], parts[1]);
      }
      return undefined;
    }
    default:
      logger.warn("Unknown reference type for resolution", {
        refType,
        naturalKey,
      });
      return undefined;
  }
}

/**
 * Extract natural key from a reference object (from dump data).
 * This is used when processing dumped data to build the natural key for resolution.
 */
export function extractNaturalKey(
  ref: any
): { type: string; key: string } | undefined {
  if (!ref || !ref.__typename) return undefined;

  const type = ref.__typename;

  switch (type) {
    case "Product":
    case "Collection":
    case "Page":
      if (ref.handle) {
        return { type, key: ref.handle };
      }
      break;

    case "Metaobject":
      if (ref.type && ref.handle) {
        return { type, key: `${ref.type}:${ref.handle}` };
      }
      break;

    case "ProductVariant":
      if (ref.product?.handle && (ref.sku || ref.position !== undefined)) {
        const identifier = ref.sku || `pos${ref.position}`;
        return { type, key: `${ref.product.handle}:${identifier}` };
      }
      break;
  }

  return undefined;
}
