/**
 * GraphQL client for Shopify Admin API.
 * Handles authentication, request/response, and error handling.
 */

import { logger } from "../utils/logger.js";
import { redactToken, safeError } from "../utils/redact.js";
import { withBackoff } from "../utils/retry.js";
import { ShopifyApiError, type Result, ok, err } from "../utils/types.js";

export interface GraphQLClientConfig {
  shop: string;
  accessToken: string;
  apiVersion?: string;
}

export interface GraphQLRequest {
  query: string;
  variables?: Record<string, any>;
}

export interface GraphQLResponse<T = any> {
  data?: T;
  errors?: Array<{
    message: string;
    extensions?: {
      code?: string;
      [key: string]: any;
    };
  }>;
  extensions?: {
    cost?: {
      requestedQueryCost: number;
      actualQueryCost: number;
      throttleStatus: {
        maximumAvailable: number;
        currentlyAvailable: number;
        restoreRate: number;
      };
    };
  };
}

/**
 * GraphQL client for Shopify Admin API.
 * Automatically retries on rate limits (429/430) with exponential backoff.
 */
export class GraphQLClient {
  private readonly endpoint: string;
  private readonly headers: Record<string, string>;

  constructor(private readonly config: GraphQLClientConfig) {
    const apiVersion = config.apiVersion || "2025-10";
    this.endpoint = `https://${config.shop}/admin/api/${apiVersion}/graphql.json`;
    this.headers = {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.accessToken,
    };
  }

  /**
   * Execute a GraphQL query or mutation.
   */
  async request<T = any>(
    request: GraphQLRequest
  ): Promise<Result<GraphQLResponse<T>, ShopifyApiError>> {
    return withBackoff(async () => {
      const startTime = Date.now();

      try {
        const response = await fetch(this.endpoint, {
          method: "POST",
          headers: this.headers,
          body: JSON.stringify(request),
        });

        const duration = Date.now() - startTime;
        const responseData = (await response.json()) as GraphQLResponse<T>;

        // Log cost information for monitoring
        if (responseData.extensions?.cost) {
          const cost = responseData.extensions.cost;
          logger.debug("GraphQL request cost", {
            actualCost: cost.actualQueryCost,
            available: cost.throttleStatus.currentlyAvailable,
            maximum: cost.throttleStatus.maximumAvailable,
            duration,
          });

          // Warn if approaching throttle limit
          const availablePercent =
            (cost.throttleStatus.currentlyAvailable /
              cost.throttleStatus.maximumAvailable) *
            100;
          if (availablePercent < 20) {
            logger.warn("Approaching GraphQL cost limit", {
              availablePercent: availablePercent.toFixed(1),
              currentlyAvailable: cost.throttleStatus.currentlyAvailable,
            });
          }
        }

        // Handle HTTP errors
        if (!response.ok) {
          const error = new ShopifyApiError(
            `HTTP ${response.status}: ${response.statusText}`,
            response.status,
            responseData
          );
          return err(error);
        }

        // Handle GraphQL errors
        if (responseData.errors && responseData.errors.length > 0) {
          const firstError = responseData.errors[0];

          // Check for throttle errors (code 430)
          const status =
            firstError.extensions?.code === "THROTTLED" ? 430 : response.status;

          const error = new ShopifyApiError(
            firstError.message,
            status,
            responseData
          );

          return err(error);
        }

        return ok(responseData);
      } catch (error: any) {
        logger.error("GraphQL request failed", safeError(error));
        return err(
          new ShopifyApiError(
            error.message || "Unknown error",
            undefined,
            error
          )
        );
      }
    });
  }

  /**
   * Execute a query with pagination support.
   * Automatically follows cursor-based pagination.
   */
  async *paginate<T = any>(
    query: string,
    variables: Record<string, any> = {},
    options: {
      pageSize?: number;
      getEdges: (data: any) => any[];
      getPageInfo: (data: any) => { hasNextPage: boolean; endCursor?: string };
    }
  ): AsyncGenerator<T, void, undefined> {
    const pageSize = options.pageSize || 250;
    let hasNextPage = true;
    let cursor: string | undefined;

    while (hasNextPage) {
      const result = await this.request({
        query,
        variables: {
          ...variables,
          first: pageSize,
          after: cursor,
        },
      });

      if (!result.ok) {
        throw result.error;
      }

      const edges = options.getEdges(result.data.data);
      for (const edge of edges) {
        yield edge.node as T;
      }

      const pageInfo = options.getPageInfo(result.data.data);
      hasNextPage = pageInfo.hasNextPage;
      cursor = pageInfo.endCursor;

      if (!hasNextPage) break;
    }
  }

  /**
   * Get the shop domain.
   */
  getShop(): string {
    return this.config.shop;
  }

  /**
   * Get a safe representation of the endpoint (with token redacted).
   */
  getSafeEndpoint(): string {
    return redactToken(this.endpoint);
  }
}

/**
 * Create a GraphQL client from configuration.
 */
export function createGraphQLClient(
  config: GraphQLClientConfig
): GraphQLClient {
  return new GraphQLClient(config);
}
