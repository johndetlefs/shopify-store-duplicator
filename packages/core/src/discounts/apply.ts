/**
 * Discounts Apply
 *
 * Imports discounts into the destination store.
 *
 * Purpose:
 * - Read discounts from JSON dump
 * - Remap product/collection/variant references to destination GIDs
 * - Create/update discounts in destination using appropriate mutations
 * - Skip discounts that already exist with matching configuration (idempotent)
 * - Track success/failure stats
 *
 * Idempotency (Upsert Pattern):
 * - Queries existing discounts first (title → {id, type})
 * - If title doesn't exist → CREATE discount (with appropriate type-specific mutation)
 * - If title exists with same type → UPDATE discount (preserving configuration)
 * - If title exists but type differs → SKIP with warning (cannot change discount type)
 * - Safe to re-run, handles configuration changes
 *
 * Natural Key Remapping:
 * - Product handles → destination product GIDs
 * - Collection handles → destination collection GIDs
 * - Variant refs (productHandle + SKU) → destination variant GIDs
 * - Customer segments → preserved by ID (cross-store segment mapping not supported)
 *
 * Note: Due to different mutation types for each discount variant,
 * we process them individually with throttling to avoid rate limits.
 */

import * as fs from "node:fs";
import { GraphQLClient } from "../graphql/client.js";
import {
  DISCOUNT_CODE_BASIC_CREATE,
  DISCOUNT_CODE_BASIC_UPDATE,
  DISCOUNT_CODE_BXGY_CREATE,
  DISCOUNT_CODE_BXGY_UPDATE,
  DISCOUNT_CODE_FREE_SHIPPING_CREATE,
  DISCOUNT_CODE_FREE_SHIPPING_UPDATE,
  DISCOUNT_AUTOMATIC_BASIC_CREATE,
  DISCOUNT_AUTOMATIC_BASIC_UPDATE,
  DISCOUNT_AUTOMATIC_BXGY_CREATE,
  DISCOUNT_AUTOMATIC_BXGY_UPDATE,
  DISCOUNT_AUTOMATIC_FREE_SHIPPING_CREATE,
  DISCOUNT_AUTOMATIC_FREE_SHIPPING_UPDATE,
  DISCOUNTS_CODE_BULK,
  DISCOUNTS_AUTOMATIC_BULK,
} from "../graphql/queries.js";
import { runBulkQueryAndDownload } from "../bulk/runner.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";
import type {
  DiscountsDump,
  DumpedDiscount,
  DiscountType,
  DiscountItems,
  DiscountValue,
} from "./dump.js";

export interface DiscountsApplyStats {
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: Array<{ title: string; error: string }>;
}

interface ExistingDiscount {
  id: string;
  type: DiscountType;
}

interface DestinationIndex {
  products: Map<string, string>; // handle → GID
  collections: Map<string, string>; // handle → GID
  variants: Map<string, string>; // productHandle:sku → GID
}

/**
 * Apply discounts from a dump file to the destination store
 */
export async function applyDiscounts(
  client: GraphQLClient,
  inputFile: string,
  destinationIndex: DestinationIndex
): Promise<Result<DiscountsApplyStats>> {
  logger.info("Starting discounts apply...");

  try {
    // Read dump file
    if (!fs.existsSync(inputFile)) {
      return err(new Error(`Input file not found: ${inputFile}`));
    }

    const content = fs.readFileSync(inputFile, "utf-8");
    const dump: DiscountsDump = JSON.parse(content);

    if (!dump.codeDiscounts || !dump.automaticDiscounts) {
      return err(
        new Error(
          "Invalid dump format: missing 'codeDiscounts' or 'automaticDiscounts' arrays"
        )
      );
    }

    logger.info(
      `Loaded ${dump.codeDiscounts.length} code discounts and ${dump.automaticDiscounts.length} automatic discounts from dump`
    );

    // Fetch existing discounts to avoid duplicates
    logger.info("Fetching existing discounts...");
    const existingResult = await fetchExistingDiscounts(client);
    if (!existingResult.ok) {
      return err(existingResult.error);
    }

    const existingDiscounts = existingResult.data;
    logger.info(`Found ${existingDiscounts.size} existing discounts`);

    // Apply discounts
    const stats: DiscountsApplyStats = {
      created: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };

    // Process code discounts
    for (const discount of dump.codeDiscounts) {
      const result = await applyDiscount(
        client,
        discount,
        existingDiscounts,
        destinationIndex
      );

      if (result.ok) {
        if (result.data.action === "created") {
          stats.created++;
          logger.info(`✅ Created code discount: ${discount.title}`);
        } else if (result.data.action === "updated") {
          stats.updated++;
          logger.info(`🔄 Updated code discount: ${discount.title}`);
        } else {
          stats.skipped++;
          logger.debug(`⏭️  Skipped code discount: ${discount.title}`);
        }
      } else {
        stats.failed++;
        stats.errors.push({
          title: discount.title,
          error: result.error.message,
        });
        logger.warn(`❌ Failed to apply code discount: ${discount.title}`, {
          error: result.error.message,
        });
      }

      // Throttle to avoid rate limits (2 requests per second)
      await sleep(500);
    }

    // Process automatic discounts
    for (const discount of dump.automaticDiscounts) {
      const result = await applyDiscount(
        client,
        discount,
        existingDiscounts,
        destinationIndex
      );

      if (result.ok) {
        if (result.data.action === "created") {
          stats.created++;
          logger.info(`✅ Created automatic discount: ${discount.title}`);
        } else if (result.data.action === "updated") {
          stats.updated++;
          logger.info(`🔄 Updated automatic discount: ${discount.title}`);
        } else {
          stats.skipped++;
          logger.debug(`⏭️  Skipped automatic discount: ${discount.title}`);
        }
      } else {
        stats.failed++;
        stats.errors.push({
          title: discount.title,
          error: result.error.message,
        });
        logger.warn(
          `❌ Failed to apply automatic discount: ${discount.title}`,
          { error: result.error.message }
        );
      }

      // Throttle to avoid rate limits
      await sleep(500);
    }

    logger.info("Discounts apply complete", {
      created: stats.created,
      updated: stats.updated,
      skipped: stats.skipped,
      failed: stats.failed,
    });

    return ok(stats);
  } catch (error) {
    logger.error("Error applying discounts", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Fetch all existing discounts from the destination store
 */
async function fetchExistingDiscounts(
  client: GraphQLClient
): Promise<Result<Map<string, ExistingDiscount>>> {
  try {
    // Fetch code discounts
    const codeBulkResult = await runBulkQueryAndDownload(
      client,
      DISCOUNTS_CODE_BULK
    );
    if (!codeBulkResult.ok) {
      return err(codeBulkResult.error);
    }
    // Fetch automatic discounts
    const autoBulkResult = await runBulkQueryAndDownload(
      client,
      DISCOUNTS_AUTOMATIC_BULK
    );
    if (!autoBulkResult.ok) {
      return err(autoBulkResult.error);
    }
    const discounts = new Map<string, ExistingDiscount>();
    for await (const line of codeBulkResult.data) {
      if (line.codeDiscount?.title) {
        discounts.set(line.codeDiscount.title, {
          id: line.id,
          type: line.codeDiscount.__typename,
        });
      }
    }
    for await (const line of autoBulkResult.data) {
      if (line.automaticDiscount?.title) {
        discounts.set(line.automaticDiscount.title, {
          id: line.id,
          type: line.automaticDiscount.__typename,
        });
      }
    }
    return ok(discounts);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Apply a single discount (create or update)
 */
async function applyDiscount(
  client: GraphQLClient,
  discount: DumpedDiscount,
  existingDiscounts: Map<string, ExistingDiscount>,
  destinationIndex: DestinationIndex
): Promise<Result<{ action: "created" | "updated" | "skipped" }>> {
  const existing = existingDiscounts.get(discount.title);

  // If discount doesn't exist, create it
  if (!existing) {
    const createResult = await createDiscount(
      client,
      discount,
      destinationIndex
    );
    if (createResult.ok) {
      return ok({ action: "created" });
    }
    return err(createResult.error);
  }

  // If type has changed, skip (cannot change discount type)
  if (existing.type !== discount.type) {
    logger.warn(
      `Discount type mismatch for "${discount.title}": existing=${existing.type}, new=${discount.type}. Skipping.`
    );
    return ok({ action: "skipped" });
  }

  // Otherwise, update it
  const updateResult = await updateDiscount(
    client,
    existing.id,
    discount,
    destinationIndex
  );
  if (updateResult.ok) {
    return ok({ action: "updated" });
  }
  return err(updateResult.error);
}

/**
 * Create a new discount with the appropriate mutation based on type
 */
async function createDiscount(
  client: GraphQLClient,
  discount: DumpedDiscount,
  destinationIndex: DestinationIndex
): Promise<Result<void>> {
  try {
    let mutation: string;
    let variables: any;

    switch (discount.type) {
      case "DiscountCodeBasic":
        mutation = DISCOUNT_CODE_BASIC_CREATE;
        variables = {
          basicCodeDiscount: buildCodeBasicInput(discount, destinationIndex),
        };
        break;

      case "DiscountCodeBxgy":
        mutation = DISCOUNT_CODE_BXGY_CREATE;
        variables = {
          bxgyCodeDiscount: buildCodeBxgyInput(discount, destinationIndex),
        };
        break;

      case "DiscountCodeFreeShipping":
        mutation = DISCOUNT_CODE_FREE_SHIPPING_CREATE;
        variables = {
          freeShippingCodeDiscount: buildCodeFreeShippingInput(
            discount,
            destinationIndex
          ),
        };
        break;

      case "DiscountAutomaticBasic":
        mutation = DISCOUNT_AUTOMATIC_BASIC_CREATE;
        variables = {
          automaticBasicDiscount: buildAutomaticBasicInput(
            discount,
            destinationIndex
          ),
        };
        break;

      case "DiscountAutomaticBxgy":
        mutation = DISCOUNT_AUTOMATIC_BXGY_CREATE;
        variables = {
          automaticBxgyDiscount: buildAutomaticBxgyInput(
            discount,
            destinationIndex
          ),
        };
        break;

      case "DiscountAutomaticFreeShipping":
        mutation = DISCOUNT_AUTOMATIC_FREE_SHIPPING_CREATE;
        variables = {
          automaticFreeShippingDiscount: buildAutomaticFreeShippingInput(
            discount,
            destinationIndex
          ),
        };
        break;

      default:
        return err(
          new Error(
            `Unsupported discount type: ${(discount as any).type || "unknown"}`
          )
        );
    }

    const result = await client.request({ query: mutation, variables });

    if (!result.ok) {
      return err(result.error);
    }

    // Check for user errors in response
    const responseKey = Object.keys(result.data.data || {})[0];
    const response = result.data.data?.[responseKey];

    if (response?.userErrors && response.userErrors.length > 0) {
      const errorMsg = response.userErrors
        .map((e: any) => e.message)
        .join(", ");
      return err(new Error(errorMsg));
    }

    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Update an existing discount with the appropriate mutation based on type
 */
async function updateDiscount(
  client: GraphQLClient,
  id: string,
  discount: DumpedDiscount,
  destinationIndex: DestinationIndex
): Promise<Result<void>> {
  try {
    let mutation: string;
    let variables: any;

    switch (discount.type) {
      case "DiscountCodeBasic":
        mutation = DISCOUNT_CODE_BASIC_UPDATE;
        variables = {
          id,
          basicCodeDiscount: buildCodeBasicInput(discount, destinationIndex),
        };
        break;

      case "DiscountCodeBxgy":
        mutation = DISCOUNT_CODE_BXGY_UPDATE;
        variables = {
          id,
          bxgyCodeDiscount: buildCodeBxgyInput(discount, destinationIndex),
        };
        break;

      case "DiscountCodeFreeShipping":
        mutation = DISCOUNT_CODE_FREE_SHIPPING_UPDATE;
        variables = {
          id,
          freeShippingCodeDiscount: buildCodeFreeShippingInput(
            discount,
            destinationIndex
          ),
        };
        // eslint-disable-next-line no-console
        console.log("\n=== UPDATING DISCOUNT CODE FREE SHIPPING ===");
        // eslint-disable-next-line no-console
        console.log("Variables:", JSON.stringify(variables, null, 2));
        // eslint-disable-next-line no-console
        console.log("==========================================\n");
        break;

      case "DiscountAutomaticBasic":
        mutation = DISCOUNT_AUTOMATIC_BASIC_UPDATE;
        variables = {
          id,
          automaticBasicDiscount: buildAutomaticBasicInput(
            discount,
            destinationIndex
          ),
        };
        break;

      case "DiscountAutomaticBxgy":
        mutation = DISCOUNT_AUTOMATIC_BXGY_UPDATE;
        variables = {
          id,
          automaticBxgyDiscount: buildAutomaticBxgyInput(
            discount,
            destinationIndex
          ),
        };
        break;

      case "DiscountAutomaticFreeShipping":
        mutation = DISCOUNT_AUTOMATIC_FREE_SHIPPING_UPDATE;
        variables = {
          id,
          automaticFreeShippingDiscount: buildAutomaticFreeShippingInput(
            discount,
            destinationIndex
          ),
        };
        break;

      default:
        return err(
          new Error(
            `Unsupported discount type: ${(discount as any).type || "unknown"}`
          )
        );
    }

    const result = await client.request({ query: mutation, variables });

    if (!result.ok) {
      return err(result.error);
    }

    // Check for user errors in response
    const responseKey = Object.keys(result.data.data || {})[0];
    const response = result.data.data?.[responseKey];

    if (response?.userErrors && response.userErrors.length > 0) {
      const errorMsg = response.userErrors
        .map((e: any) => e.message)
        .join(", ");
      return err(new Error(errorMsg));
    }

    return ok(undefined);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Build input for DiscountCodeBasic
 */
function buildCodeBasicInput(
  discount: DumpedDiscount,
  index: DestinationIndex
): any {
  if (discount.type !== "DiscountCodeBasic") return {};

  return {
    title: discount.title,
    codes: discount.codes,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    customerGets: {
      value: buildDiscountValueInput(discount.customerGets.value),
      items: buildDiscountItemsInput(discount.customerGets.items, index),
      ...(discount.customerGets.appliesOnSubscription === true
        ? {
            appliesOnOneTimePurchase:
              discount.customerGets.appliesOnOneTimePurchase,
            appliesOnSubscription: discount.customerGets.appliesOnSubscription,
          }
        : {}),
    },
    customerSelection: buildCustomerSelectionInput(discount.customerSelection),
    minimumRequirement: buildMinimumRequirementInput(
      discount.minimumRequirement
    ),
    usageLimit: discount.usageLimit,
    appliesOncePerCustomer: discount.appliesOncePerCustomer,
    ...(discount.customerGets.appliesOnSubscription === true &&
    discount.recurringCycleLimit
      ? { recurringCycleLimit: discount.recurringCycleLimit }
      : {}),
    combinesWith: discount.combinesWith,
  };
}

/**
 * Build input for DiscountCodeBxgy
 */
function buildCodeBxgyInput(
  discount: DumpedDiscount,
  index: DestinationIndex
): any {
  if (discount.type !== "DiscountCodeBxgy") return {};

  return {
    title: discount.title,
    codes: discount.codes,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    customerBuys: {
      items: buildDiscountItemsInput(discount.customerBuys.items, index),
      value: buildBxgyValueInput(discount.customerBuys.value),
    },
    customerGets: {
      value: buildDiscountValueInput(discount.customerGets.value),
      items: buildDiscountItemsInput(discount.customerGets.items, index),
      ...(discount.customerGets.appliesOnSubscription === true
        ? {
            appliesOnOneTimePurchase:
              discount.customerGets.appliesOnOneTimePurchase,
            appliesOnSubscription: discount.customerGets.appliesOnSubscription,
          }
        : {}),
    },
    customerSelection: buildCustomerSelectionInput(discount.customerSelection),
    usageLimit: discount.usageLimit,
    appliesOncePerCustomer: discount.appliesOncePerCustomer,
    ...(discount.customerGets.appliesOnSubscription === true &&
    discount.recurringCycleLimit
      ? { recurringCycleLimit: discount.recurringCycleLimit }
      : {}),
    usesPerOrderLimit: discount.usesPerOrderLimit,
    combinesWith: discount.combinesWith,
  };
}

/**
 * Build input for DiscountCodeFreeShipping
 */
function buildCodeFreeShippingInput(
  discount: DumpedDiscount,
  index: DestinationIndex
): any {
  if (discount.type !== "DiscountCodeFreeShipping") return {};

  const builtMin = buildMinimumRequirementInput(discount.minimumRequirement);
  // If dump didn't include a structured minimumRequirement, try parsing from the human summary
  let minimumRequirementInput = builtMin;
  if (!minimumRequirementInput && (discount as any).summary) {
    const parsed = parseMinimumFromSummary((discount as any).summary);
    if (parsed && parsed.type === "subtotal") {
      const amt = Number(parsed.amount);
      minimumRequirementInput = {
        subtotal: { greaterThanOrEqualToSubtotal: amt },
      };
    }
  }

  return {
    title: discount.title,
    code: discount.codes?.[0],
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    customerSelection: buildCustomerSelectionInput(discount.customerSelection),
    minimumRequirement: minimumRequirementInput,
    destination: buildShippingDestinationInput(discount.destination),
    maximumShippingPrice: discount.maximumShippingPrice
      ? { amount: discount.maximumShippingPrice }
      : undefined,
    // Only include subscription fields if subscriptions are explicitly being used
    ...(discount.appliesOnSubscription === true
      ? {
          appliesOnOneTimePurchase: discount.appliesOnOneTimePurchase,
          appliesOnSubscription: discount.appliesOnSubscription,
          recurringCycleLimit: discount.recurringCycleLimit,
        }
      : {}),
    usageLimit: discount.usageLimit,
    appliesOncePerCustomer: discount.appliesOncePerCustomer,
    combinesWith: discount.combinesWith,
  };
}

/**
 * Build input for DiscountAutomaticBasic
 */
function buildAutomaticBasicInput(
  discount: DumpedDiscount,
  index: DestinationIndex
): any {
  if (discount.type !== "DiscountAutomaticBasic") return {};

  return {
    title: discount.title,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    customerGets: {
      value: buildDiscountValueInput(discount.customerGets.value),
      items: buildDiscountItemsInput(discount.customerGets.items, index),
      ...(discount.customerGets.appliesOnSubscription === true
        ? {
            appliesOnOneTimePurchase:
              discount.customerGets.appliesOnOneTimePurchase,
            appliesOnSubscription: discount.customerGets.appliesOnSubscription,
          }
        : {}),
    },
    minimumRequirement: buildMinimumRequirementInput(
      discount.minimumRequirement
    ),
    ...(discount.customerGets.appliesOnSubscription === true &&
    discount.recurringCycleLimit
      ? { recurringCycleLimit: discount.recurringCycleLimit }
      : {}),
    combinesWith: discount.combinesWith,
  };
}

/**
 * Build input for DiscountAutomaticBxgy
 */
function buildAutomaticBxgyInput(
  discount: DumpedDiscount,
  index: DestinationIndex
): any {
  if (discount.type !== "DiscountAutomaticBxgy") return {};

  return {
    title: discount.title,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    customerBuys: {
      items: buildDiscountItemsInput(discount.customerBuys.items, index),
      value: buildBxgyValueInput(discount.customerBuys.value),
    },
    customerGets: {
      value: buildDiscountValueInput(discount.customerGets.value),
      items: buildDiscountItemsInput(discount.customerGets.items, index),
      ...(discount.customerGets.appliesOnSubscription === true
        ? {
            appliesOnOneTimePurchase:
              discount.customerGets.appliesOnOneTimePurchase,
            appliesOnSubscription: discount.customerGets.appliesOnSubscription,
          }
        : {}),
    },
    ...(discount.customerGets.appliesOnSubscription === true &&
    discount.recurringCycleLimit
      ? { recurringCycleLimit: discount.recurringCycleLimit }
      : {}),
    usesPerOrderLimit: discount.usesPerOrderLimit,
    combinesWith: discount.combinesWith,
  };
}

/**
 * Build input for DiscountAutomaticFreeShipping
 */
function buildAutomaticFreeShippingInput(
  discount: DumpedDiscount,
  index: DestinationIndex
): any {
  if (discount.type !== "DiscountAutomaticFreeShipping") return {};

  return {
    title: discount.title,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    minimumRequirement: buildMinimumRequirementInput(
      discount.minimumRequirement
    ),
    destination: buildShippingDestinationInput(discount.destination),
    maximumShippingPrice: discount.maximumShippingPrice
      ? { amount: discount.maximumShippingPrice }
      : undefined,
    ...(discount.appliesOnSubscription === true
      ? {
          appliesOnOneTimePurchase: discount.appliesOnOneTimePurchase,
          appliesOnSubscription: discount.appliesOnSubscription,
          recurringCycleLimit: discount.recurringCycleLimit,
        }
      : {}),
    combinesWith: discount.combinesWith,
  };
}

/**
 * Build discount value input (percentage or fixed amount)
 */
function buildDiscountValueInput(value: DiscountValue): any {
  if (value.type === "percentage") {
    return { percentage: value.percentage / 100 }; // Shopify expects decimal (e.g., 0.15 for 15%)
  } else if (value.type === "fixedAmount") {
    return {
      discountAmount: {
        amount: value.amount,
        appliesOnEachItem: value.appliesOnEachItem,
      },
    };
  } else if (value.type === "onQuantity") {
    return {
      discountOnQuantity: {
        quantity: value.quantity,
        effect: buildDiscountValueInput(value.effect as DiscountValue),
      },
    };
  }
  return {};
}

/**
 * Build discount items input (all, products, or collections)
 */
function buildDiscountItemsInput(
  items: DiscountItems,
  index: DestinationIndex
): any {
  if (items.type === "all") {
    return { all: true };
  } else if (items.type === "products") {
    const productIds = items.productHandles
      .map((h) => index.products.get(h))
      .filter(Boolean);
    const variantIds = items.variantRefs
      .map((ref) => {
        const key = ref.sku
          ? `${ref.productHandle}:${ref.sku}`
          : `${ref.productHandle}:pos0`;
        return index.variants.get(key);
      })
      .filter(Boolean);

    return {
      products: {
        productIds,
        productVariantIds: variantIds,
      },
    };
  } else if (items.type === "collections") {
    const collectionIds = items.collectionHandles
      .map((h) => index.collections.get(h))
      .filter(Boolean);
    return {
      collections: {
        collectionIds,
      },
    };
  }
  return { all: true };
}

/**
 * Build customer selection input
 */
function buildCustomerSelectionInput(selection: any): any {
  if (!selection) return { all: true };

  if (selection.type === "all") {
    return { all: true };
  } else if (selection.type === "segments") {
    // Note: Customer segment IDs are preserved but may not exist in destination
    // This is a limitation - ideally we'd map segments by name
    logger.warn(
      "Customer segments are preserved by ID but may not exist in destination store"
    );
    return {
      customerSegments: {
        segmentIds: selection.segmentIds,
      },
    };
  }

  return { all: true };
}

/**
 * Build minimum requirement input
 */
function buildMinimumRequirementInput(requirement: any): any {
  if (!requirement || requirement.type === "none") {
    return undefined;
  }

  if (requirement.type === "quantity") {
    return {
      quantity: { greaterThanOrEqualToQuantity: requirement.quantity },
    };
  } else if (requirement.type === "subtotal") {
    // API examples accept a scalar number for subtotal; use numeric if possible
    const amt =
      requirement.amount !== undefined ? Number(requirement.amount) : undefined;
    return {
      subtotal: { greaterThanOrEqualToSubtotal: amt },
    };
  } else if (requirement.type === "items") {
    return {
      items: { greaterThanOrEqualToItems: requirement.quantity },
    };
  }

  return undefined;
}

/**
 * Build BXGY value input (quantity or purchase amount)
 */
function buildBxgyValueInput(value: any): any {
  if (value.type === "quantity") {
    return { quantity: value.quantity.toString() };
  } else if (value.type === "purchaseAmount") {
    return { amount: value.amount };
  }
  return { quantity: "1" };
}

/**
 * Build shipping destination input
 */
function buildShippingDestinationInput(destination: any): any {
  if (!destination || destination.type === "all") {
    return { all: true };
  }

  if (destination.type === "countries") {
    return {
      countries: {
        codes: destination.countries,
        includeRestOfWorld: destination.includeRestOfWorld,
      },
    };
  }

  return { all: true };
}

/**
 * Parse a minimum subtotal from a human-readable summary string as a fallback
 * Example summary: "Free shipping on all products • Minimum purchase of $1,000.00 • For all countries"
 */
function parseMinimumFromSummary(
  summary: any
): { type: string; amount?: string } | undefined {
  if (!summary || typeof summary !== "string") return undefined;
  const re = /Minimum purchase of \$?([\d,]+(?:\.\d+)?)/i;
  const m = summary.match(re);
  if (!m) return undefined;
  const num = m[1].replace(/,/g, "");
  return { type: "subtotal", amount: num };
}

/**
 * Sleep for the given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
