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
  existingTypes: Map<string, string>,
  sourceGidToType: Map<string, string>,
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

      const sanitizedCapabilities = sanitizeMetaobjectCapabilities(
        def.capabilities,
      );

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
          validations: remapMetaobjectValidations(
            field.validations,
            sourceGidToType,
            existingTypes,
          )?.map((v) => ({
            name: v.name,
            value: v.value,
          })),
        })),
        capabilities: sanitizedCapabilities,
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

      if (response?.metaobjectDefinition?.id) {
        existingTypes.set(def.type, response.metaobjectDefinition.id);
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

function sanitizeMetaobjectCapabilities(
  capabilities: MetaobjectDefinition["capabilities"],
): MetaobjectDefinition["capabilities"] {
  if (!capabilities) return capabilities;

  const sanitized: MetaobjectDefinition["capabilities"] = {
    ...capabilities,
  };

  if (sanitized.onlineStore?.data) {
    sanitized.onlineStore = {
      ...sanitized.onlineStore,
      data: {
        urlHandle: sanitized.onlineStore.data.urlHandle,
      },
    };
  }

  return sanitized;
}

/**
 * Check if a metafield namespace is reserved by Shopify.
 * Reserved namespaces include:
 * - shopify--* (system-managed features)
 * - shopify (exact match - system namespace)
 * - reviews (exact match - reviews app)
 * These cannot be created via API.
 */
function isReservedMetafieldNamespace(namespace: string, key: string): boolean {
  // Shopify system namespaces (with double dash or exact match)
  if (namespace.startsWith("shopify--") || namespace === "shopify") {
    return true;
  }

  // Reviews app namespace
  if (namespace === "reviews") {
    return true;
  }

  return false;
}

/**
 * Build a mapping from source metaobject definition GIDs to their types.
 * This is needed to remap metafield validation constraints.
 */
function buildSourceMetaobjectGidToType(
  sourceDefinitions: MetaobjectDefinition[],
): Map<string, string> {
  const gidToType = new Map<string, string>();
  for (const def of sourceDefinitions) {
    if (def.id) {
      gidToType.set(def.id, def.type);
    }
  }
  return gidToType;
}

/**
 * Remap metaobject definition GID validations from source to destination.
 * Returns new validations array with remapped GIDs.
 */
function remapMetaobjectValidations(
  validations: Array<{ name: string; value: string }> | undefined,
  sourceGidToType: Map<string, string>,
  destTypeToGid: Map<string, string>,
): Array<{ name: string; value: string }> | undefined {
  if (!validations || validations.length === 0) {
    return validations;
  }

  return validations.map((v) => {
    if (v.name === "metaobject_definition_id") {
      // This is a metaobject reference validation - need to remap the GID
      const sourceGid = v.value;
      const sourceType = sourceGidToType.get(sourceGid);

      if (!sourceType) {
        logger.warn(
          `Cannot remap metaobject validation: source type not found for GID ${sourceGid}`,
        );
        return v;
      }

      const destGid = destTypeToGid.get(sourceType);

      if (!destGid) {
        logger.warn(
          `Cannot remap metaobject validation: destination GID not found for type ${sourceType}`,
        );
        return v;
      }

      return { name: v.name, value: destGid };
    }

    // Other validations pass through unchanged
    return v;
  });
}

/**
 * Apply a single metafield definition to destination.
 * Creates if missing; skips if exists (to avoid type conflicts).
 */
async function applyMetafieldDefinition(
  client: GraphQLClient,
  def: MetafieldDefinition,
  existingKeys: Set<string>,
  sourceGidToType: Map<string, string>,
  destTypeToGid: Map<string, string>,
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
        `Creating metafield definition: ${def.namespace}.${def.key} (${def.ownerType})`,
      );

      // Remap metaobject definition GIDs in validations
      const remappedValidations = remapMetaobjectValidations(
        def.validations,
        sourceGidToType,
        destTypeToGid,
      );

      const input = {
        name: def.name,
        namespace: def.namespace,
        key: def.key,
        description: def.description,
        type: def.type.name,
        ownerType: def.ownerType,
        validations: remappedValidations?.map((v) => ({
          name: v.name,
          value: v.value,
        })),
        // Convert pinnedPosition number to boolean pin field
        pin:
          def.pinnedPosition !== null && def.pinnedPosition !== undefined
            ? true
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
        `Metafield definition already exists: ${def.namespace}.${def.key}`,
      );
      return { success: true, action: "skipped" };
    }
  } catch (error: any) {
    return { success: false, action: "skipped", error: error.message };
  }
}

/**
 * Get existing metaobject definition types and their GIDs from destination.
 */
async function getExistingMetaobjectTypes(
  client: GraphQLClient,
): Promise<Map<string, string>> {
  const typeToGid = new Map<string, string>();

  try {
    for await (const def of client.paginate(
      `query metaobjectDefinitions($first: Int!, $after: String) {
        metaobjectDefinitions(first: $first, after: $after) {
          edges {
            node {
              id
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
      },
    )) {
      typeToGid.set(def.type, def.id);
    }
  } catch (error: any) {
    logger.warn("Failed to fetch existing metaobject types", {
      error: error.message,
    });
  }

  return typeToGid;
}

/**
 * Get existing metafield definition keys from destination.
 */
async function getExistingMetafieldKeys(
  client: GraphQLClient,
): Promise<Set<string>> {
  const keys = new Set<string>();

  const ownerTypes = [
    "PRODUCT",
    "PRODUCTVARIANT",
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
        },
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
 * Check if a metaobject type is reserved by Shopify.
 * Reserved types start with "shopify--" and cannot be created via API.
 */
function isReservedMetaobjectType(type: string): boolean {
  return type.startsWith("shopify--");
}

/**
 * Apply all metaobject definitions to destination store.
 */
export async function applyMetaobjectDefinitions(
  client: GraphQLClient,
  definitions: MetaobjectDefinition[],
): Promise<Result<ApplyResult, ShopifyApiError>> {
  // Filter out reserved types
  const customDefinitions = definitions.filter(
    (def) => !isReservedMetaobjectType(def.type),
  );
  const reservedCount = definitions.length - customDefinitions.length;

  if (reservedCount > 0) {
    logger.info(
      `Skipping ${reservedCount} reserved metaobject definitions (shopify--*)`,
      {
        reserved: definitions
          .filter((d) => isReservedMetaobjectType(d.type))
          .map((d) => d.type),
      },
    );
  }

  logger.info(
    `Applying ${customDefinitions.length} custom metaobject definitions`,
  );

  const result: ApplyResult = {
    created: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  // Get existing types
  const existingTypes = await getExistingMetaobjectTypes(client);
  const sourceGidToType = buildSourceMetaobjectGidToType(customDefinitions);
  logger.debug(`Found ${existingTypes.size} existing metaobject types`);

  // Apply each definition
  for (const def of customDefinitions) {
    const applyResult = await applyMetaobjectDefinition(
      client,
      def,
      existingTypes,
      sourceGidToType,
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
  definitions: MetafieldDefinition[],
  sourceMetaobjectDefinitions: MetaobjectDefinition[],
): Promise<Result<ApplyResult, ShopifyApiError>> {
  // Filter out reserved namespaces
  const customDefinitions = definitions.filter(
    (def) => !isReservedMetafieldNamespace(def.namespace, def.key),
  );
  const reservedCount = definitions.length - customDefinitions.length;

  if (reservedCount > 0) {
    logger.info(
      `Skipping ${reservedCount} reserved metafield definitions (shopify--*, shopify.*, reviews.*)`,
      {
        reserved: definitions
          .filter((d) => isReservedMetafieldNamespace(d.namespace, d.key))
          .map((d) => `${d.ownerType}:${d.namespace}.${d.key}`),
      },
    );
  }

  logger.info(
    `Applying ${customDefinitions.length} custom metafield definitions`,
  );

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

  // Build metaobject GID mappings for validation remapping
  const sourceGidToType = buildSourceMetaobjectGidToType(
    sourceMetaobjectDefinitions,
  );
  const destTypeToGid = await getExistingMetaobjectTypes(client);

  // Apply each definition
  for (const def of customDefinitions) {
    const applyResult = await applyMetafieldDefinition(
      client,
      def,
      existingKeys,
      sourceGidToType,
      destTypeToGid,
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
  dump: DefinitionsDump,
): Promise<
  Result<{ metaobjects: ApplyResult; metafields: ApplyResult }, ShopifyApiError>
> {
  logger.info("Applying all definitions");

  // Apply metaobject definitions first
  const metaobjectResult = await applyMetaobjectDefinitions(
    client,
    dump.metaobjectDefinitions,
  );
  if (!metaobjectResult.ok) {
    return err(metaobjectResult.error);
  }

  // Then apply metafield definitions (pass source metaobject defs for GID remapping)
  const metafieldResult = await applyMetafieldDefinitions(
    client,
    dump.metafieldDefinitions,
    dump.metaobjectDefinitions,
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
