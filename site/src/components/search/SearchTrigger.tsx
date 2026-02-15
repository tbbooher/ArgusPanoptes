"use client";

import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";

export function SearchTrigger() {
  return (
    <button
      onClick={() =>
        document.dispatchEvent(new CustomEvent("open-search-palette"))
      }
      className="flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-400 hover:border-gray-600 hover:text-gray-300 transition-colors"
    >
      <MagnifyingGlassIcon className="h-4 w-4" />
      <span className="hidden sm:inline">Search</span>
      <kbd className="hidden rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-xs font-mono text-gray-500 sm:inline">
        {"\u2318"}K
      </kbd>
    </button>
  );
}
