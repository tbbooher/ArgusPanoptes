"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import type { BookEntry } from "@/lib/types";
import { AUDIENCE_LABELS, TOPIC_LABELS } from "@/lib/types";
import { FilterBar } from "@/components/ui/FilterBar";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { AudienceBadge, TopicBadge } from "@/components/ui/Badge";

const AUDIENCE_OPTIONS = Object.entries(AUDIENCE_LABELS).map(([value, label]) => ({
  value,
  label,
}));

const columns: Column<BookEntry>[] = [
  {
    key: "title",
    header: "Title",
    sortable: true,
    className: "max-w-xs",
    sortValue: (b) => b.title,
    render: (b) => (
      <Link
        href={`/books/${b.isbn13}`}
        className="font-medium text-blue-400 hover:text-blue-300"
      >
        {b.title}
      </Link>
    ),
  },
  {
    key: "authors",
    header: "Authors",
    className: "max-w-[200px]",
    render: (b) => (
      <span className="text-gray-400">
        {b.authors.join(", ") || "Unknown"}
      </span>
    ),
  },
  {
    key: "audience",
    header: "Audience",
    sortable: true,
    sortValue: (b) => b.audience ?? "",
    render: (b) =>
      b.audience ? (
        <AudienceBadge
          audience={b.audience}
          label={AUDIENCE_LABELS[b.audience] ?? b.audience}
        />
      ) : (
        <span className="text-gray-600">-</span>
      ),
  },
  {
    key: "topics",
    header: "Topics",
    className: "max-w-[250px]",
    render: (b) => (
      <div className="flex flex-wrap gap-1">
        {b.topics.map((t) => (
          <TopicBadge key={t} label={TOPIC_LABELS[t] ?? t} />
        ))}
      </div>
    ),
  },
  {
    key: "systemCount",
    header: "Libraries",
    sortable: true,
    className: "text-right",
    sortValue: (b) => b.systemCount,
    render: (b) => (
      <span className="font-mono text-gray-300">{b.systemCount}</span>
    ),
  },
  {
    key: "totalCopies",
    header: "Copies",
    sortable: true,
    className: "text-right",
    sortValue: (b) => b.totalCopies,
    render: (b) => (
      <span className="font-mono text-gray-300">{b.totalCopies}</span>
    ),
  },
];

export function BooksClient({ books }: { books: BookEntry[] }) {
  const [search, setSearch] = useState("");
  const [audienceFilter, setAudienceFilter] = useState("");

  const filtered = useMemo(() => {
    let result = books;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.authors.some((a) => a.toLowerCase().includes(q)) ||
          b.isbn13.includes(q),
      );
    }
    if (audienceFilter) {
      result = result.filter((b) => b.audience === audienceFilter);
    }
    return result;
  }, [books, search, audienceFilter]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Books</h1>
        <p className="mt-1 text-gray-400">
          {books.length.toLocaleString()} challenged books tracked
        </p>
      </div>

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by title, author, or ISBN..."
        filters={[
          {
            key: "audience",
            label: "All audiences",
            options: AUDIENCE_OPTIONS,
            value: audienceFilter,
            onChange: setAudienceFilter,
          },
        ]}
        className="mb-6"
      />

      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <DataTable
          data={filtered}
          columns={columns}
          getRowKey={(b) => b.isbn13}
          pageSize={25}
        />
      </div>
    </div>
  );
}
