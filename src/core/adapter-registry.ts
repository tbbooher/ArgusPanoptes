// ---------------------------------------------------------------------------
// Adapter Registry – maps LibrarySystemId -> LibraryCatalogAdapter[].
// ---------------------------------------------------------------------------

import type { LibraryCatalogAdapter, LibrarySystemId } from "./types.js";

/**
 * Central registry that maps each library system to one or more catalog
 * adapters.  Adapters are stored in insertion order; the first adapter
 * registered for a given system is treated as the *primary* (preferred)
 * adapter, with subsequent entries serving as fallbacks.
 */
export class AdapterRegistry {
  private readonly registry = new Map<
    LibrarySystemId,
    LibraryCatalogAdapter[]
  >();

  // ── Mutation ────────────────────────────────────────────────────────────

  /**
   * Register an adapter for a library system.  Multiple adapters may be
   * registered for the same system; the first one added is the primary.
   */
  register(systemId: LibrarySystemId, adapter: LibraryCatalogAdapter): void {
    const existing = this.registry.get(systemId);
    if (existing) {
      existing.push(adapter);
    } else {
      this.registry.set(systemId, [adapter]);
    }
  }

  // ── Queries ─────────────────────────────────────────────────────────────

  /**
   * Return *all* adapters registered for `systemId`, in registration order.
   * Returns an empty array when the system has no adapters.
   */
  getAdapters(systemId: LibrarySystemId): LibraryCatalogAdapter[] {
    return this.registry.get(systemId) ?? [];
  }

  /**
   * Return the primary (first-registered) adapter for a system,
   * or `null` when none has been registered.
   */
  getPrimaryAdapter(
    systemId: LibrarySystemId,
  ): LibraryCatalogAdapter | null {
    const adapters = this.registry.get(systemId);
    return adapters && adapters.length > 0 ? adapters[0] : null;
  }

  /**
   * Return every system ID that has at least one adapter registered.
   */
  getAllSystemIds(): LibrarySystemId[] {
    return [...this.registry.keys()];
  }

  /**
   * Check whether at least one adapter is registered for `systemId`.
   */
  has(systemId: LibrarySystemId): boolean {
    return this.registry.has(systemId);
  }

  /**
   * Number of distinct library systems with registered adapters.
   */
  get size(): number {
    return this.registry.size;
  }
}
