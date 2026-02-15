"use client";

import Link from "next/link";
import type { BookEntry } from "@/lib/types";
import { DataTable, type Column } from "@/components/ui/DataTable";

const columns: Column<BookEntry>[] = [
  {
    key: "title",
    header: "Title",
    sortable: true,
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
    render: (b) => (
      <span className="text-gray-400">
        {b.authors.join(", ") || "Unknown"}
      </span>
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

interface CategoryBooksClientProps {
  label: string;
  books: BookEntry[];
  isAudience: boolean;
}

export function CategoryBooksClient({
  label,
  books,
  isAudience,
}: CategoryBooksClientProps) {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/categories" className="hover:text-gray-300">
          Categories
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-300">{label}</span>
      </nav>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">{label}</h1>
        <p className="mt-1 text-gray-400">
          {books.length} books &middot;{" "}
          {isAudience ? "Audience level" : "Challenge topic"}
        </p>
      </div>

      <div className="rounded-lg border border-gray-800 bg-gray-900">
        <DataTable
          data={books}
          columns={columns}
          getRowKey={(b) => b.isbn13}
          pageSize={25}
        />
      </div>
    </div>
  );
}
