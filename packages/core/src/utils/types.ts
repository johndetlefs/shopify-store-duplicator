/**
 * Type definitions and result types for error handling.
 * Uses discriminated unions for type-safe error handling.
 */

export type Result<T, E = Error> =
  | { ok: true; data: T }
  | { ok: false; error: E };

/**
 * Create a successful result.
 */
export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

/**
 * Create an error result.
 */
export function err<E = Error>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Unwrap a result, throwing if it's an error.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.data;
  }
  throw result.error;
}

/**
 * Map a result's data if successful.
 */
export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (data: T) => U
): Result<U, E> {
  if (result.ok) {
    return ok(fn(result.data));
  }
  return result;
}

/**
 * Common error types for the application.
 */
export class ShopifyApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly response?: any
  ) {
    super(message);
    this.name = "ShopifyApiError";
  }
}

export class ValidationError extends Error {
  constructor(message: string, public readonly details?: any) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string, public readonly resource?: string) {
    super(message);
    this.name = "NotFoundError";
  }
}
