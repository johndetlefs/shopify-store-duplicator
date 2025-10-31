/**
 * Markets dump operations: export market configuration from source store.
 *
 * Purpose:
 * - Extract all markets with their regions and web presences
 * - Preserve market settings (name, handle, enabled, primary)
 * - Export region configurations (countries, currencies)
 * - Export web presence settings (domains, subfolders, locales)
 *
 * Output Format:
 * - Single JSON file with array of markets
 * - Each market includes regions and web presences
 * - Natural keys preserved for cross-store remapping
 *
 * Natural Keys:
 * - Market: handle
 * - Region: countryCode (ISO 3166-1 alpha-2)
 * - Web Presence: domain host or "default" for primary domain
 *
 * Idempotency:
 * - Safe to re-run; overwrites previous dump file
 * - Always exports current state
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { GraphQLClient } from "../graphql/client.js";
import { MARKETS_QUERY } from "../graphql/queries.js";
import { logger } from "../utils/logger.js";
import { type Result, ok } from "../utils/types.js";
import type {
  DumpedMarket,
  DumpedMarketRegion,
  DumpedMarketWebPresence,
  MarketsDump,
} from "./types.js";

// ============================================================================
// GraphQL Response Types
// ============================================================================

interface MarketRegionNode {
  id: string;
  name: string;
  code?: string; // CountryCode enum (e.g., "US", "GB", "AU")
}

interface MarketWebPresenceNode {
  id: string;
  domain?: {
    id: string;
    host: string;
  };
  subfolderSuffix?: string;
  alternateLocales: Array<{ locale: string }>;
  defaultLocale: { locale: string };
}

interface MarketNode {
  id: string;
  name: string;
  handle: string;
  enabled: boolean;
  primary: boolean;
  priceList?: {
    id: string;
    name: string;
    currency: string; // CurrencyCode enum (e.g., "USD", "EUR")
  };
  regions: {
    edges: Array<{
      node: MarketRegionNode;
    }>;
  };
  webPresences: {
    edges: Array<{
      node: MarketWebPresenceNode;
    }>;
  };
}

interface MarketsQueryResponse {
  markets: {
    edges: Array<{
      node: MarketNode;
      cursor: string;
    }>;
    pageInfo: {
      hasNextPage: boolean;
      endCursor?: string;
    };
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Transform market region to dumped format.
 */
function transformRegion(region: MarketRegionNode): DumpedMarketRegion {
  // Use the code field directly instead of extracting from GID
  const countryCode = region.code || "";

  return {
    countryCode,
    name: region.name,
    currency: undefined, // Currency is set at the price list level, not per-region
    enabled: true, // Regions in the market are enabled
  };
}

/**
 * Transform market web presence to dumped format.
 */
function transformWebPresence(
  webPresence: MarketWebPresenceNode
): DumpedMarketWebPresence {
  return {
    domainHost: webPresence.domain?.host,
    subfolderSuffix: webPresence.subfolderSuffix,
    defaultLocale: webPresence.defaultLocale.locale,
    alternateLocales: webPresence.alternateLocales.map((l) => l.locale),
  };
}

/**
 * Transform market to dumped format.
 */
function transformMarket(market: MarketNode): DumpedMarket {
  const dumped: DumpedMarket = {
    name: market.name,
    handle: market.handle,
    enabled: market.enabled,
    primary: market.primary,
    regions: market.regions.edges.map((edge) => transformRegion(edge.node)),
    webPresences: market.webPresences.edges.map((edge) =>
      transformWebPresence(edge.node)
    ),
  };

  // Add price list if present
  if (market.priceList) {
    dumped.priceList = {
      name: market.priceList.name,
      currency: market.priceList.currency, // CurrencyCode enum (e.g., "USD")
    };
  }

  return dumped;
}

// ============================================================================
// Core Dump Function
// ============================================================================

/**
 * Dump all markets from source store.
 *
 * Queries all markets with pagination, extracting:
 * - Market settings (name, handle, enabled, primary)
 * - Regions with country codes and currencies
 * - Web presences with domains, subfolders, and locales
 * - Price list associations
 *
 * Output: JSON file with array of markets.
 *
 * @param client GraphQL client configured for source store
 * @param outputFile Path to output JSON file
 * @returns Result with success/error status
 */
export async function dumpMarkets(
  client: GraphQLClient,
  outputFile: string
): Promise<Result<void, Error>> {
  logger.info("=== Dumping Markets ===");

  const markets: DumpedMarket[] = [];
  let hasNextPage = true;
  let after: string | null = null;

  // Paginate through all markets
  while (hasNextPage) {
    logger.info(`Querying markets${after ? ` (after: ${after})` : ""}...`);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await client.request<MarketsQueryResponse>({
      query: MARKETS_QUERY,
      variables: { first: 50, after },
    });

    if (!result.ok) {
      logger.error("Failed to query markets", { error: result.error.message });
      return { ok: false, error: result.error };
    }

    const marketsData: MarketsQueryResponse["markets"] | undefined =
      result.data.data?.markets;
    if (!marketsData) {
      logger.warn("No markets data returned");
      break;
    }

    const marketEdges = marketsData.edges || [];
    logger.info(`Fetched ${marketEdges.length} markets`);

    // Transform and collect markets
    for (const edge of marketEdges) {
      const market = transformMarket(edge.node);
      markets.push(market);
      logger.debug(`  - ${market.name} (${market.handle})`, {
        regions: market.regions.length,
        webPresences: market.webPresences.length,
        primary: market.primary,
      });
    }

    // Check pagination
    hasNextPage = marketsData.pageInfo.hasNextPage;
    after = marketsData.pageInfo.endCursor ?? null;
  }

  // Prepare dump object
  const dump: MarketsDump = {
    markets,
    exportedAt: new Date().toISOString(),
  };

  // Ensure output directory exists
  const dir = path.dirname(outputFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Write to file
  const content = JSON.stringify(dump, null, 2);
  fs.writeFileSync(outputFile, content, "utf-8");

  logger.info(`✓ Dumped ${markets.length} markets to ${outputFile}`);
  logger.info(
    `  Primary market: ${markets.find((m) => m.primary)?.name || "none"}`
  );
  logger.info(
    `  Total regions: ${markets.reduce((sum, m) => sum + m.regions.length, 0)}`
  );
  logger.info(
    `  Total web presences: ${markets.reduce(
      (sum, m) => sum + m.webPresences.length,
      0
    )}`
  );

  return ok(undefined);
}
