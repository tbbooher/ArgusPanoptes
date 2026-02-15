"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import type { MapMarker, CategorySummary } from "@/lib/types";

const FullMap = dynamic(() => import("@/components/map/FullMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-gray-900 text-gray-500">
      Loading map...
    </div>
  ),
});

interface MapClientProps {
  markers: MapMarker[];
  categories: CategorySummary[];
}

export function MapClient({ markers, categories }: MapClientProps) {
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [minBooks, setMinBooks] = useState(0);

  const vendors = useMemo(() => {
    const set = new Set(markers.map((m) => m.vendor));
    return Array.from(set).sort();
  }, [markers]);

  const filtered = useMemo(() => {
    let result = markers;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          (m.city && m.city.toLowerCase().includes(q)),
      );
    }
    if (vendorFilter) {
      result = result.filter((m) => m.vendor === vendorFilter);
    }
    if (minBooks > 0) {
      result = result.filter((m) => m.booksHeld >= minBooks);
    }
    return result;
  }, [markers, search, vendorFilter, minBooks]);

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col lg:flex-row">
      {/* Sidebar */}
      <div className="flex-shrink-0 border-b border-gray-800 bg-gray-950 p-4 lg:w-72 lg:border-b-0 lg:border-r lg:overflow-y-auto">
        <h1 className="mb-4 text-lg font-bold text-white">Texas Libraries</h1>

        <div className="space-y-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or city..."
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none"
          />

          <select
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            className="w-full rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
          >
            <option value="">All vendors</option>
            {vendors.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>

          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Min books held: {minBooks}
            </label>
            <input
              type="range"
              min={0}
              max={100}
              value={minBooks}
              onChange={(e) => setMinBooks(parseInt(e.target.value, 10))}
              className="w-full"
            />
          </div>
        </div>

        <div className="mt-4 text-sm text-gray-500">
          Showing {filtered.length} of {markers.length} libraries
        </div>
      </div>

      {/* Map */}
      <div className="flex-1">
        <FullMap markers={filtered} />
      </div>
    </div>
  );
}
