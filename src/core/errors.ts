// ---------------------------------------------------------------------------
// Error hierarchy for the Book Finder service.
// ---------------------------------------------------------------------------

import type { AdapterProtocol, LibrarySystemId } from "./types.js";

// ── Base error ──────────────────────────────────────────────────────────────

/**
 * Root of all Book Finder domain errors.
 */
export class BookFinderError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BookFinderError";
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ── Adapter errors ──────────────────────────────────────────────────────────

/**
 * Base class for errors originating from a library catalog adapter.
 */
export class AdapterError extends BookFinderError {
  public readonly systemId: LibrarySystemId;
  public readonly protocol: AdapterProtocol;

  constructor(
    message: string,
    systemId: LibrarySystemId,
    protocol: AdapterProtocol,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AdapterError";
    this.systemId = systemId;
    this.protocol = protocol;
  }
}

/** The adapter could not establish a network connection. */
export class AdapterConnectionError extends AdapterError {
  constructor(
    message: string,
    systemId: LibrarySystemId,
    protocol: AdapterProtocol,
    options?: ErrorOptions,
  ) {
    super(message, systemId, protocol, options);
    this.name = "AdapterConnectionError";
  }
}

/** The adapter's request exceeded the allowed timeout. */
export class AdapterTimeoutError extends AdapterError {
  constructor(
    message: string,
    systemId: LibrarySystemId,
    protocol: AdapterProtocol,
    options?: ErrorOptions,
  ) {
    super(message, systemId, protocol, options);
    this.name = "AdapterTimeoutError";
  }
}

/** The adapter received an authentication or authorisation error. */
export class AdapterAuthError extends AdapterError {
  constructor(
    message: string,
    systemId: LibrarySystemId,
    protocol: AdapterProtocol,
    options?: ErrorOptions,
  ) {
    super(message, systemId, protocol, options);
    this.name = "AdapterAuthError";
  }
}

/** The remote system told us we are rate-limited. */
export class AdapterRateLimitError extends AdapterError {
  public readonly retryAfterMs: number | null;

  constructor(
    message: string,
    systemId: LibrarySystemId,
    protocol: AdapterProtocol,
    retryAfterMs: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, systemId, protocol, options);
    this.name = "AdapterRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

/** The adapter received a response it could not parse. */
export class AdapterParseError extends AdapterError {
  constructor(
    message: string,
    systemId: LibrarySystemId,
    protocol: AdapterProtocol,
    options?: ErrorOptions,
  ) {
    super(message, systemId, protocol, options);
    this.name = "AdapterParseError";
  }
}

// ── Domain errors ───────────────────────────────────────────────────────────

/** The supplied ISBN failed validation. */
export class ISBNValidationError extends BookFinderError {
  public readonly rawISBN: string;

  constructor(rawISBN: string, reason: string, options?: ErrorOptions) {
    super(`Invalid ISBN "${rawISBN}": ${reason}`, options);
    this.name = "ISBNValidationError";
    this.rawISBN = rawISBN;
  }
}

// ── Infrastructure errors ───────────────────────────────────────────────────

/** A required configuration value is missing or invalid. */
export class ConfigurationError extends BookFinderError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ConfigurationError";
  }
}

/** The overall search fan-out exceeded its time budget. */
export class SearchTimeoutError extends BookFinderError {
  public readonly searchId: string;
  public readonly budgetMs: number;

  constructor(
    searchId: string,
    budgetMs: number,
    options?: ErrorOptions,
  ) {
    super(
      `Search ${searchId} timed out after ${budgetMs}ms`,
      options,
    );
    this.name = "SearchTimeoutError";
    this.searchId = searchId;
    this.budgetMs = budgetMs;
  }
}
