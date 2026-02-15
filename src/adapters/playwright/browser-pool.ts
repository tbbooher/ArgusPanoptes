// ---------------------------------------------------------------------------
// BrowserPool – Singleton Chromium browser pool for Playwright adapters.
//
// Manages a shared Chromium instance with isolated BrowserContexts per page.
// Lazy-initialised on first acquirePage() call.
// ---------------------------------------------------------------------------

import type { Browser, BrowserContext, Page } from "playwright-core";

export interface BrowserPoolOptions {
  /** Maximum number of concurrent pages (default: 5). */
  maxPages?: number;
  /** Chromium executable path (optional, uses playwright default). */
  executablePath?: string;
  /** Run in headless mode (default: true). */
  headless?: boolean;
}

const DEFAULT_MAX_PAGES = 5;

export class BrowserPool {
  private static instance: BrowserPool | null = null;

  private browser: Browser | null = null;
  private activePages = 0;
  private readonly maxPages: number;
  private readonly executablePath?: string;
  private readonly headless: boolean;
  private launchPromise: Promise<Browser> | null = null;

  private constructor(options: BrowserPoolOptions = {}) {
    this.maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
    // Allow CHROMIUM_PATH env var to override (set by Docker image).
    this.executablePath = options.executablePath ?? process.env["CHROMIUM_PATH"];
    this.headless = options.headless ?? true;
  }

  /** Get or create the singleton BrowserPool. */
  static getInstance(options?: BrowserPoolOptions): BrowserPool {
    if (!BrowserPool.instance) {
      BrowserPool.instance = new BrowserPool(options);
    }
    return BrowserPool.instance;
  }

  /** Reset the singleton (for testing). */
  static resetInstance(): void {
    BrowserPool.instance = null;
  }

  /**
   * Acquire an isolated page (new BrowserContext + Page).
   * Launches the browser on first call.
   * Throws if max concurrent pages reached.
   */
  async acquirePage(): Promise<{ page: Page; context: BrowserContext }> {
    if (this.activePages >= this.maxPages) {
      throw new Error(
        `BrowserPool: max concurrent pages (${this.maxPages}) reached`,
      );
    }

    const browser = await this.ensureBrowser();
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });
    const page = await context.newPage();
    this.activePages++;

    return { page, context };
  }

  /** Release a page and its context back to the pool. */
  async releasePage(page: Page, context: BrowserContext): Promise<void> {
    try {
      await context.close();
    } catch {
      // Context may already be closed
    }
    this.activePages = Math.max(0, this.activePages - 1);
  }

  /** Shut down the browser instance. */
  async shutdown(): Promise<void> {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Browser may already be closed
      }
      this.browser = null;
      this.launchPromise = null;
      this.activePages = 0;
    }
  }

  /** Number of currently active pages. */
  get currentPages(): number {
    return this.activePages;
  }

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) {
      return this.browser;
    }

    // Prevent multiple concurrent launches
    if (!this.launchPromise) {
      this.launchPromise = this.launchBrowser();
    }

    this.browser = await this.launchPromise;
    this.launchPromise = null;
    return this.browser;
  }

  private async launchBrowser(): Promise<Browser> {
    const { chromium } = await import("playwright-core");
    return chromium.launch({
      headless: this.headless,
      executablePath: this.executablePath,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
  }
}
