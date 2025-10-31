/**
 * Markets apply operations: import markets configuration to destination store.
 *
 * Purpose:
 * - Read dumped markets JSON
 * - Create or update markets in destination store
 * - Configure regions (countries) via market conditions
 * - Configure web presences (domains, subfolders, locales)
 *
 * Order of Operations:
 * 1. Query existing markets in destination (by handle)
 * 2. For each dumped market:
 *    a. Create or update market (name, enabled status, regions via conditions)
 *    b. Create or update web presences
 *
 * Regions Management:
 * - For marketCreate: Use conditions.regionsCondition.regions with countryCode array
 * - For marketUpdate: Use conditions.conditionsToAdd.regionsCondition.regions (additive)
 * - Region country codes are 2-letter ISO codes (e.g., "US", "GB", "AU")
 *
 * Idempotency:
 * - Updates existing markets by handle
 * - Creates if missing
 * - Regions are set/updated via conditions (idempotent)
 * - Web presences are created/updated as needed
 *
 * Limitations:
 * - Primary market cannot be changed (Shopify restriction)
 * - DNS configuration for custom domains must be done manually
 * - Some features may require specific Shopify plans
 * - Currency/region availability depends on store settings
 */

import * as fs from "node:fs";
import { GraphQLClient } from "../graphql/client.js";
import {
  MARKET_CREATE,
  MARKET_UPDATE,
  MARKET_WEB_PRESENCE_CREATE,
  MARKET_WEB_PRESENCE_UPDATE,
  MARKETS_QUERY,
} from "../graphql/queries.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";
import { chunkArray } from "../utils/chunk.js";
import type { DumpedMarket, MarketsDump, MarketsApplyStats } from "./types.js";

// ============================================================================
// Types
// ============================================================================

interface ExistingMarket {
  id: string;
  name: string;
  handle: string;
  enabled: boolean;
  primary: boolean;
  regions: {
    edges: Array<{
      node: {
        id: string;
        name: string;
      };
    }>;
  };
  webPresences: {
    edges: Array<{
      node: {
        id: string;
        domain?: {
          id: string;
          host: string;
        };
        subfolderSuffix?: string;
        defaultLocale: { locale: string };
        alternateLocales: Array<{ locale: string }>;
      };
    }>;
  };
}

interface MarketRegion {
  id: string;
  name: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Query all existing markets in destination.
 */
async function queryExistingMarkets(
  client: GraphQLClient
): Promise<Result<Map<string, ExistingMarket>, Error>> {
  const marketsMap = new Map<string, ExistingMarket>();
  let hasNextPage = true;
  let after: string | null = null;

  while (hasNextPage) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await client.request({
      query: MARKETS_QUERY,
      variables: { first: 50, after },
    });

    if (!result.ok) {
      return { ok: false, error: result.error };
    }

    const marketsData = result.data.data?.markets;
    if (!marketsData) {
      break;
    }

    for (const edge of marketsData.edges || []) {
      const market = edge.node as ExistingMarket;
      marketsMap.set(market.handle, market);
    }

    hasNextPage = marketsData.pageInfo?.hasNextPage || false;
    after = marketsData.pageInfo?.endCursor ?? null;
  }

  logger.info(`Found ${marketsMap.size} existing markets in destination`);
  return ok(marketsMap);
}

/**
 * Create a new market.
 */
async function createMarket(
  client: GraphQLClient,
  market: DumpedMarket
): Promise<Result<string, Error>> {
  logger.info(`Creating market: ${market.name} (${market.handle})`);

  // Prepare regions as countryCode objects
  const regions = market.regions.map((region) => ({
    countryCode: region.countryCode,
  }));

  if (regions.length === 0) {
    return err(
      new Error(
        `No valid regions found for market ${market.handle}. Cannot create market without regions.`
      )
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await client.request({
    query: MARKET_CREATE,
    variables: {
      input: {
        name: market.name,
        handle: market.handle,
        enabled: market.enabled,
        conditions: {
          regionsCondition: {
            regions,
          },
        },
      },
    },
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const marketData = result.data.data?.marketCreate;
  if (marketData?.userErrors && marketData.userErrors.length > 0) {
    const errors = marketData.userErrors
      .map((e: { message: string }) => e.message)
      .join(", ");
    return err(new Error(`Failed to create market: ${errors}`));
  }

  const marketId = marketData?.market?.id;
  if (!marketId) {
    return err(new Error("No market ID returned from marketCreate"));
  }

  logger.info(`✓ Created market: ${market.name} (ID: ${marketId})`);
  return ok(marketId);
}

/**
 * Update an existing market.
 */
async function updateMarket(
  client: GraphQLClient,
  market: DumpedMarket,
  existingMarket: ExistingMarket
): Promise<Result<string, Error>> {
  logger.info(`Updating market: ${market.name} (${market.handle})`);

  // Don't try to modify primary market status - Shopify doesn't allow this
  if (existingMarket.primary && !market.primary) {
    logger.warn(
      `Cannot change primary status of market ${market.handle} - skipping primary field`
    );
  }

  // For updates, regions are managed via conditionsToAdd/conditionsToDelete
  // We'll set the full region list by adding all regions
  const regions = market.regions.map((region) => ({
    countryCode: region.countryCode,
  }));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await client.request({
    query: MARKET_UPDATE,
    variables: {
      id: existingMarket.id,
      input: {
        name: market.name,
        enabled: market.enabled,
        conditions: {
          conditionsToAdd: {
            regionsCondition: {
              regions,
            },
          },
        },
      },
    },
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  const marketData = result.data.data?.marketUpdate;
  if (marketData?.userErrors && marketData.userErrors.length > 0) {
    const errors = marketData.userErrors
      .map((e: { message: string }) => e.message)
      .join(", ");
    return err(new Error(`Failed to update market: ${errors}`));
  }

  logger.info(`✓ Updated market: ${market.name}`);
  return ok(existingMarket.id);
}

/**
 * Regions are now set directly in marketCreate/marketUpdate via conditions.regionsCondition.
 * This function is kept for API compatibility but is a no-op.
 */
async function registerRegions(
  _client: GraphQLClient,
  _marketId: string,
  market: DumpedMarket,
  _existingMarket: ExistingMarket | undefined
): Promise<Result<number, Error>> {
  // Regions are set via the market create/update mutations
  logger.info(
    `✓ Regions configured for market ${market.handle} (${market.regions.length} regions)`
  );
  return ok(market.regions.length);
}

/**
 * Create or update web presences for a market.
 */
async function applyWebPresences(
  client: GraphQLClient,
  marketId: string,
  market: DumpedMarket,
  existingMarket: ExistingMarket | undefined
): Promise<Result<{ created: number; updated: number }, Error>> {
  let created = 0;
  let updated = 0;

  if (market.webPresences.length === 0) {
    logger.info(`No web presences to apply for market ${market.handle}`);
    return ok({ created, updated });
  }

  // Build map of existing web presences by domain host (or "default")
  const existingWebPresences = new Map<
    string,
    ExistingMarket["webPresences"]["edges"][0]["node"]
  >();
  if (existingMarket) {
    for (const edge of existingMarket.webPresences.edges) {
      const key = edge.node.domain?.host || "default";
      existingWebPresences.set(key, edge.node);
    }
  }

  for (const webPresence of market.webPresences) {
    const key = webPresence.domainHost || "default";
    const existing = existingWebPresences.get(key);

    if (existing) {
      // Update existing web presence
      logger.info(`Updating web presence for market ${market.handle}: ${key}`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await client.request({
        query: MARKET_WEB_PRESENCE_UPDATE,
        variables: {
          id: existing.id,
          webPresence: {
            defaultLocale: webPresence.defaultLocale,
            alternateLocales: webPresence.alternateLocales,
            subfolderSuffix: webPresence.subfolderSuffix,
          },
        },
      });

      if (!result.ok) {
        logger.warn(
          `Failed to update web presence for market ${market.handle}`,
          {
            error: result.error.message,
            key,
          }
        );
        continue;
      }

      const data = result.data.data?.marketWebPresenceUpdate;
      if (data?.userErrors && data.userErrors.length > 0) {
        const errors = data.userErrors
          .map((e: { message: string }) => e.message)
          .join(", ");
        logger.warn(
          `Errors updating web presence for market ${market.handle}: ${errors}`
        );
        continue;
      }

      updated++;
      logger.info(`✓ Updated web presence: ${key}`);
    } else {
      // Create new web presence
      logger.info(`Creating web presence for market ${market.handle}: ${key}`);

      // Note: Domain must be configured separately in Shopify admin
      // We can only set up subfolder-based web presences or use the default domain
      const webPresenceInput: {
        defaultLocale: string;
        alternateLocales?: string[];
        subfolderSuffix?: string;
        domainId?: string;
      } = {
        defaultLocale: webPresence.defaultLocale,
        alternateLocales: webPresence.alternateLocales,
        subfolderSuffix: webPresence.subfolderSuffix,
      };

      // Note: We can't automatically assign a custom domain - that requires DNS configuration
      // and domain verification. Skip domainId for now and log a warning.
      if (webPresence.domainHost && webPresence.domainHost !== "default") {
        logger.warn(
          `Custom domain ${webPresence.domainHost} must be configured manually in Shopify admin`,
          {
            marketHandle: market.handle,
            instructions:
              "Add domain in: Settings → Domains → Connect existing domain",
          }
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result: any = await client.request({
        query: MARKET_WEB_PRESENCE_CREATE,
        variables: {
          marketId,
          webPresence: webPresenceInput,
        },
      });

      if (!result.ok) {
        logger.warn(
          `Failed to create web presence for market ${market.handle}`,
          {
            error: result.error.message,
            key,
          }
        );
        continue;
      }

      const data = result.data.data?.marketWebPresenceCreate;
      if (data?.userErrors && data.userErrors.length > 0) {
        const errors = data.userErrors
          .map((e: { message: string }) => e.message)
          .join(", ");
        logger.warn(
          `Errors creating web presence for market ${market.handle}: ${errors}`
        );
        continue;
      }

      created++;
      logger.info(`✓ Created web presence: ${key}`);
    }
  }

  return ok({ created, updated });
}

// ============================================================================
// Core Apply Function
// ============================================================================

/**
 * Apply markets configuration from dump file to destination store.
 *
 * Reads the dumped markets JSON and:
 * 1. Creates or updates markets by handle
 * 2. Registers regions (countries) to each market
 * 3. Creates or updates web presences (domains, subfolders, locales)
 *
 * Idempotent: Safe to re-run. Updates existing markets, creates new ones.
 *
 * @param client GraphQL client configured for destination store
 * @param inputFile Path to dumped markets JSON file
 * @returns Result with statistics or error
 */
export async function applyMarkets(
  client: GraphQLClient,
  inputFile: string
): Promise<Result<MarketsApplyStats, Error>> {
  logger.info("=== Applying Markets ===");

  const stats: MarketsApplyStats = {
    marketsCreated: 0,
    marketsUpdated: 0,
    marketsSkipped: 0,
    marketsFailed: 0,
    regionsRegistered: 0,
    regionsRemoved: 0,
    webPresencesCreated: 0,
    webPresencesUpdated: 0,
    webPresencesFailed: 0,
    errors: [],
  };

  try {
    // Read dump file
    if (!fs.existsSync(inputFile)) {
      return err(new Error(`Input file not found: ${inputFile}`));
    }

    const content = fs.readFileSync(inputFile, "utf-8");
    const dump: MarketsDump = JSON.parse(content);

    logger.info(`Loaded ${dump.markets.length} markets from ${inputFile}`);

    // Query existing markets
    const existingResult = await queryExistingMarkets(client);
    if (!existingResult.ok) {
      return { ok: false, error: existingResult.error };
    }
    const existingMarkets = existingResult.data;

    // Process each market
    for (const market of dump.markets) {
      try {
        logger.info(
          `Processing market: ${market.name} (${market.handle}, primary: ${market.primary})`
        );

        const existing = existingMarkets.get(market.handle);

        // Skip primary market if it exists and we're trying to change its status
        if (existing?.primary && !market.primary) {
          logger.warn(
            `Skipping market ${market.handle} - cannot change primary market status`
          );
          stats.marketsSkipped++;
          continue;
        }

        // Create or update market
        let marketId: string;
        if (existing) {
          const updateResult = await updateMarket(client, market, existing);
          if (!updateResult.ok) {
            stats.marketsFailed++;
            stats.errors.push({
              market: market.handle,
              error: updateResult.error.message,
            });
            continue;
          }
          marketId = updateResult.data;
          stats.marketsUpdated++;
        } else {
          const createResult = await createMarket(client, market);
          if (!createResult.ok) {
            stats.marketsFailed++;
            stats.errors.push({
              market: market.handle,
              error: createResult.error.message,
            });
            continue;
          }
          marketId = createResult.data;
          stats.marketsCreated++;
        }

        // Register regions (no-op, regions set via marketCreate/marketUpdate)
        const regionsResult = await registerRegions(
          client,
          marketId,
          market,
          existing
        );
        if (regionsResult.ok) {
          stats.regionsRegistered += regionsResult.data;
        }

        // Apply web presences
        const webPresencesResult = await applyWebPresences(
          client,
          marketId,
          market,
          existing
        );
        if (webPresencesResult.ok) {
          stats.webPresencesCreated += webPresencesResult.data.created;
          stats.webPresencesUpdated += webPresencesResult.data.updated;
        } else {
          stats.webPresencesFailed += market.webPresences.length;
        }
      } catch (error) {
        logger.error(`Error processing market ${market.handle}`, { error });
        stats.marketsFailed++;
        stats.errors.push({
          market: market.handle,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Log summary
    logger.info("=== Markets Apply Complete ===");
    logger.info(`  Markets created: ${stats.marketsCreated}`);
    logger.info(`  Markets updated: ${stats.marketsUpdated}`);
    logger.info(`  Markets skipped: ${stats.marketsSkipped}`);
    logger.info(`  Markets failed: ${stats.marketsFailed}`);
    logger.info(`  Regions registered: ${stats.regionsRegistered}`);
    logger.info(`  Web presences created: ${stats.webPresencesCreated}`);
    logger.info(`  Web presences updated: ${stats.webPresencesUpdated}`);

    if (stats.errors.length > 0) {
      logger.warn(`Encountered ${stats.errors.length} errors:`);
      for (const error of stats.errors) {
        logger.warn(`  - ${error.market}: ${error.error}`);
      }
    }

    return ok(stats);
  } catch (error) {
    logger.error("Error applying markets", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
