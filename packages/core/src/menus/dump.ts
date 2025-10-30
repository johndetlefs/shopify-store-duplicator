/**
 * Menu dump operations: export navigation menus from source store.
 *
 * Purpose:
 * - Extract all menus with their hierarchical structure
 * - Preserve menu items with URLs and types
 * - Save to JSON format for easy inspection and editing
 *
 * Output Format:
 * - Single JSON file with array of menus
 * - Each menu includes nested items (up to 3 levels deep)
 * - URLs preserved as-is (will be remapped during apply if they reference resources)
 *
 * Idempotency:
 * - Safe to re-run; overwrites previous dump file
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { GraphQLClient } from "../graphql/client.js";
import { MENUS_QUERY } from "../graphql/queries.js";
import { logger } from "../utils/logger.js";
import { type Result, ok } from "../utils/types.js";

// ============================================================================
// Types
// ============================================================================

interface MenuItem {
  id: string;
  title: string;
  url: string;
  type: string;
  items?: MenuItem[];
}

interface Menu {
  id: string;
  handle: string;
  title: string;
  items: MenuItem[];
}

interface DumpedMenu {
  handle: string;
  title: string;
  items: DumpedMenuItem[];
}

interface DumpedMenuItem {
  title: string;
  url: string;
  type: string;
  // Natural keys for resource links
  productHandle?: string;
  collectionHandle?: string;
  pageHandle?: string;
  blogHandle?: string;
  articleHandle?: string;
  items?: DumpedMenuItem[];
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract natural key from a menu item URL if it references a Shopify resource.
 */
function extractResourceFromUrl(
  url: string,
  type: string
): {
  productHandle?: string;
  collectionHandle?: string;
  pageHandle?: string;
  blogHandle?: string;
  articleHandle?: string;
} {
  const result: {
    productHandle?: string;
    collectionHandle?: string;
    pageHandle?: string;
    blogHandle?: string;
    articleHandle?: string;
  } = {};

  // Menu item types: COLLECTION, PRODUCT, PAGE, BLOG, ARTICLE, HTTP, CATALOG, FRONTPAGE, SEARCH, SHOP_POLICY
  // We only care about extracting handles for resources we can remap

  try {
    const urlObj = new URL(url, "https://dummy.myshopify.com");
    const pathname = urlObj.pathname;

    switch (type) {
      case "PRODUCT":
        // URL format: /products/{handle}
        const productMatch = pathname.match(/\/products\/([^/?]+)/);
        if (productMatch) {
          result.productHandle = productMatch[1];
        }
        break;

      case "COLLECTION":
        // URL format: /collections/{handle}
        const collectionMatch = pathname.match(/\/collections\/([^/?]+)/);
        if (collectionMatch) {
          result.collectionHandle = collectionMatch[1];
        }
        break;

      case "PAGE":
        // URL format: /pages/{handle}
        const pageMatch = pathname.match(/\/pages\/([^/?]+)/);
        if (pageMatch) {
          result.pageHandle = pageMatch[1];
        }
        break;

      case "BLOG":
        // URL format: /blogs/{handle}
        const blogMatch = pathname.match(/\/blogs\/([^/?]+)/);
        if (blogMatch) {
          result.blogHandle = blogMatch[1];
        }
        break;

      case "ARTICLE":
        // URL format: /blogs/{blogHandle}/{articleHandle}
        const articleMatch = pathname.match(/\/blogs\/([^/]+)\/([^/?]+)/);
        if (articleMatch) {
          result.blogHandle = articleMatch[1];
          result.articleHandle = articleMatch[2];
        }
        break;

      // HTTP - external link, no remapping needed
      // FRONTPAGE, CATALOG, SEARCH, SHOP_POLICY - no handle to extract
    }
  } catch (err) {
    // If URL parsing fails, just return empty result
    logger.debug("Failed to parse menu item URL", { url, error: String(err) });
  }

  return result;
}

/**
 * Transform menu item to dumped format with natural keys.
 */
function transformMenuItem(item: MenuItem): DumpedMenuItem {
  const dumped: DumpedMenuItem = {
    title: item.title,
    url: item.url,
    type: item.type,
  };

  // Extract resource handles if applicable
  const resource = extractResourceFromUrl(item.url, item.type);
  if (resource.productHandle) dumped.productHandle = resource.productHandle;
  if (resource.collectionHandle)
    dumped.collectionHandle = resource.collectionHandle;
  if (resource.pageHandle) dumped.pageHandle = resource.pageHandle;
  if (resource.blogHandle) dumped.blogHandle = resource.blogHandle;
  if (resource.articleHandle) dumped.articleHandle = resource.articleHandle;

  // Recursively transform nested items
  if (item.items && item.items.length > 0) {
    dumped.items = item.items.map(transformMenuItem);
  }

  return dumped;
}

// ============================================================================
// Core Dump Function
// ============================================================================

/**
 * Dump all menus from source store.
 */
export async function dumpMenus(
  client: GraphQLClient,
  outputFile: string
): Promise<Result<void, Error>> {
  logger.info("=== Dumping Menus ===");

  const menus: DumpedMenu[] = [];

  // Query all menus (typically < 10, so no pagination needed)
  const result = await client.request<{
    menus: {
      edges: Array<{ node: Menu }>;
    };
  }>({
    query: MENUS_QUERY,
    variables: { first: 50 },
  });

  if (!result.ok) {
    logger.error("Failed to query menus", { error: result.error.message });
    return { ok: false, error: result.error };
  }

  const menuEdges = result.data.data?.menus?.edges || [];

  for (const edge of menuEdges) {
    const menu = edge.node;

    const dumped: DumpedMenu = {
      handle: menu.handle,
      title: menu.title,
      items: menu.items.map(transformMenuItem),
    };

    menus.push(dumped);
  }

  // Ensure output directory exists
  const dir = path.dirname(outputFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write to file
  const content = JSON.stringify(menus, null, 2);
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(`✓ Dumped ${menus.length} menus to ${outputFile}`);
  return ok(undefined);
}
