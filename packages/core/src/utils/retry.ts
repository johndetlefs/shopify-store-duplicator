/**
 * Retry utilities with exponential backoff for rate limiting (HTTP 429/430).
 * Shopify-specific: handles both cost-based (430) and traditional rate limits (429).
 */

import { logger } from "./logger.js";

export interface RetryOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  shouldRetry?: (error: any) => boolean;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxAttempts: 5,
  initialDelayMs: 1000,
  maxDelayMs: 32000,
  jitterMs: 500,
  shouldRetry: (error: any) => {
    // Retry on 429 (rate limit) and 430 (GraphQL throttle)
    if (error?.status === 429 || error?.status === 430) return true;
    // Retry on network errors
    if (error?.code === "ECONNRESET" || error?.code === "ETIMEDOUT")
      return true;
    return false;
  },
};

/**
 * Execute a function with exponential backoff retry logic.
 *
 * @example
 * const result = await withBackoff(async () => {
 *   return await fetchFromShopify();
 * });
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: any;

  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;

      if (!opts.shouldRetry(error)) {
        // Non-retryable error, fail immediately
        throw error;
      }

      if (attempt >= opts.maxAttempts) {
        // Max attempts reached
        logger.error("Max retry attempts reached", {
          attempts: attempt,
          error: error.message,
        });
        throw error;
      }

      // Calculate backoff with exponential growth and jitter
      const exponentialDelay = Math.min(
        opts.initialDelayMs * Math.pow(2, attempt - 1),
        opts.maxDelayMs
      );
      const jitter = Math.random() * opts.jitterMs;
      const delayMs = exponentialDelay + jitter;

      logger.warn("Retrying after error", {
        attempt,
        maxAttempts: opts.maxAttempts,
        delayMs: Math.round(delayMs),
        error: error.message,
        status: error.status,
      });

      await sleep(delayMs);
    }
  }

  throw lastError;
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate limiter for chunked operations.
 * Ensures operations don't exceed a certain rate (ops per second).
 */
export class RateLimiter {
  private queue: Array<() => void> = [];
  private running = 0;
  private lastRun = 0;

  constructor(
    private readonly maxConcurrent: number = 5,
    private readonly minIntervalMs: number = 100
  ) {}

  /**
   * Execute a function with rate limiting.
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquireSlot();
    this.running++;

    try {
      return await fn();
    } finally {
      this.running--;
      this.releaseSlot();
    }
  }

  private async acquireSlot(): Promise<void> {
    // Wait for available slot
    while (this.running >= this.maxConcurrent) {
      await new Promise((resolve) => this.queue.push(resolve));
    }

    // Enforce minimum interval between operations
    const now = Date.now();
    const timeSinceLastRun = now - this.lastRun;
    if (timeSinceLastRun < this.minIntervalMs) {
      await sleep(this.minIntervalMs - timeSinceLastRun);
    }
    this.lastRun = Date.now();
  }

  private releaseSlot(): void {
    const next = this.queue.shift();
    if (next) next();
  }
}
