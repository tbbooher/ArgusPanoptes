// ---------------------------------------------------------------------------
// Tests for the AdapterRegistry.
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach } from "vitest";

import { AdapterRegistry } from "../../../src/core/adapter-registry.js";
import type {
  LibraryCatalogAdapter,
  LibrarySystemId,
  AdapterProtocol,
  ISBN13,
  LibrarySystem,
  AdapterSearchResult,
  AdapterHealthStatus,
} from "../../../src/core/types.js";

/** Helper to create a branded LibrarySystemId. */
const sysId = (id: string) => id as LibrarySystemId;

/** Minimal mock adapter for testing. */
function mockAdapter(
  systemId: string,
  protocol: string = "sru",
): LibraryCatalogAdapter {
  return {
    protocol: protocol as AdapterProtocol,
    systemId: systemId as LibrarySystemId,
    search: async (
      _isbn: ISBN13,
      _system: LibrarySystem,
      _signal?: AbortSignal,
    ): Promise<AdapterSearchResult> => ({
      holdings: [],
      responseTimeMs: 0,
      protocol: protocol as AdapterProtocol,
    }),
    healthCheck: async (_system: LibrarySystem): Promise<AdapterHealthStatus> => ({
      systemId: systemId as LibrarySystemId,
      protocol: protocol as AdapterProtocol,
      healthy: true,
      latencyMs: 0,
      message: "ok",
      checkedAt: new Date().toISOString(),
    }),
  };
}

describe("AdapterRegistry", () => {
  let registry: AdapterRegistry;

  beforeEach(() => {
    registry = new AdapterRegistry();
  });

  // ── register ──────────────────────────────────────────────────────────

  it("can register an adapter for a system", () => {
    const adapter = mockAdapter("sys-a");
    registry.register(sysId("sys-a"), adapter);
    expect(registry.has(sysId("sys-a"))).toBe(true);
  });

  it("can register multiple adapters for the same system", () => {
    const a1 = mockAdapter("sys-a", "sru");
    const a2 = mockAdapter("sys-a", "sierra_rest");
    registry.register(sysId("sys-a"), a1);
    registry.register(sysId("sys-a"), a2);
    expect(registry.getAdapters(sysId("sys-a")).length).toBe(2);
  });

  // ── getAdapters ───────────────────────────────────────────────────────

  it("returns all adapters in registration order", () => {
    const a1 = mockAdapter("sys-a", "sru");
    const a2 = mockAdapter("sys-a", "sierra_rest");
    registry.register(sysId("sys-a"), a1);
    registry.register(sysId("sys-a"), a2);

    const adapters = registry.getAdapters(sysId("sys-a"));
    expect(adapters[0].protocol).toBe("sru");
    expect(adapters[1].protocol).toBe("sierra_rest");
  });

  it("returns an empty array for an unregistered system", () => {
    expect(registry.getAdapters(sysId("unknown"))).toEqual([]);
  });

  // ── getPrimaryAdapter ─────────────────────────────────────────────────

  it("returns the first-registered adapter as primary", () => {
    const a1 = mockAdapter("sys-a", "sru");
    const a2 = mockAdapter("sys-a", "sierra_rest");
    registry.register(sysId("sys-a"), a1);
    registry.register(sysId("sys-a"), a2);

    const primary = registry.getPrimaryAdapter(sysId("sys-a"));
    expect(primary).not.toBeNull();
    expect(primary!.protocol).toBe("sru");
  });

  it("returns null when no adapter is registered for a system", () => {
    expect(registry.getPrimaryAdapter(sysId("unknown"))).toBeNull();
  });

  // ── has ────────────────────────────────────────────────────────────────

  it("returns true for a registered system", () => {
    registry.register(sysId("sys-a"), mockAdapter("sys-a"));
    expect(registry.has(sysId("sys-a"))).toBe(true);
  });

  it("returns false for an unregistered system", () => {
    expect(registry.has(sysId("unknown"))).toBe(false);
  });

  // ── size ──────────────────────────────────────────────────────────────

  it("returns 0 when empty", () => {
    expect(registry.size).toBe(0);
  });

  it("returns the number of distinct systems", () => {
    registry.register(sysId("sys-a"), mockAdapter("sys-a"));
    registry.register(sysId("sys-b"), mockAdapter("sys-b"));
    registry.register(sysId("sys-a"), mockAdapter("sys-a", "sierra_rest")); // second adapter for sys-a
    expect(registry.size).toBe(2);
  });

  // ── getAllSystemIds ────────────────────────────────────────────────────

  it("returns all registered system IDs", () => {
    registry.register(sysId("sys-a"), mockAdapter("sys-a"));
    registry.register(sysId("sys-b"), mockAdapter("sys-b"));
    const ids = registry.getAllSystemIds();
    expect(ids).toContain("sys-a");
    expect(ids).toContain("sys-b");
    expect(ids.length).toBe(2);
  });

  it("returns an empty array when no systems are registered", () => {
    expect(registry.getAllSystemIds()).toEqual([]);
  });
});
