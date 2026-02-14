// ---------------------------------------------------------------------------
// SierraAuth – OAuth2 client_credentials token manager for III Sierra REST API.
//
// Sierra's token endpoint:
//   POST ${baseUrl}/iii/sierra-api/v6/token
//   Authorization: Basic base64(clientKey:clientSecret)
//   Body: grant_type=client_credentials
//
// Tokens are cached in memory and refreshed automatically when they are
// within 60 seconds of expiry.
// ---------------------------------------------------------------------------

import type { Logger } from "pino";

/** Safety margin before token actually expires (ms). */
const EXPIRY_MARGIN_MS = 60_000;

interface CachedToken {
  accessToken: string;
  expiresAt: number; // Unix ms
}

/**
 * Manages OAuth2 client_credentials tokens for a single Sierra REST API
 * instance.  Thread-safe in a single-threaded Node.js environment because
 * the pending refresh promise is reused to avoid duplicate token requests.
 */
export class SierraAuth {
  private readonly baseUrl: string;
  private readonly clientKey: string;
  private readonly clientSecret: string;
  private readonly logger: Logger;

  private cachedToken: CachedToken | null = null;
  private pendingRefresh: Promise<string> | null = null;

  constructor(
    baseUrl: string,
    clientKey: string,
    clientSecret: string,
    logger: Logger,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.clientKey = clientKey;
    this.clientSecret = clientSecret;
    this.logger = logger.child({ component: "SierraAuth" });
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Return a valid access token, refreshing if necessary.
   * Concurrent callers share a single in-flight refresh request.
   */
  async getToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.accessToken;
    }

    // Coalesce concurrent refresh calls.
    if (this.pendingRefresh) {
      return this.pendingRefresh;
    }

    this.pendingRefresh = this.refreshToken().finally(() => {
      this.pendingRefresh = null;
    });

    return this.pendingRefresh;
  }

  /**
   * Force the cached token to be discarded.  The next call to
   * {@link getToken} will issue a fresh token request.
   */
  invalidateToken(): void {
    this.cachedToken = null;
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private async refreshToken(): Promise<string> {
    const tokenUrl = `${this.baseUrl}/iii/sierra-api/v6/token`;

    const basicAuth = Buffer.from(
      `${this.clientKey}:${this.clientSecret}`,
    ).toString("base64");

    this.logger.debug({ url: tokenUrl }, "Requesting Sierra OAuth2 token");

    const response = await fetch(tokenUrl, {
      method: "POST",
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "client_credentials",
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `Sierra token request failed (HTTP ${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      token_type: string;
      expires_in: number;
    };

    this.cachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000 - EXPIRY_MARGIN_MS,
    };

    this.logger.info(
      { expiresInSeconds: data.expires_in },
      "Sierra OAuth2 token refreshed",
    );

    return this.cachedToken.accessToken;
  }
}
