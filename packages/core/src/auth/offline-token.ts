import crypto from "node:crypto";

import { ShopifyApiError, type Result, ok, err } from "../utils/types.js";

export type OAuthCallbackParams = Record<string, string | undefined>;

export function randomOAuthState(bytes: number = 16): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function buildAuthorizeUrl(input: {
  shop: string;
  clientId: string;
  scopes: string;
  redirectUri: string;
  state: string;
}): string {
  const { shop, clientId, scopes, redirectUri, state } = input;
  const base = `https://${shop}/admin/oauth/authorize`;

  const params = new URLSearchParams();
  params.set("client_id", clientId);
  params.set("scope", scopes);
  params.set("redirect_uri", redirectUri);
  params.set("state", state);

  return `${base}?${params.toString()}`;
}

export function verifyShopifyOAuthHmac(input: {
  params: OAuthCallbackParams;
  clientSecret: string;
}): Result<true, ShopifyApiError> {
  const { params, clientSecret } = input;
  const hmac = params.hmac;
  if (!hmac) {
    return err(new ShopifyApiError("Missing hmac in callback"));
  }

  const message = Object.keys(params)
    .filter((k) => k !== "hmac" && k !== "signature")
    .sort()
    .map((k) => `${k}=${params[k] ?? ""}`)
    .join("&");

  const digest = crypto
    .createHmac("sha256", clientSecret)
    .update(message)
    .digest("hex");

  if (!timingSafeEqualHex(digest, hmac)) {
    return err(new ShopifyApiError("Invalid HMAC in callback"));
  }

  return ok(true);
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export async function exchangeCodeForOfflineToken(input: {
  shop: string;
  clientId: string;
  clientSecret: string;
  code: string;
  expiring?: 0 | 1;
}): Promise<
  Result<
    {
      accessToken: string;
      scope?: string;
      expiresIn?: number;
      refreshToken?: string;
      refreshTokenExpiresIn?: number;
    },
    ShopifyApiError
  >
> {
  try {
    const url = `https://${input.shop}/admin/oauth/access_token`;

    const body = new URLSearchParams();
    body.set("client_id", input.clientId);
    body.set("client_secret", input.clientSecret);
    body.set("code", input.code);
    if (input.expiring === 1) body.set("expiring", "1");

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });

    const text = await resp.text();
    if (!resp.ok) {
      return err(
        new ShopifyApiError(
          `Token exchange failed HTTP ${resp.status}: ${text}`,
          resp.status,
          text,
        ),
      );
    }

    const json = JSON.parse(text) as any;
    if (!json?.access_token) {
      return err(new ShopifyApiError(`No access_token in response: ${text}`));
    }

    return ok({
      accessToken: json.access_token,
      scope: json.scope,
      expiresIn: json.expires_in,
      refreshToken: json.refresh_token,
      refreshTokenExpiresIn: json.refresh_token_expires_in,
    });
  } catch (error: any) {
    return err(new ShopifyApiError(error?.message || "Token exchange failed"));
  }
}
