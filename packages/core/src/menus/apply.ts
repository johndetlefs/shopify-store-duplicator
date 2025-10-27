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
import { MENU_CREATE, MENU_UPDATE, MENUS_QUERY } from "../graphql/queries.js";
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
  type?: string;
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
 * If the item references a resource (product/collection/page), rebuild the URL
 * with the destination shop's domain. Otherwise, keep URL as-is.
 */
function remapMenuItemUrl(
  item: DumpedMenuItem,
  index: DestinationIndex,
  destinationShop: string
): string {
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
  destinationShop: string
): MenuItemInput {
  const input: MenuItemInput = {
    title: item.title,
    url: remapMenuItemUrl(item, index, destinationShop),
  };

  // Recursively transform nested items
  if (item.items && item.items.length > 0) {
    input.items = item.items.map((childItem) =>
      transformMenuItemForInput(childItem, index, destinationShop)
    );
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
      // Transform items with remapped URLs
      const items = menu.items.map((item) =>
        transformMenuItemForInput(item, index, destinationShop)
      );

      // Check if menu exists
      const existingId = await findMenuByHandle(client, menu.handle);

      if (existingId) {
        // Update existing menu
        logger.debug(`Updating menu: ${menu.handle}`);

        const result = await client.request({
          query: MENU_UPDATE,
          variables: {
            id: existingId,
            menu: {
              title: menu.title,
              items,
            },
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
          stats.errors.push({ handle: menu.handle, error: errorMsg });
          logger.error(`Menu update errors for ${menu.handle}:`, {
            errors: response.userErrors,
          });
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
            menu: {
              handle: menu.handle,
              title: menu.title,
              items,
            },
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
