/**
 * Markets Types
 *
 * Type definitions for Shopify Markets configuration.
 */

/**
 * Market region configuration
 * Natural key: countryCode (ISO 3166-1 alpha-2)
 */
export interface DumpedMarketRegion {
  /** ISO 3166-1 alpha-2 country code (e.g., "US", "CA") */
  countryCode: string;
  /** Region name */
  name: string;
  /** Currency code for this region (ISO 4217) */
  currency?: string;
  /** Whether this region is enabled in the market */
  enabled: boolean;
}

/**
 * Market web presence configuration
 * Represents domain or subfolder-based market access
 */
export interface DumpedMarketWebPresence {
  /** Domain host if using domain-based market, or "default" for primary domain */
  domainHost?: string;
  /** Subfolder suffix if using subfolder-based market (e.g., "/en-us") */
  subfolderSuffix?: string;
  /** Default locale for this web presence (e.g., "en-US") */
  defaultLocale: string;
  /** Alternate locales available (e.g., ["en-CA", "fr-CA"]) */
  alternateLocales: string[];
}

/**
 * Complete market configuration
 * Natural key: handle
 */
export interface DumpedMarket {
  /** Market name (e.g., "United States") */
  name: string;
  /** Market handle - natural key (e.g., "united-states") */
  handle: string;
  /** Whether this market is enabled */
  enabled: boolean;
  /** Whether this is the primary market (only one can be primary) */
  primary: boolean;
  /** Price list associated with this market */
  priceList?: {
    name: string;
    currency: string;
  };
  /** Regions included in this market */
  regions: DumpedMarketRegion[];
  /** Web presences for this market (domains/subfolders) */
  webPresences: DumpedMarketWebPresence[];
}

/**
 * Complete markets dump
 */
export interface MarketsDump {
  markets: DumpedMarket[];
  exportedAt: string;
}

/**
 * Statistics from applying markets
 */
export interface MarketsApplyStats {
  marketsCreated: number;
  marketsUpdated: number;
  marketsSkipped: number;
  marketsFailed: number;
  regionsRegistered: number;
  regionsRemoved: number;
  webPresencesCreated: number;
  webPresencesUpdated: number;
  webPresencesFailed: number;
  errors: Array<{ market: string; error: string }>;
}
