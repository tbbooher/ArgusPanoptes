import type { ApiSearchResult } from "./types.js";

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2000;
const RATE_LIMIT_BACKOFF_MS = 10_000;

export async function searchByIsbn(
  apiUrl: string,
  isbn13: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<ApiSearchResult> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (signal?.aborted) {
      throw new Error("Aborted");
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      // Chain with external signal if provided
      if (signal) {
        signal.addEventListener("abort", () => controller.abort(), {
          once: true,
        });
      }

      const url = `${apiUrl}/search?isbn=${encodeURIComponent(isbn13)}`;
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (response.status === 429) {
        // Rate limited — back off and retry
        await sleep(RATE_LIMIT_BACKOFF_MS);
        continue;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = (await response.json()) as ApiSearchResult;
      return data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      if (lastError.name === "AbortError" && signal?.aborted) {
        throw lastError;
      }

      // Exponential backoff for transient failures
      if (attempt < MAX_RETRIES - 1) {
        const backoff = RETRY_BASE_MS * Math.pow(2, attempt);
        await sleep(backoff);
      }
    }
  }

  throw lastError ?? new Error("Search failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
