/**
 * Security utilities for redacting sensitive information from logs and URLs.
 * Never log admin tokens or expose them in error messages.
 */

/**
 * Redact admin token from a URL or string.
 * Shopify admin tokens are typically in the format: shpat_...
 *
 * @example
 * redactToken('https://shop.myshopify.com/admin/api?token=shpat_abc123')
 * // 'https://shop.myshopify.com/admin/api?token=shpat_***'
 */
export function redactToken(input: string): string {
  // Redact shpat_ tokens
  let redacted = input.replace(/shpat_[a-zA-Z0-9]+/g, "shpat_***");

  // Redact X-Shopify-Access-Token header values
  redacted = redacted.replace(
    /(X-Shopify-Access-Token:\s*)[a-zA-Z0-9_-]+/gi,
    "$1***"
  );

  // Redact access_token query params
  redacted = redacted.replace(/([?&]access_token=)[a-zA-Z0-9_-]+/gi, "$1***");

  return redacted;
}

/**
 * Redact sensitive fields from an object for logging.
 *
 * @example
 * redactObject({ token: 'shpat_abc', name: 'Store' })
 * // { token: '***', name: 'Store' }
 */
export function redactObject<T extends Record<string, any>>(
  obj: T,
  sensitiveKeys: string[] = [
    "token",
    "password",
    "secret",
    "apiKey",
    "accessToken",
  ]
): Record<string, any> {
  const redacted: Record<string, any> = { ...obj };

  for (const key of Object.keys(redacted)) {
    const lowerKey = key.toLowerCase();
    if (sensitiveKeys.some((k) => lowerKey.includes(k.toLowerCase()))) {
      redacted[key] = "***";
    } else if (typeof redacted[key] === "string") {
      redacted[key] = redactToken(redacted[key]);
    } else if (typeof redacted[key] === "object" && redacted[key] !== null) {
      redacted[key] = redactObject(redacted[key], sensitiveKeys);
    }
  }

  return redacted;
}

/**
 * Create a safe error object for logging (with sensitive info redacted).
 */
export function safeError(error: any): Record<string, any> {
  const safe: Record<string, any> = {
    message: error.message || String(error),
    name: error.name,
    stack: error.stack ? redactToken(error.stack) : undefined,
  };

  // Include other enumerable properties, redacted
  for (const key of Object.keys(error)) {
    if (!(key in safe)) {
      const value = error[key];
      if (typeof value === "string") {
        safe[key] = redactToken(value);
      } else if (typeof value === "object") {
        safe[key] = redactObject(value);
      } else {
        safe[key] = value;
      }
    }
  }

  return safe;
}
