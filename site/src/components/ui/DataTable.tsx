"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/cn";

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  className?: string;
  render: (item: T) => React.ReactNode;
  sortValue?: (item: T) => string | number;
}

interface DataTableProps<T> {
  data: T[];
  columns: Column<T>[];
  pageSize?: number;
  className?: string;
  getRowKey: (item: T) => string;
}

export function DataTable<T>({
  data,
  columns,
  pageSize = 25,
  className,
  getRowKey,
}: DataTableProps<T>) {
  const [page, setPage] = useState(0);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return data;

    return [...data].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      const cmp = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, columns]);

  const totalPages = Math.ceil(sorted.length / pageSize);
  const pageData = sorted.slice(page * pageSize, (page + 1) * pageSize);

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
    setPage(0);
  }

  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-4 py-3 text-left font-medium text-gray-400",
                  col.sortable && "cursor-pointer select-none hover:text-gray-200",
                  col.className,
                )}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <span className="flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === col.key && (
                    <span className="text-xs">
                      {sortDir === "asc" ? "\u25B2" : "\u25BC"}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pageData.map((item) => (
            <tr
              key={getRowKey(item)}
              className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors"
            >
              {columns.map((col) => (
                <td key={col.key} className={cn("px-4 py-3", col.className)}>
                  {col.render(item)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-800 px-4 py-3">
          <p className="text-sm text-gray-500">
            Showing {page * pageSize + 1}-
            {Math.min((page + 1) * pageSize, sorted.length)} of{" "}
            {sorted.length}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-md border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Previous
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-md border border-gray-700 px-3 py-1 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
