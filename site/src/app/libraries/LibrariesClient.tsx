"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { LibraryEntry } from "@/lib/types";
import { FilterBar } from "@/components/ui/FilterBar";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { Badge } from "@/components/ui/Badge";

const columns: Column<LibraryEntry>[] = [
  {
    key: "name",
    header: "Library",
    sortable: true,
    sortValue: (l) => l.name,
    render: (l) => (
      <Link
        href={`/libraries/${l.id}`}
        className="font-medium text-blue-400 hover:text-blue-300"
      >
        {l.name}
      </Link>
    ),
  },
  {
    key: "city",
    header: "City",
    sortable: true,
    sortValue: (l) => l.city ?? "",
    render: (l) => (
      <span className="text-gray-400">{l.city ?? "-"}</span>
    ),
  },
  {
    key: "region",
    header: "Region",
    sortable: true,
    sortValue: (l) => l.region,
    render: (l) => <span className="text-gray-400">{l.region}</span>,
  },
  {
    key: "vendor",
    header: "Vendor",
    sortable: true,
    sortValue: (l) => l.vendor,
    render: (l) => <Badge>{l.vendor}</Badge>,
  },
  {
    key: "booksHeld",
    header: "Books Held",
    sortable: true,
    className: "text-right",
    sortValue: (l) => l.booksHeld,
    render: (l) => (
      <span className="font-mono text-gray-300">{l.booksHeld}</span>
    ),
  },
  {
    key: "totalCopies",
    header: "Total Copies",
    sortable: true,
    className: "text-right",
    sortValue: (l) => l.totalCopies,
    render: (l) => (
      <span className="font-mono text-gray-300">{l.totalCopies}</span>
    ),
  },
];

export function LibrariesClient({
  libraries,
}: {
  libraries: LibraryEntry[];
}) {
  const [search, setSearch] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");

  const regions = useMemo(() => {
    const set = new Set(libraries.map((l) => l.region));
    return Array.from(set)
      .sort()
      .map((r) => ({ value: r, label: r }));
  }, [libraries]);

  const vendors = useMemo(() => {
    const set = new Set(libraries.map((l) => l.vendor));
    return Array.from(set)
      .sort()
      .map((v) => ({ value: v, label: v }));
  }, [libraries]);

  const filtered = useMemo(() => {
    let result = libraries;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.name.toLowerCase().includes(q) ||
          (l.city && l.city.toLowerCase().includes(q)) ||
          l.id.toLowerCase().includes(q),
      );
    }
    if (regionFilter) {
      result = result.filter((l) => l.region === regionFilter);
    }
    if (vendorFilter) {
      result = result.filter((l) => l.vendor === vendorFilter);
    }
    return result;
  }, [libraries, search, regionFilter, vendorFilter]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Libraries</h1>
        <p className="mt-1 text-gray-400">
          {libraries.length.toLocaleString()} library systems tracked
        </p>
      </div>

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name or city..."
        filters={[
          {
            key: "region",
            label: "All regions",
            options: regions,
            value: regionFilter,
            onChange: setRegionFilter,
          },
          {
            key: "vendor",
            label: "All vendors",
            options: vendors,
            value: vendorFilter,
            onChange: setVendorFilter,
          },
        ]}
        className="mb-6"
      />

      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <DataTable
          data={filtered}
          columns={columns}
          getRowKey={(l) => l.id}
          pageSize={25}
        />
      </div>
    </div>
  );
}
