/**
 * Discounts Dump
 *
 * Exports all discounts (both automatic and code-based) from the source store to a JSON file.
 *
 * Purpose:
 * - Query all discounts using bulk operations
 * - Export complete discount configurations including:
 *   - Title, status, dates, usage limits
 *   - Customer eligibility, minimum requirements
 *   - Discount values (percenta  } else if (type === "DiscountCodeBxgy") {
    return {
      ...baseFields,
      type: "DiscountCodeBxgy",
      customerBuys: {
        items: transformDiscountItems(discount.customerBuys.items),
        value: transformBxgyValue(discount.customerBuys.value),
      },
      customerGets: {
        value: transformDiscountValue(discount.customerGets.value),
        items: transformDiscountItems(discount.customerGets.items),
        appliesOnOneTimePurchase:
          discount.customerGets.appliesOnOneTimePurchase,
        appliesOnSubscription: discount.customerGets.appliesOnSubscription,
      },
      customerSelection: transformCustomerSelection(discount.customerSelection),
      usesPerOrderLimit: discount.usesPerOrderLimit,
    } as DumpedDiscount; *   - Applicable products/collections/variants
 *   - Discount codes (for code discounts)
 *   - Combination settings
 * - Preserve natural keys (handles) for products/collections/variants
 *
 * Output Format:
 * ```json
 * {
 *   "codeDiscounts": [...],
 *   "automaticDiscounts": [...]
 * }
 * ```
 *
 * Idempotency: Safe to re-run; always exports current state.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { GraphQLClient } from "../graphql/client.js";
import {
  DISCOUNTS_CODE_BASIC_BULK,
  DISCOUNTS_CODE_BXGY_BULK,
  DISCOUNTS_CODE_FREE_SHIPPING_BULK,
  DISCOUNTS_AUTOMATIC_BASIC_BULK,
  DISCOUNTS_AUTOMATIC_BXGY_BULK,
  DISCOUNTS_AUTOMATIC_FREE_SHIPPING_BULK,
  DISCOUNT_CODE_BASIC_CREATE,
  DISCOUNT_CODE_BXGY_CREATE,
  DISCOUNT_CODE_FREE_SHIPPING_CREATE,
  DISCOUNT_AUTOMATIC_BASIC_CREATE,
  DISCOUNT_AUTOMATIC_BXGY_CREATE,
  DISCOUNT_AUTOMATIC_FREE_SHIPPING_CREATE,
} from "../graphql/queries.js";
import { runBulkQueryAndDownload } from "../bulk/runner.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";

/**
 * Discount types supported
 */
export type DiscountType =
  | "DiscountCodeBasic"
  | "DiscountCodeBxgy"
  | "DiscountCodeFreeShipping"
  | "DiscountAutomaticBasic"
  | "DiscountAutomaticBxgy"
  | "DiscountAutomaticFreeShipping";

/**
 * Common discount fields
 */
export interface BaseDiscount {
  type: DiscountType;
  title: string;
  status?: string;
  summary?: string;
  startsAt?: string;
  endsAt?: string;
  recurringCycleLimit?: number;
  combinesWith?: {
    orderDiscounts?: boolean;
    productDiscounts?: boolean;
    shippingDiscounts?: boolean;
  };
}

/**
 * Code discount specific fields
 */
export interface CodeDiscountFields {
  codes: string[];
  usageLimit?: number;
  appliesOncePerCustomer?: boolean;
  asyncUsageCount?: number;
}

/**
 * Value types for discounts
 */
export type DiscountValue =
  | {
      type: "percentage";
      percentage: number;
    }
  | {
      type: "fixedAmount";
      amount: string;
      appliesOnEachItem?: boolean;
    }
  | {
      type: "onQuantity";
      quantity: number;
      effect:
        | { type: "percentage"; percentage: number }
        | { type: "fixedAmount"; amount: string; appliesOnEachItem?: boolean };
    };

/**
 * Items that discounts apply to
 */
export type DiscountItems =
  | {
      type: "all";
    }
  | {
      type: "products";
      productHandles: string[];
      variantRefs: Array<{ productHandle: string; sku?: string }>;
    }
  | {
      type: "collections";
      collectionHandles: string[];
    };

/**
 * Customer eligibility
 */
export type CustomerSelection =
  | {
      type: "all";
    }
  | {
      type: "segments";
      segmentIds: string[];
      segmentNames: string[];
    };

/**
 * Minimum purchase requirements
 */
export type MinimumRequirement =
  | {
      type: "quantity";
      quantity: number;
    }
  | {
      type: "subtotal";
      amount: string;
    }
  | {
      type: "items";
      quantity: number;
    }
  | {
      type: "none";
    };

/**
 * Buy X Get Y value
 */
export type BxgyValue =
  | {
      type: "quantity";
      quantity: number;
    }
  | {
      type: "purchaseAmount";
      amount: string;
    };

/**
 * Shipping destination
 */
export type ShippingDestination =
  | {
      type: "all";
    }
  | {
      type: "countries";
      countries: string[];
      includeRestOfWorld?: boolean;
    };

/**
 * Basic discount (percentage or fixed amount off)
 */
export interface BasicDiscount extends BaseDiscount {
  type: "DiscountCodeBasic" | "DiscountAutomaticBasic";
  customerGets: {
    value: DiscountValue;
    items: DiscountItems;
    appliesOnOneTimePurchase?: boolean;
    appliesOnSubscription?: boolean;
  };
  customerSelection?: CustomerSelection;
  minimumRequirement?: MinimumRequirement;
}

/**
 * BXGY discount (Buy X Get Y)
 */
export interface BxgyDiscount extends BaseDiscount {
  type: "DiscountCodeBxgy" | "DiscountAutomaticBxgy";
  customerBuys: {
    items: DiscountItems;
    value: BxgyValue;
  };
  customerGets: {
    value: DiscountValue;
    items: DiscountItems;
    appliesOnOneTimePurchase?: boolean;
    appliesOnSubscription?: boolean;
  };
  customerSelection?: CustomerSelection;
  usesPerOrderLimit?: number;
}

/**
 * Free shipping discount
 */
export interface FreeShippingDiscount extends BaseDiscount {
  type: "DiscountCodeFreeShipping" | "DiscountAutomaticFreeShipping";
  customerSelection?: CustomerSelection;
  minimumRequirement?: MinimumRequirement;
  destination?: ShippingDestination;
  maximumShippingPrice?: string;
  appliesOnOneTimePurchase?: boolean;
  appliesOnSubscription?: boolean;
}

/**
 * Union type for all discount types
 */
export type DumpedDiscount =
  | (BasicDiscount & Partial<CodeDiscountFields>)
  | (BxgyDiscount & Partial<CodeDiscountFields>)
  | (FreeShippingDiscount & Partial<CodeDiscountFields>);

/**
 * Discounts dump structure
 */
export interface DiscountsDump {
  codeDiscounts: DumpedDiscount[];
  automaticDiscounts: DumpedDiscount[];
}

/**
 * Dump all discounts from the source store
 */
export async function dumpDiscounts(
  client: GraphQLClient,
  outputFile: string
): Promise<Result<void>> {
  logger.info("Starting discounts dump...");

  try {
    // Ensure output directory exists
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const codeDiscounts: DumpedDiscount[] = [];
    const automaticDiscounts: DumpedDiscount[] = [];

    // Run code discounts bulk queries (split by type to stay under 5 connection limit)
    logger.info("Fetching code Basic discounts via bulk operation...");
    const codeBasicResult = await runBulkQueryAndDownload(
      client,
      DISCOUNTS_CODE_BASIC_BULK
    );
    if (!codeBasicResult.ok) {
      return err(codeBasicResult.error);
    }
    for await (const line of codeBasicResult.data) {
      if (line.codeDiscount) {
        logger.debug("Raw Basic discount line", { line: JSON.stringify(line) });
        // Only process if it's actually a Basic discount
        if (line.codeDiscount.__typename === "DiscountCodeBasic") {
          const discount = transformCodeDiscount(line);
          if (discount) {
            logger.debug("Transformed Basic discount", { discount });
            codeDiscounts.push(discount);
          } else {
            logger.warn("Failed to transform Basic discount", { line });
          }
        }
      }
    }

    logger.info("Fetching code BXGY discounts via bulk operation...");
    const codeBxgyResult = await runBulkQueryAndDownload(
      client,
      DISCOUNTS_CODE_BXGY_BULK
    );
    if (!codeBxgyResult.ok) {
      return err(codeBxgyResult.error);
    }
    for await (const line of codeBxgyResult.data) {
      if (line.codeDiscount) {
        logger.debug("Raw BXGY discount line", { line: JSON.stringify(line) });
        // Only process if it's actually a BXGY discount
        if (line.codeDiscount.__typename === "DiscountCodeBxgy") {
          const discount = transformCodeDiscount(line);
          if (discount) {
            logger.debug("Transformed BXGY discount", { discount });
            codeDiscounts.push(discount);
          } else {
            logger.warn("Failed to transform BXGY discount", { line });
          }
        }
      }
    }

    logger.info("Fetching code FreeShipping discounts via bulk operation...");
    const codeFreeShippingResult = await runBulkQueryAndDownload(
      client,
      DISCOUNTS_CODE_FREE_SHIPPING_BULK
    );
    if (!codeFreeShippingResult.ok) {
      return err(codeFreeShippingResult.error);
    }
    for await (const line of codeFreeShippingResult.data) {
      if (line.codeDiscount) {
        logger.debug("Raw FreeShipping discount line", {
          line: JSON.stringify(line),
        });
        // Only process if it's actually a FreeShipping discount
        if (line.codeDiscount.__typename === "DiscountCodeFreeShipping") {
          const discount = transformCodeDiscount(line);
          if (discount) {
            logger.debug("Transformed FreeShipping discount", { discount });
            codeDiscounts.push(discount);
          } else {
            logger.warn("Failed to transform FreeShipping discount", { line });
          }
        }
      }
    }

    // Run automatic discounts bulk queries (split by type to stay under 5 connection limit)
    logger.info("Fetching automatic Basic discounts via bulk operation...");
    const autoBasicResult = await runBulkQueryAndDownload(
      client,
      DISCOUNTS_AUTOMATIC_BASIC_BULK
    );
    if (!autoBasicResult.ok) {
      return err(autoBasicResult.error);
    }
    for await (const line of autoBasicResult.data) {
      if (line.automaticDiscount) {
        // Only process if it's actually a Basic discount
        if (line.automaticDiscount.__typename === "DiscountAutomaticBasic") {
          const discount = transformAutomaticDiscount(line);
          if (discount) automaticDiscounts.push(discount);
        }
      }
    }

    logger.info("Fetching automatic BXGY discounts via bulk operation...");
    const autoBxgyResult = await runBulkQueryAndDownload(
      client,
      DISCOUNTS_AUTOMATIC_BXGY_BULK
    );
    if (!autoBxgyResult.ok) {
      return err(autoBxgyResult.error);
    }
    for await (const line of autoBxgyResult.data) {
      if (line.automaticDiscount) {
        // Only process if it's actually a BXGY discount
        if (line.automaticDiscount.__typename === "DiscountAutomaticBxgy") {
          const discount = transformAutomaticDiscount(line);
          if (discount) automaticDiscounts.push(discount);
        }
      }
    }

    logger.info(
      "Fetching automatic FreeShipping discounts via bulk operation..."
    );
    const autoFreeShippingResult = await runBulkQueryAndDownload(
      client,
      DISCOUNTS_AUTOMATIC_FREE_SHIPPING_BULK
    );
    if (!autoFreeShippingResult.ok) {
      return err(autoFreeShippingResult.error);
    }
    for await (const line of autoFreeShippingResult.data) {
      if (line.automaticDiscount) {
        // Only process if it's actually a FreeShipping discount
        if (
          line.automaticDiscount.__typename === "DiscountAutomaticFreeShipping"
        ) {
          const discount = transformAutomaticDiscount(line);
          if (discount) automaticDiscounts.push(discount);
        }
      }
    }

    logger.info(
      `Found ${codeDiscounts.length} code discounts and ${automaticDiscounts.length} automatic discounts`
    );

    // Write to file
    const dump: DiscountsDump = {
      codeDiscounts,
      automaticDiscounts,
    };

    fs.writeFileSync(outputFile, JSON.stringify(dump, null, 2));
    logger.info(`✅ Discounts dumped to ${outputFile}`);

    return ok(undefined);
  } catch (error) {
    logger.error("Error dumping discounts", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Transform code discount from bulk result to dumped format
 */
function transformCodeDiscount(node: any): DumpedDiscount | null {
  const discount = node.codeDiscount;
  if (!discount || !discount.__typename) return null;

  const type = discount.__typename as DiscountType;
  let codes: string[] = [];
  if (discount.__typename === "DiscountCodeFreeShipping") {
    codes =
      discount.codes?.edges?.map((e: any) => e.node.code).filter(Boolean) || [];
    if (
      (!codes || codes.length === 0) &&
      typeof discount.title === "string" &&
      discount.title.length > 0
    ) {
      codes = [discount.title];
    }
  } else {
    codes =
      discount.codes?.edges?.map((e: any) => e.node.code).filter(Boolean) || [];
  }

  const baseFields: Partial<DumpedDiscount> = {
    type,
    title: discount.title,
    status: discount.status,
    summary: discount.summary,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    combinesWith: discount.combinesWith,
    codes,
    usageLimit: discount.usageLimit,
    appliesOncePerCustomer: discount.appliesOncePerCustomer,
    asyncUsageCount: discount.asyncUsageCount,
    recurringCycleLimit: discount.recurringCycleLimit,
  };

  if (type === "DiscountCodeBasic") {
    return {
      ...baseFields,
      type: "DiscountCodeBasic",
      customerGets: {
        value: transformDiscountValue(discount.customerGets.value),
        items: transformDiscountItems(discount.customerGets.items),
        appliesOnOneTimePurchase:
          discount.customerGets.appliesOnOneTimePurchase,
        appliesOnSubscription: discount.customerGets.appliesOnSubscription,
      },
      customerSelection: transformCustomerSelection(discount.customerSelection),
      minimumRequirement: transformMinimumRequirement(
        discount.minimumRequirement
      ),
    } as DumpedDiscount;
  } else if (type === "DiscountCodeBxgy") {
    return {
      ...baseFields,
      type: "DiscountCodeBxgy",
      customerBuys: {
        items: transformDiscountItems(discount.customerBuys.items),
        value: transformBxgyValue(discount.customerBuys.value),
      },
      customerGets: {
        value: transformDiscountValue(discount.customerGets.value),
        items: transformDiscountItems(discount.customerGets.items),
        appliesOnOneTimePurchase:
          discount.customerGets.appliesOnOneTimePurchase,
        appliesOnSubscription: discount.customerGets.appliesOnSubscription,
      },
      customerSelection: transformCustomerSelection(discount.customerSelection),
      usesPerOrderLimit: discount.usesPerOrderLimit,
    } as DumpedDiscount;
  } else if (type === "DiscountCodeFreeShipping") {
    let minReq = transformMinimumRequirement(discount.minimumRequirement);
    if (!minReq || (minReq as any).type === "none") {
      minReq = parseMinimumFromSummary(discount.summary);
    }
    return {
      ...baseFields,
      type: "DiscountCodeFreeShipping",
      customerSelection: transformCustomerSelection(discount.customerSelection),
      minimumRequirement: minReq,
      destination: transformShippingDestination(discount.destinationSelection),
      maximumShippingPrice: discount.maximumShippingPrice?.amount,
      appliesOnOneTimePurchase: discount.appliesOnOneTimePurchase,
      appliesOnSubscription: discount.appliesOnSubscription,
    } as DumpedDiscount;
  }

  return null;
}

/**
 * Transform automatic discount from bulk result to dumped format
 */
function transformAutomaticDiscount(node: any): DumpedDiscount | null {
  const discount = node.automaticDiscount;
  if (!discount || !discount.__typename) return null;

  const type = discount.__typename as DiscountType;

  const baseFields: Partial<DumpedDiscount> = {
    type,
    title: discount.title,
    status: discount.status,
    summary: discount.summary,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    combinesWith: discount.combinesWith,
    recurringCycleLimit: discount.recurringCycleLimit,
  };

  if (type === "DiscountAutomaticBasic") {
    return {
      ...baseFields,
      type: "DiscountAutomaticBasic",
      customerGets: {
        value: transformDiscountValue(discount.customerGets.value),
        items: transformDiscountItems(discount.customerGets.items),
        appliesOnOneTimePurchase:
          discount.customerGets.appliesOnOneTimePurchase,
        appliesOnSubscription: discount.customerGets.appliesOnSubscription,
      },
      minimumRequirement: transformMinimumRequirement(
        discount.minimumRequirement
      ),
    } as DumpedDiscount;
  } else if (type === "DiscountAutomaticBxgy") {
    return {
      ...baseFields,
      type: "DiscountAutomaticBxgy",
      customerBuys: {
        items: transformDiscountItems(discount.customerBuys.items),
        value: transformBxgyValue(discount.customerBuys.value),
      },
      customerGets: {
        value: transformDiscountValue(discount.customerGets.value),
        items: transformDiscountItems(discount.customerGets.items),
        appliesOnOneTimePurchase:
          discount.customerGets.appliesOnOneTimePurchase,
        appliesOnSubscription: discount.customerGets.appliesOnSubscription,
      },
      usesPerOrderLimit: discount.usesPerOrderLimit,
    } as DumpedDiscount;
  } else if (type === "DiscountAutomaticFreeShipping") {
    return {
      ...baseFields,
      type: "DiscountAutomaticFreeShipping",
      minimumRequirement: transformMinimumRequirement(
        discount.minimumRequirement
      ),
      destination: transformShippingDestination(discount.destinationSelection),
      maximumShippingPrice: discount.maximumShippingPrice?.amount,
      appliesOnOneTimePurchase: discount.appliesOnOneTimePurchase,
      appliesOnSubscription: discount.appliesOnSubscription,
    } as DumpedDiscount;
  }

  return null;
}

/**
 * Transform discount value (percentage, fixed amount, or on quantity)
 */
function transformDiscountValue(value: any): DiscountValue {
  if (value.percentage !== undefined) {
    return { type: "percentage", percentage: value.percentage };
  } else if (value.amount) {
    return {
      type: "fixedAmount",
      amount: value.amount.amount,
      appliesOnEachItem: value.appliesOnEachItem,
    };
  } else if (value.quantity) {
    return {
      type: "onQuantity",
      quantity: value.quantity.quantity,
      effect: transformDiscountValue(value.effect),
    } as DiscountValue;
  }
  // Fallback
  return { type: "percentage", percentage: 0 };
}

/**
 * Transform discount items (all, products, or collections)
 */
function transformDiscountItems(items: any): DiscountItems {
  if (items.allItems) {
    return { type: "all" };
  } else if (items.products || items.productVariants) {
    const productHandles =
      items.products?.edges?.map((e: any) => e.node.handle).filter(Boolean) ||
      [];
    const variantRefs =
      items.productVariants?.edges
        ?.map((e: any) => ({
          productHandle: e.node.product?.handle,
          sku: e.node.sku,
        }))
        .filter((v: any) => v.productHandle) || [];

    return {
      type: "products",
      productHandles,
      variantRefs,
    };
  } else if (items.collections) {
    const collectionHandles =
      items.collections?.edges
        ?.map((e: any) => e.node.handle)
        .filter(Boolean) || [];
    return {
      type: "collections",
      collectionHandles,
    };
  }

  return { type: "all" };
}

/**
 * Transform customer selection (all or segments)
 */
function transformCustomerSelection(
  selection: any
): CustomerSelection | undefined {
  if (!selection) return undefined;

  if (selection.allCustomers) {
    return { type: "all" };
  } else if (selection.segments) {
    const segments = selection.segments || [];
    return {
      type: "segments",
      segmentIds: segments.map((s: any) => s.id).filter(Boolean),
      segmentNames: segments.map((s: any) => s.name).filter(Boolean),
    };
  }

  return { type: "all" };
}

/**
 * Transform minimum purchase requirement
 */
function transformMinimumRequirement(
  requirement: any
): MinimumRequirement | undefined {
  if (!requirement) return undefined;

  if (requirement.greaterThanOrEqualToQuantity !== undefined) {
    return {
      type: "quantity",
      quantity: requirement.greaterThanOrEqualToQuantity,
    };
  } else if (requirement.greaterThanOrEqualToSubtotal !== undefined) {
    // API returns MoneyV2 for subtotal: { amount: string, currencyCode: string }
    const subtotal = requirement.greaterThanOrEqualToSubtotal;
    const amount =
      subtotal && (subtotal.amount ?? subtotal)
        ? subtotal.amount ?? subtotal
        : undefined;
    return {
      type: "subtotal",
      amount: amount,
    };
  } else if (requirement.greaterThanOrEqualToItems !== undefined) {
    return {
      type: "items",
      quantity: requirement.greaterThanOrEqualToItems,
    };
  } else if (
    requirement.message !== undefined ||
    requirement.__typename === "DiscountNoMinimum"
  ) {
    return { type: "none" };
  }

  return { type: "none" };
}

/**
 * Transform BXGY value (quantity or purchase amount)
 */
function transformBxgyValue(value: any): BxgyValue {
  if (value.quantity !== undefined) {
    return { type: "quantity", quantity: value.quantity };
  } else if (value.amount !== undefined) {
    return { type: "purchaseAmount", amount: value.amount };
  }
  return { type: "quantity", quantity: 1 };
}

/**
 * Transform shipping destination
 */
function transformShippingDestination(
  destination: any
): ShippingDestination | undefined {
  if (!destination) return undefined;

  if (destination.allCountries) {
    return { type: "all" };
  } else if (destination.countries) {
    return {
      type: "countries",
      countries: destination.countries,
      includeRestOfWorld: destination.includeRestOfWorld,
    };
  }

  return { type: "all" };
}

/**
 * Parse a minimum subtotal from a human-readable summary string as a fallback
 * Example summary: "Free shipping on all products • Minimum purchase of $1,000.00 • For all countries"
 */
function parseMinimumFromSummary(summary: any): MinimumRequirement | undefined {
  if (!summary || typeof summary !== "string") return undefined;
  const re = /Minimum purchase of \$?([\d,]+(?:\.\d+)?)/i;
  const m = summary.match(re);
  if (!m) return undefined;
  const num = m[1].replace(/,/g, "");
  return { type: "subtotal", amount: num };
}
