/**
 * Policies Apply
 *
 * Imports shop policies into the destination store.
 *
 * Purpose:
 * - Read policies from JSON dump
 * - Update shop policies using shopPolicyUpdate mutation
 * - Each policy type is updated separately
 * - Skip policies that don't exist in dump or are empty
 *
 * Idempotency (Update Pattern):
 * - Always updates policies if present in dump (no upsert needed, policies always exist)
 * - Empty/null policies are skipped
 * - Safe to re-run; overwrites existing policies with dump content
 *
 * Note: Shop policies are updated one at a time. Each policy has its own mutation.
 */

import * as fs from "node:fs";
import { GraphQLClient } from "../graphql/client.js";
import { SHOP_POLICY_UPDATE, type ShopPolicyType } from "../graphql/queries.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";
import type { PoliciesDump, PolicyData } from "./dump.js";

export interface PoliciesApplyStats {
  updated: number;
  skipped: number;
  failed: number;
  automaticManagement: number;
  errors: Array<{
    policy: string;
    error: string;
    isAutomaticManagement?: boolean;
  }>;
}

/**
 * Apply policies from a dump file to the destination store
 */
export async function applyPolicies(
  client: GraphQLClient,
  inputFile: string
): Promise<Result<PoliciesApplyStats>> {
  logger.info("Starting policies apply...");

  try {
    // Read dump file
    if (!fs.existsSync(inputFile)) {
      return err(new Error(`Input file not found: ${inputFile}`));
    }

    const content = fs.readFileSync(inputFile, "utf-8");
    const dump: PoliciesDump = JSON.parse(content);

    if (!dump.policies) {
      return err(new Error("Invalid dump format: missing 'policies' object"));
    }

    logger.info("Loaded policies from dump");

    // Apply each policy
    const stats: PoliciesApplyStats = {
      updated: 0,
      skipped: 0,
      failed: 0,
      automaticManagement: 0,
      errors: [],
    };

    for (const policy of dump.policies) {
      // Skip if policy doesn't exist or is empty
      if (!policy || !policy.body || !policy.type) {
        stats.skipped++;
        logger.debug(
          `⏭️  Skipping empty/missing policy: ${policy?.type || "unknown"}`
        );
        continue;
      }

      // Update the policy
      const updateResult = await updatePolicy(
        client,
        policy.type as ShopPolicyType,
        policy
      );
      if (updateResult.ok) {
        stats.updated++;
        logger.info(`✅ Updated policy: ${policy.type}`);
      } else {
        // Check if this is an automatic management error
        const isAutoManagement = updateResult.error.message
          .toLowerCase()
          .includes("automatic management");

        if (isAutoManagement) {
          stats.automaticManagement++;
          logger.info(
            `⚠️  Skipped policy (automatic management enabled): ${policy.type}`
          );
        } else {
          stats.failed++;
          logger.warn(`❌ Failed to update policy: ${policy.type}`, {
            error: updateResult.error.message,
          });
        }

        stats.errors.push({
          policy: policy.type,
          error: updateResult.error.message,
          isAutomaticManagement: isAutoManagement,
        });
      }

      // Throttle to avoid rate limits
      await sleep(500);
    }

    logger.info("Policies apply complete", {
      updated: stats.updated,
      skipped: stats.skipped,
      automaticManagement: stats.automaticManagement,
      failed: stats.failed,
    });

    return ok(stats);
  } catch (error) {
    logger.error("Error applying policies", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Update a single shop policy using the shopPolicyUpdate mutation
 */
async function updatePolicy(
  client: GraphQLClient,
  type: ShopPolicyType,
  policy: PolicyData
): Promise<Result<void>> {
  try {
    const result = await client.request({
      query: SHOP_POLICY_UPDATE,
      variables: {
        shopPolicy: {
          type,
          body: policy.body,
        },
      },
    });

    if (!result.ok) {
      return err(result.error);
    }

    const response = result.data.data?.shopPolicyUpdate;
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
 * Sleep for the given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
