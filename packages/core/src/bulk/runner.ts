/**
 * Bulk Operations runner for Shopify GraphQL.
 * Handles launching bulk queries, polling for completion, and downloading JSONL results.
 *
 * Shopify Bulk Operations allow efficient extraction of large datasets:
 * - Submit a query → get operation ID
 * - Poll until COMPLETED
 * - Download JSONL from result URL
 * - Parse line-by-line for memory efficiency
 */

import { logger } from "../utils/logger.js";
import { withBackoff } from "../utils/retry.js";
import { type GraphQLClient } from "../graphql/client.js";
import {
  BULK_OPERATION_RUN_QUERY,
  CURRENT_BULK_OPERATION,
} from "../graphql/queries.js";
import { ShopifyApiError, type Result, ok, err } from "../utils/types.js";

export type BulkOperationStatus =
  | "CREATED"
  | "RUNNING"
  | "COMPLETED"
  | "CANCELED"
  | "FAILED"
  | "EXPIRED";

export interface BulkOperation {
  id: string;
  status: BulkOperationStatus;
  errorCode?: string;
  createdAt: string;
  completedAt?: string;
  objectCount?: number;
  fileSize?: number;
  url?: string;
  partialDataUrl?: string;
}

export interface BulkOperationResult {
  operation: BulkOperation;
  data: AsyncIterable<any>;
}

/**
 * Launch a bulk query operation.
 * Returns the operation ID for polling.
 */
export async function runBulkQuery(
  client: GraphQLClient,
  query: string
): Promise<Result<string, ShopifyApiError>> {
  logger.info("Launching bulk operation");

  const result = await client.request({
    query: BULK_OPERATION_RUN_QUERY,
    variables: { query },
  });

  if (!result.ok) {
    return err(result.error);
  }

  const response = result.data.data?.bulkOperationRunQuery;
  if (response?.userErrors && response.userErrors.length > 0) {
    const errorMsg = response.userErrors.map((e: any) => e.message).join(", ");
    return err(new ShopifyApiError(`Bulk operation failed: ${errorMsg}`));
  }

  const operationId = response?.bulkOperation?.id;
  if (!operationId) {
    return err(new ShopifyApiError("No operation ID returned"));
  }

  logger.info("Bulk operation started", { operationId });
  return ok(operationId);
}

/**
 * Poll the current bulk operation until it completes.
 * Uses exponential backoff between polls.
 */
export async function pollBulkOperation(
  client: GraphQLClient,
  options: {
    maxWaitMs?: number;
    pollIntervalMs?: number;
  } = {}
): Promise<Result<BulkOperation, ShopifyApiError>> {
  const maxWaitMs = options.maxWaitMs || 30 * 60 * 1000; // 30 minutes default
  const initialPollIntervalMs = options.pollIntervalMs || 1000;

  const startTime = Date.now();
  let pollInterval = initialPollIntervalMs;
  let lastStatus: BulkOperationStatus | undefined;

  while (Date.now() - startTime < maxWaitMs) {
    const result = await client.request({
      query: CURRENT_BULK_OPERATION,
    });

    if (!result.ok) {
      return err(result.error);
    }

    const operation: BulkOperation | null =
      result.data.data?.currentBulkOperation;

    if (!operation) {
      return err(new ShopifyApiError("No bulk operation in progress"));
    }

    // Log status changes
    if (operation.status !== lastStatus) {
      logger.info("Bulk operation status", {
        status: operation.status,
        objectCount: operation.objectCount,
        fileSize: operation.fileSize,
      });
      lastStatus = operation.status;
    }

    // Check terminal states
    if (operation.status === "COMPLETED") {
      logger.info("Bulk operation completed", {
        objectCount: operation.objectCount,
        fileSize: operation.fileSize,
        duration: Date.now() - startTime,
      });
      return ok(operation);
    }

    if (operation.status === "FAILED") {
      return err(
        new ShopifyApiError(
          `Bulk operation failed: ${operation.errorCode || "Unknown error"}`
        )
      );
    }

    if (operation.status === "CANCELED") {
      return err(new ShopifyApiError("Bulk operation was canceled"));
    }

    if (operation.status === "EXPIRED") {
      return err(new ShopifyApiError("Bulk operation expired"));
    }

    // Wait before next poll, with exponential backoff
    await sleep(pollInterval);
    pollInterval = Math.min(pollInterval * 1.5, 10000); // Max 10s between polls
  }

  return err(new ShopifyApiError("Bulk operation polling timeout"));
}

/**
 * Download and parse JSONL from a bulk operation result URL.
 * Returns an async iterable that yields parsed objects line-by-line.
 *
 * IMPORTANT: Shopify bulk JSONL has a special structure:
 * - Each line is a JSON object
 * - Objects with __parentId reference their parent in the tree
 * - Must reconstruct relationships (e.g., metafields -> product)
 */
export async function* downloadBulkJsonl(url: string): AsyncIterable<any> {
  logger.info("Downloading bulk operation results", {
    url: url.substring(0, 50) + "...",
  });

  const response = await withBackoff(async () => {
    const res = await fetch(url);
    if (!res.ok) {
      throw new ShopifyApiError(
        `Failed to download JSONL: ${res.statusText}`,
        res.status
      );
    }
    return res;
  });

  if (!response.ok) {
    throw response.error;
  }

  const body = response.data.body;
  if (!body) {
    throw new ShopifyApiError("No response body");
  }

  // Stream and parse line-by-line
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lineCount = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        // Process any remaining content in buffer
        if (buffer.trim()) {
          try {
            const obj = JSON.parse(buffer);
            lineCount++;
            yield obj;
          } catch (parseError) {
            logger.warn("Failed to parse final line", {
              line: buffer.substring(0, 100),
            });
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      // Split by newlines and process complete lines
      const lines = buffer.split("\n");
      buffer = lines.pop() || ""; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const obj = JSON.parse(line);
          lineCount++;
          yield obj;
        } catch (parseError) {
          logger.warn("Failed to parse JSONL line", {
            line: line.substring(0, 100),
            error: String(parseError),
          });
        }
      }
    }

    logger.info("Bulk JSONL download complete", { lineCount });
  } finally {
    reader.releaseLock();
  }
}

/**
 * Run a bulk query and wait for completion, then return the data stream.
 * This is a convenience wrapper for the full workflow.
 */
export async function runBulkQueryAndDownload(
  client: GraphQLClient,
  query: string
): Promise<Result<AsyncIterable<any>, ShopifyApiError>> {
  // Launch bulk operation
  const launchResult = await runBulkQuery(client, query);
  if (!launchResult.ok) {
    return err(launchResult.error);
  }

  // Poll until complete
  const pollResult = await pollBulkOperation(client);
  if (!pollResult.ok) {
    return err(pollResult.error);
  }

  const operation = pollResult.data;
  if (!operation.url) {
    return err(new ShopifyApiError("No download URL in completed operation"));
  }

  // Return the async iterable for streaming the data
  return ok(downloadBulkJsonl(operation.url));
}

/**
 * Helper to sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
