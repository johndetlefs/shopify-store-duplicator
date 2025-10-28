/**
 * Dump metaobject and metafield definitions from source store.
 *
 * PURPOSE: Extract the complete schema (definitions) from source.
 * INPUTS: GraphQL client for source store.
 * OUTPUTS: JSON structure with metaobject + metafield definitions.
 * IDEMPOTENCY: Read-only operation, no side effects.
 */

import { logger } from "../utils/logger.js";
import { type GraphQLClient } from "../graphql/client.js";
import {
  METAOBJECT_DEFINITIONS_QUERY,
  METAFIELD_DEFINITIONS_QUERY,
} from "../graphql/queries.js";
import { type Result, ok, err, ShopifyApiError } from "../utils/types.js";

export interface MetaobjectDefinition {
  id: string;
  name: string;
  type: string;
  description?: string;
  displayNameKey?: string;
  fieldDefinitions: FieldDefinition[];
  capabilities?: {
    publishable?: { enabled: boolean };
    translatable?: { enabled: boolean };
    renderable?: {
      enabled: boolean;
      data?: {
        metaTitleKey?: string;
        metaDescriptionKey?: string;
      };
    };
    onlineStore?: {
      enabled: boolean;
      data?: {
        urlHandle?: string;
        canCreateRedirects?: boolean;
      };
    };
  };
}

export interface FieldDefinition {
  key: string;
  name: string;
  description?: string;
  required: boolean;
  type: {
    name: string;
  };
  validations?: Array<{
    name: string;
    value: string;
  }>;
}

export interface MetafieldDefinition {
  id: string;
  name: string;
  namespace: string;
  key: string;
  description?: string;
  type: {
    name: string;
  };
  ownerType: string;
  validations?: Array<{
    name: string;
    value: string;
  }>;
  pinnedPosition?: number;
}

export interface DefinitionsDump {
  metaobjectDefinitions: MetaobjectDefinition[];
  metafieldDefinitions: MetafieldDefinition[];
}

/**
 * Dump all metaobject definitions from the source store.
 */
export async function dumpMetaobjectDefinitions(
  client: GraphQLClient
): Promise<Result<MetaobjectDefinition[], ShopifyApiError>> {
  logger.info("Dumping metaobject definitions");

  const definitions: MetaobjectDefinition[] = [];

  try {
    for await (const def of client.paginate(
      METAOBJECT_DEFINITIONS_QUERY,
      {},
      {
        getEdges: (data) => data.metaobjectDefinitions.edges,
        getPageInfo: (data) => data.metaobjectDefinitions.pageInfo,
      }
    )) {
      definitions.push(def);
    }

    logger.info(`Dumped ${definitions.length} metaobject definitions`);
    return ok(definitions);
  } catch (error: any) {
    logger.error("Failed to dump metaobject definitions", {
      error: error.message,
    });
    return err(new ShopifyApiError(error.message));
  }
}

/**
 * Dump metafield definitions for specified owner types.
 */
export async function dumpMetafieldDefinitions(
  client: GraphQLClient,
  ownerTypes: string[] = [
    "PRODUCT",
    "PRODUCTVARIANT",
    "COLLECTION",
    "PAGE",
    "ARTICLE",
    "BLOG",
    "SHOP",
  ]
): Promise<Result<MetafieldDefinition[], ShopifyApiError>> {
  logger.info("Dumping metafield definitions", { ownerTypes });

  const definitions: MetafieldDefinition[] = [];

  try {
    for (const ownerType of ownerTypes) {
      logger.debug(`Dumping metafield definitions for ${ownerType}`);

      for await (const def of client.paginate(
        METAFIELD_DEFINITIONS_QUERY,
        { ownerType },
        {
          getEdges: (data) => data.metafieldDefinitions.edges,
          getPageInfo: (data) => data.metafieldDefinitions.pageInfo,
        }
      )) {
        definitions.push(def);
      }
    }

    logger.info(`Dumped ${definitions.length} metafield definitions`);
    return ok(definitions);
  } catch (error: any) {
    logger.error("Failed to dump metafield definitions", {
      error: error.message,
    });
    return err(new ShopifyApiError(error.message));
  }
}

/**
 * Dump all definitions (metaobjects + metafields) from source store.
 */
export async function dumpDefinitions(
  client: GraphQLClient
): Promise<Result<DefinitionsDump, ShopifyApiError>> {
  logger.info("Dumping all definitions");

  const metaobjectResult = await dumpMetaobjectDefinitions(client);
  if (!metaobjectResult.ok) {
    return err(metaobjectResult.error);
  }

  const metafieldResult = await dumpMetafieldDefinitions(client);
  if (!metafieldResult.ok) {
    return err(metafieldResult.error);
  }

  const dump: DefinitionsDump = {
    metaobjectDefinitions: metaobjectResult.data,
    metafieldDefinitions: metafieldResult.data,
  };

  logger.info("Definitions dump complete", {
    metaobjectDefinitions: dump.metaobjectDefinitions.length,
    metafieldDefinitions: dump.metafieldDefinitions.length,
  });

  return ok(dump);
}
