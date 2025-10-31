/**
 * Menu apply operations: import menus to destination store with link remapping.
 *
 * Purpose:
 * - Read dumped menu JSON
 * - Remap product/collection/page URLs to destination resources
 * - Create or update menus in destination store
 * - Preserve hierarchical structure
 *
 * Order of operations:
 * 1. Build destination index for URL remapping
 * 2. For each menu, transform items with remapped URLs
 * 3. Create menu (or update if exists)
 *
 * Idempotency:
 * - Queries existing menus by handle first
 * - Updates if exists, creates if missing
 * - Safe to re-run
 */

import * as fs from "node:fs";
import { GraphQLClient } from "../graphql/client.js";
import {
  MENU_CREATE,
  MENU_UPDATE,
  MENUS_QUERY,
  SHOP_INFO_QUERY,
} from "../graphql/queries.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";
import { type DestinationIndex } from "../map/ids.js";

// ============================================================================
// Types
// ============================================================================

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

interface DumpedMenu {
  handle: string;
  title: string;
  items: DumpedMenuItem[];
}

interface MenuItemInput {
  title: string;
  url: string;
  type: string;
  resourceId?: string;
  items?: MenuItemInput[];
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
// URL Remapping
// ============================================================================

/**
 * Remap a menu item URL using the destination index.
 * If the item references a resource (product/collection/page/blog/article), rebuild the URL
 * with the destination shop's domain. Otherwise, keep URL as-is.
 */
function remapMenuItemUrl(
  item: DumpedMenuItem,
  index: DestinationIndex,
  destinationShop: string,
  customerAccountUrl?: string
): string {
  // Handle customer account pages - use the destination store's customer account URL
  if (item.type === "CUSTOMER_ACCOUNT_PAGE") {
    // Customer account URLs should use the store's customer account URL
    // Extract the page path (e.g., "/account/orders" -> "orders")
    const accountMatch = item.url.match(/\/account\/([^?#/]+)/);
    if (accountMatch && customerAccountUrl) {
      // customerAccountUrl is like "https://shopify.com/{store-id}/account"
      // We need to append the specific page like "/orders"
      const pagePath = accountMatch[1];
      // Remove trailing /account if present, then add /account/{page}
      const baseUrl = customerAccountUrl.replace(/\/account$/, "");
      return `${baseUrl}/account/${pagePath}`;
    }
    // Fallback to relative URL if no customerAccountUrl provided
    if (accountMatch) {
      return `/account/${accountMatch[1]}`;
    }
    // If already in correct format
    if (item.url.startsWith("/account/")) {
      return item.url;
    }
    // Fallback
    logger.warn(
      `Could not parse customer account page URL: ${item.url}, using as-is`
    );
    return item.url;
  }

  // If we have a natural key, try to remap
  if (item.productHandle && index.products.has(item.productHandle)) {
    return `/products/${item.productHandle}`;
  }

  if (item.collectionHandle && index.collections.has(item.collectionHandle)) {
    return `/collections/${item.collectionHandle}`;
  }

  if (item.pageHandle && index.pages.has(item.pageHandle)) {
    return `/pages/${item.pageHandle}`;
  }

  if (item.blogHandle && index.blogs.has(item.blogHandle)) {
    // For articles, need both blog and article handles
    if (item.articleHandle) {
      // Construct article URL: /blogs/{blogHandle}/{articleHandle}
      return `/blogs/${item.blogHandle}/${item.articleHandle}`;
    }
    // For blog-only links
    return `/blogs/${item.blogHandle}`;
  }

  // For other types (HTTP, FRONTPAGE, etc.) or if resource not found, use original URL
  // Note: External HTTP links will be preserved as-is
  return item.url;
}

/**
 * Transform dumped menu item to GraphQL input format with remapped URLs.
 */
function transformMenuItemForInput(
  item: DumpedMenuItem,
  index: DestinationIndex,
  destinationShop: string,
  customerAccountUrl?: string
): MenuItemInput | null {
  // Skip CUSTOMER_ACCOUNT_PAGE items - these are not supported via Admin GraphQL API
  // Customer account pages need to be configured through the Shopify admin UI
  if (item.type === "CUSTOMER_ACCOUNT_PAGE") {
    logger.warn(
      `Skipping customer account page menu item "${item.title}" - not supported via API`
    );
    return null;
  }

  const input: MenuItemInput = {
    title: item.title,
    url: remapMenuItemUrl(item, index, destinationShop, customerAccountUrl),
    type: item.type,
  };

  // Add resourceId if we have a reference to a destination resource
  if (item.productHandle && index.products.has(item.productHandle)) {
    input.resourceId = index.products.get(item.productHandle);
  } else if (
    item.collectionHandle &&
    index.collections.has(item.collectionHandle)
  ) {
    input.resourceId = index.collections.get(item.collectionHandle);
  } else if (item.pageHandle && index.pages.has(item.pageHandle)) {
    input.resourceId = index.pages.get(item.pageHandle);
  } else if (item.blogHandle && index.blogs.has(item.blogHandle)) {
    input.resourceId = index.blogs.get(item.blogHandle);
  } else if (item.articleHandle && item.blogHandle) {
    // Articles use composite key: {blogHandle}:{articleHandle}
    const articleKey = `${item.blogHandle}:${item.articleHandle}`;
    if (index.articles.has(articleKey)) {
      input.resourceId = index.articles.get(articleKey);
    }
  }

  // Recursively transform nested items, filtering out nulls
  if (item.items && item.items.length > 0) {
    const transformedItems = item.items
      .map((childItem) =>
        transformMenuItemForInput(
          childItem,
          index,
          destinationShop,
          customerAccountUrl
        )
      )
      .filter((item): item is MenuItemInput => item !== null);
    if (transformedItems.length > 0) {
      input.items = transformedItems;
    }
  }

  return input;
}

// ============================================================================
// Menu Lookup
// ============================================================================

/**
 * Find existing menu by handle in destination store.
 */
async function findMenuByHandle(
  client: GraphQLClient,
  handle: string
): Promise<string | undefined> {
  const result = await client.request<{
    menus: {
      edges: Array<{
        node: {
          id: string;
          handle: string;
        };
      }>;
    };
  }>({
    query: MENUS_QUERY,
    variables: { first: 50 },
  });

  if (!result.ok) {
    logger.warn("Failed to query menus for lookup", {
      error: result.error.message,
    });
    return undefined;
  }

  const menus = result.data.data?.menus?.edges || [];
  const found = menus.find((edge) => edge.node.handle === handle);
  return found?.node.id;
}

// ============================================================================
// Apply Menus
// ============================================================================

/**
 * Apply menus from dump file to destination store.
 */
export async function applyMenus(
  client: GraphQLClient,
  inputFile: string,
  index: DestinationIndex,
  destinationShop: string
): Promise<Result<ApplyStats, Error>> {
  logger.info("=== Applying Menus ===");

  const stats: ApplyStats = {
    total: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Query shop info to get customer account URL
  let customerAccountUrl: string | undefined;
  try {
    const shopInfoResult = await client.request<{
      shop: {
        customerAccountsV2?: {
          url?: string;
        };
      };
    }>({
      query: SHOP_INFO_QUERY,
    });

    if (shopInfoResult.ok) {
      customerAccountUrl =
        shopInfoResult.data.data?.shop?.customerAccountsV2?.url;
      if (customerAccountUrl) {
        logger.info(
          `Found customer account URL: ${customerAccountUrl.replace(
            /\/account$/,
            ""
          )}`
        );
      } else {
        logger.warn(
          "No customer account URL found - customer account page links may not work"
        );
      }
    }
  } catch (error) {
    logger.warn("Failed to query shop info for customer account URL", {
      error: String(error),
    });
  }

  // Read dump file
  if (!fs.existsSync(inputFile)) {
    logger.warn(`Menus dump not found: ${inputFile}`);
    return ok(stats);
  }

  const content = fs.readFileSync(inputFile, "utf-8");
  const menus: DumpedMenu[] = JSON.parse(content);

  for (const menu of menus) {
    stats.total++;

    try {
      // Transform items with remapped URLs, filtering out null (skipped) items
      const items = menu.items
        .map((item) =>
          transformMenuItemForInput(
            item,
            index,
            destinationShop,
            customerAccountUrl
          )
        )
        .filter((item): item is MenuItemInput => item !== null);

      // Check if menu exists
      const existingId = await findMenuByHandle(client, menu.handle);

      if (existingId) {
        // Update existing menu
        logger.debug(`Updating menu: ${menu.handle}`);

        const result = await client.request({
          query: MENU_UPDATE,
          variables: {
            id: existingId,
            title: menu.title,
            handle: menu.handle,
            items,
          },
        });

        if (!result.ok) {
          stats.failed++;
          stats.errors.push({
            handle: menu.handle,
            error: result.error.message,
          });
          logger.error(`Failed to update menu: ${menu.handle}`, {
            error: result.error.message,
          });
          continue;
        }

        const response = result.data.data?.menuUpdate;
        if (response?.userErrors && response.userErrors.length > 0) {
          stats.failed++;
          const errorMsg = response.userErrors
            .map((e: any) => e.message)
            .join(", ");

          // Special handling for customer account page errors
          if (errorMsg.includes("customer_account_page not found")) {
            const enhancedError = `${errorMsg}. Note: Customer account page links may require the New Customer Accounts to be enabled in the destination store (Settings → Customer accounts → New customer accounts).`;
            stats.errors.push({ handle: menu.handle, error: enhancedError });
            logger.error(`Menu update errors for ${menu.handle}:`, {
              errors: response.userErrors,
              note: "Customer account pages require New Customer Accounts to be enabled",
            });
          } else {
            stats.errors.push({ handle: menu.handle, error: errorMsg });
            logger.error(`Menu update errors for ${menu.handle}:`, {
              errors: response.userErrors,
            });
          }
          continue;
        }

        stats.updated++;
        logger.debug(`✓ Updated menu: ${menu.handle}`);
      } else {
        // Create new menu
        logger.debug(`Creating menu: ${menu.handle}`);

        const result = await client.request({
          query: MENU_CREATE,
          variables: {
            title: menu.title,
            handle: menu.handle,
            items,
          },
        });

        if (!result.ok) {
          stats.failed++;
          stats.errors.push({
            handle: menu.handle,
            error: result.error.message,
          });
          logger.error(`Failed to create menu: ${menu.handle}`, {
            error: result.error.message,
          });
          continue;
        }

        const response = result.data.data?.menuCreate;
        if (response?.userErrors && response.userErrors.length > 0) {
          stats.failed++;
          const errorMsg = response.userErrors
            .map((e: any) => e.message)
            .join(", ");
          stats.errors.push({ handle: menu.handle, error: errorMsg });
          logger.error(`Menu creation errors for ${menu.handle}:`, {
            errors: response.userErrors,
          });
          continue;
        }

        stats.created++;
        logger.debug(`✓ Created menu: ${menu.handle}`);
      }
    } catch (error) {
      stats.failed++;
      stats.errors.push({ handle: menu.handle, error: String(error) });
      logger.error(`Exception applying menu: ${menu.handle}`, {
        error: String(error),
      });
    }
  }

  logger.info(
    `✓ Applied ${stats.created + stats.updated} menus (${
      stats.created
    } created, ${stats.updated} updated, ${stats.failed} failed)`
  );
  return ok(stats);
}
