"use client";

import { cn } from "@/lib/cn";

interface FilterBarProps {
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder?: string;
  filters?: {
    key: string;
    label: string;
    options: { value: string; label: string }[];
    value: string;
    onChange: (value: string) => void;
  }[];
  className?: string;
}

export function FilterBar({
  searchValue,
  onSearchChange,
  searchPlaceholder = "Search...",
  filters,
  className,
}: FilterBarProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-center",
        className,
      )}
    >
      <input
        type="text"
        value={searchValue}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={searchPlaceholder}
        className="rounded-md border border-gray-700 bg-gray-900 px-4 py-2 text-sm text-gray-200 placeholder-gray-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 sm:w-72"
      />

      {filters?.map((filter) => (
        <select
          key={filter.key}
          value={filter.value}
          onChange={(e) => filter.onChange(e.target.value)}
          className="rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-blue-500 focus:outline-none"
        >
          <option value="">{filter.label}</option>
          {filter.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
