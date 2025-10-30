/**
 * Policies Dump
 *
 * Exports shop policies (legal pages) from the source store to a JSON file.
 *
 * Purpose:
 * - Query all shop policies: refund, privacy, terms of service, shipping, contact
 * - Export policy content and metadata
 * - Preserve HTML formatting
 *
 * Output Format:
 * ```json
 * {
 *   "policies": {
 *     "refundPolicy": { "title": "...", "body": "...", "url": "..." },
 *     "privacyPolicy": { "title": "...", "body": "...", "url": "..." },
 *     "termsOfService": { "title": "...", "body": "...", "url": "..." },
 *     "shippingPolicy": { "title": "...", "body": "...", "url": "..." },
 *     "contactInformation": { "title": "...", "body": "...", "url": "..." }
 *   }
 * }
 * ```
 *
 * Idempotency: Safe to re-run; always exports current state.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { GraphQLClient } from "../graphql/client.js";
import { SHOP_POLICIES_QUERY } from "../graphql/queries.js";
import { logger } from "../utils/logger.js";
import { type Result, ok, err } from "../utils/types.js";

export interface PolicyData {
  type: string;
  body: string;
  url: string;
}

export interface PoliciesDump {
  policies: PolicyData[];
}

/**
 * Dump all shop policies from the source store
 */
export async function dumpPolicies(
  client: GraphQLClient,
  outputFile: string
): Promise<Result<void>> {
  logger.info("Starting policies dump...");

  try {
    // Ensure output directory exists
    const dir = path.dirname(outputFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Query shop policies
    logger.info("Fetching shop policies...");
    const result = await client.request({
      query: SHOP_POLICIES_QUERY,
      variables: {},
    });

    if (!result.ok) {
      return err(result.error);
    }

    const shop = result.data.data?.shop;
    if (!shop) {
      return err(new Error("No shop data returned"));
    }

    // Extract policies from shopPolicies array
    const policies: PolicyData[] = [];

    if (shop.shopPolicies && Array.isArray(shop.shopPolicies)) {
      for (const policy of shop.shopPolicies) {
        if (policy && policy.type && policy.body) {
          policies.push({
            type: String(policy.type),
            body: String(policy.body),
            url: String(policy.url || ""),
          });
        }
      }
    }

    logger.info(`Found ${policies.length} shop policies`);

    // Write to file
    const dump: PoliciesDump = { policies };
    fs.writeFileSync(outputFile, JSON.stringify(dump, null, 2));
    logger.info(`✅ Policies dumped to ${outputFile}`);

    // Log which policies were found
    if (policies.length > 0) {
      const policyTypes = policies.map((p) => p.type).join(", ");
      logger.info(`   Policies: ${policyTypes}`);
    } else {
      logger.warn("   No policies found in the source store");
    }

    return ok(undefined);
  } catch (error) {
    logger.error("Error dumping policies", { error });
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
