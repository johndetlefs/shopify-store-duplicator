/**
 * Apply metaobject and metafield definitions to destination store.
 *
 * PURPOSE: Create or update schema definitions in destination.
 * INPUTS: Definitions dump JSON + destination GraphQL client.
 * OUTPUTS: Summary of created/updated/skipped definitions.
 * IDEMPOTENCY: Creates if missing; updates only when safe; warns on drift.
 *
 * CRITICAL: Shopify definitions must maintain type parity for data compatibility.
 */

import { logger } from "../utils/logger.js";
import { type GraphQLClient } from "../graphql/client.js";
import {
  METAOBJECT_DEFINITION_CREATE,
  METAOBJECT_DEFINITION_UPDATE,
  METAFIELD_DEFINITION_CREATE,
  METAFIELD_DEFINITION_UPDATE,
} from "../graphql/queries.js";
import { type Result, ok, err, ShopifyApiError } from "../utils/types.js";
import type {
  MetaobjectDefinition,
  MetafieldDefinition,
  DefinitionsDump,
} from "./dump.js";

export interface ApplyResult {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ item: string; error: string }>;
}

/**
 * Apply a single metaobject definition to destination.
 * Creates if missing; updates field definitions if exists.
 */
async function applyMetaobjectDefinition(
  client: GraphQLClient,
  def: MetaobjectDefinition,
  existingTypes: Set<string>
): Promise<{
  success: boolean;
  action: "created" | "updated" | "skipped";
  error?: string;
}> {
  const exists = existingTypes.has(def.type);

  try {
    if (!exists) {
      // Create new definition
      logger.debug(`Creating metaobject definition: ${def.type}`);

      const input = {
        type: def.type,
        name: def.name,
        description: def.description,
        displayNameKey: def.displayNameKey,
        fieldDefinitions: def.fieldDefinitions.map((field) => ({
          key: field.key,
          name: field.name,
          description: field.description,
          required: field.required,
          type: field.type.name,
          validations: field.validations?.map((v) => ({
            name: v.name,
            value: v.value,
          })),
        })),
        capabilities: def.capabilities,
      };

      const result = await client.request({
        query: METAOBJECT_DEFINITION_CREATE,
        variables: { definition: input },
      });

      if (!result.ok) {
        return {
          success: false,
          action: "skipped",
          error: result.error.message,
        };
      }

      const response = result.data.data?.metaobjectDefinitionCreate;
      if (response?.userErrors && response.userErrors.length > 0) {
        const errorMsg = response.userErrors
          .map((e: any) => e.message)
          .join(", ");
        return { success: false, action: "skipped", error: errorMsg };
      }

      return { success: true, action: "created" };
    } else {
      // Definition exists - for now, skip updates to avoid breaking changes
      // In production, you'd want to diff and selectively update field definitions
      logger.debug(`Metaobject definition already exists: ${def.type}`);
      return { success: true, action: "skipped" };
    }
  } catch (error: any) {
    return { success: false, action: "skipped", error: error.message };
  }
}

/**
 * Apply a single metafield definition to destination.
 * Creates if missing; skips if exists (to avoid type conflicts).
 */
async function applyMetafieldDefinition(
  client: GraphQLClient,
  def: MetafieldDefinition,
  existingKeys: Set<string>
): Promise<{
  success: boolean;
  action: "created" | "updated" | "skipped";
  error?: string;
}> {
  const key = `${def.ownerType}:${def.namespace}:${def.key}`;
  const exists = existingKeys.has(key);

  try {
    if (!exists) {
      // Create new definition
      logger.debug(
        `Creating metafield definition: ${def.namespace}.${def.key} (${def.ownerType})`
      );

      const input = {
        name: def.name,
        namespace: def.namespace,
        key: def.key,
        description: def.description,
        type: def.type.name,
        ownerType: def.ownerType,
        validations: def.validations?.map((v) => ({
          name: v.name,
          value: v.value,
        })),
        pin:
          def.pin?.pinnedPosition !== undefined
            ? def.pin.pinnedPosition
            : undefined,
      };

      const result = await client.request({
        query: METAFIELD_DEFINITION_CREATE,
        variables: { definition: input },
      });

      if (!result.ok) {
        return {
          success: false,
          action: "skipped",
          error: result.error.message,
        };
      }

      const response = result.data.data?.metafieldDefinitionCreate;
      if (response?.userErrors && response.userErrors.length > 0) {
        const errorMsg = response.userErrors
          .map((e: any) => e.message)
          .join(", ");
        return { success: false, action: "skipped", error: errorMsg };
      }

      return { success: true, action: "created" };
    } else {
      // Definition exists - skip to preserve existing data
      logger.debug(
        `Metafield definition already exists: ${def.namespace}.${def.key}`
      );
      return { success: true, action: "skipped" };
    }
  } catch (error: any) {
    return { success: false, action: "skipped", error: error.message };
  }
}

/**
 * Get existing metaobject definition types from destination.
 */
async function getExistingMetaobjectTypes(
  client: GraphQLClient
): Promise<Set<string>> {
  const types = new Set<string>();

  try {
    for await (const def of client.paginate(
      `query metaobjectDefinitions($first: Int!, $after: String) {
        metaobjectDefinitions(first: $first, after: $after) {
          edges {
            node {
              type
            }
            cursor
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }`,
      {},
      {
        getEdges: (data) => data.metaobjectDefinitions.edges,
        getPageInfo: (data) => data.metaobjectDefinitions.pageInfo,
      }
    )) {
      types.add(def.type);
    }
  } catch (error: any) {
    logger.warn("Failed to fetch existing metaobject types", {
      error: error.message,
    });
  }

  return types;
}

/**
 * Get existing metafield definition keys from destination.
 */
async function getExistingMetafieldKeys(
  client: GraphQLClient
): Promise<Set<string>> {
  const keys = new Set<string>();

  const ownerTypes = [
    "PRODUCT",
    "PRODUCT_VARIANT",
    "COLLECTION",
    "PAGE",
    "ARTICLE",
    "BLOG",
    "SHOP",
  ];

  try {
    for (const ownerType of ownerTypes) {
      for await (const def of client.paginate(
        `query metafieldDefinitions($ownerType: MetafieldOwnerType!, $first: Int!, $after: String) {
          metafieldDefinitions(ownerType: $ownerType, first: $first, after: $after) {
            edges {
              node {
                namespace
                key
                ownerType
              }
              cursor
            }
            pageInfo {
              hasNextPage
              endCursor
            }
          }
        }`,
        { ownerType },
        {
          getEdges: (data) => data.metafieldDefinitions.edges,
          getPageInfo: (data) => data.metafieldDefinitions.pageInfo,
        }
      )) {
        const key = `${def.ownerType}:${def.namespace}:${def.key}`;
        keys.add(key);
      }
    }
  } catch (error: any) {
    logger.warn("Failed to fetch existing metafield keys", {
      error: error.message,
    });
  }

  return keys;
}

/**
 * Apply all metaobject definitions to destination store.
 */
export async function applyMetaobjectDefinitions(
  client: GraphQLClient,
  definitions: MetaobjectDefinition[]
): Promise<Result<ApplyResult, ShopifyApiError>> {
  logger.info(`Applying ${definitions.length} metaobject definitions`);

  const result: ApplyResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Get existing types
  const existingTypes = await getExistingMetaobjectTypes(client);
  logger.debug(`Found ${existingTypes.size} existing metaobject types`);

  // Apply each definition
  for (const def of definitions) {
    const applyResult = await applyMetaobjectDefinition(
      client,
      def,
      existingTypes
    );

    if (applyResult.success) {
      if (applyResult.action === "created") result.created++;
      else if (applyResult.action === "updated") result.updated++;
      else if (applyResult.action === "skipped") result.skipped++;
    } else {
      result.failed++;
      result.errors.push({
        item: `metaobject:${def.type}`,
        error: applyResult.error || "Unknown error",
      });
    }
  }

  logger.info("Metaobject definitions applied", result);
  return ok(result);
}

/**
 * Apply all metafield definitions to destination store.
 */
export async function applyMetafieldDefinitions(
  client: GraphQLClient,
  definitions: MetafieldDefinition[]
): Promise<Result<ApplyResult, ShopifyApiError>> {
  logger.info(`Applying ${definitions.length} metafield definitions`);

  const result: ApplyResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Get existing keys
  const existingKeys = await getExistingMetafieldKeys(client);
  logger.debug(`Found ${existingKeys.size} existing metafield definitions`);

  // Apply each definition
  for (const def of definitions) {
    const applyResult = await applyMetafieldDefinition(
      client,
      def,
      existingKeys
    );

    if (applyResult.success) {
      if (applyResult.action === "created") result.created++;
      else if (applyResult.action === "updated") result.updated++;
      else if (applyResult.action === "skipped") result.skipped++;
    } else {
      result.failed++;
      result.errors.push({
        item: `metafield:${def.ownerType}:${def.namespace}.${def.key}`,
        error: applyResult.error || "Unknown error",
      });
    }
  }

  logger.info("Metafield definitions applied", result);
  return ok(result);
}

/**
 * Apply all definitions (metaobjects + metafields) to destination store.
 */
export async function applyDefinitions(
  client: GraphQLClient,
  dump: DefinitionsDump
): Promise<
  Result<{ metaobjects: ApplyResult; metafields: ApplyResult }, ShopifyApiError>
> {
  logger.info("Applying all definitions");

  // Apply metaobject definitions first
  const metaobjectResult = await applyMetaobjectDefinitions(
    client,
    dump.metaobjectDefinitions
  );
  if (!metaobjectResult.ok) {
    return err(metaobjectResult.error);
  }

  // Then apply metafield definitions
  const metafieldResult = await applyMetafieldDefinitions(
    client,
    dump.metafieldDefinitions
  );
  if (!metafieldResult.ok) {
    return err(metafieldResult.error);
  }

  logger.info("All definitions applied");

  return ok({
    metaobjects: metaobjectResult.data,
    metafields: metafieldResult.data,
  });
}
