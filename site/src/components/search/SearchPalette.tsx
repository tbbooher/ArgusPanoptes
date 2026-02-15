"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import Fuse from "fuse.js";
import { MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import {
  BookOpenIcon,
  BuildingLibraryIcon,
  TagIcon,
} from "@heroicons/react/24/outline";
import { AUDIENCE_LABELS, TOPIC_LABELS } from "@/lib/types";

interface SearchItem {
  type: "book" | "library" | "category";
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

let searchIndex: Fuse<SearchItem> | null = null;
let searchItems: SearchItem[] = [];

async function loadSearchData(): Promise<Fuse<SearchItem>> {
  if (searchIndex) return searchIndex;

  const [booksRes, librariesRes, categoriesRes] = await Promise.all([
    fetch("/data/books.json"),
    fetch("/data/libraries.json"),
    fetch("/data/categories.json"),
  ]);

  const books = await booksRes.json();
  const libraries = await librariesRes.json();
  const categories = await categoriesRes.json();

  searchItems = [
    ...books.map((b: any) => ({
      type: "book" as const,
      id: b.isbn13,
      title: b.title,
      subtitle: b.authors?.join(", ") || "Unknown author",
      href: `/books/${b.isbn13}`,
    })),
    ...libraries.map((l: any) => ({
      type: "library" as const,
      id: l.id,
      title: l.name,
      subtitle: [l.city, l.region].filter(Boolean).join(", "),
      href: `/libraries/${l.id}`,
    })),
    ...categories.map((c: any) => ({
      type: "category" as const,
      id: c.slug,
      title: c.label,
      subtitle: `${c.count} books`,
      href: `/categories/${c.slug}`,
    })),
  ];

  searchIndex = new Fuse(searchItems, {
    keys: ["title", "subtitle"],
    threshold: 0.3,
    minMatchCharLength: 2,
  });

  return searchIndex;
}

const typeIcons = {
  book: BookOpenIcon,
  library: BuildingLibraryIcon,
  category: TagIcon,
};

export function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchItem[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Open/close handlers
  const openPalette = useCallback(() => {
    setOpen(true);
    setQuery("");
    setResults([]);
    setSelected(0);
  }, []);

  const closePalette = useCallback(() => {
    setOpen(false);
    setQuery("");
    setResults([]);
  }, []);

  // Listen for Cmd+K and custom event
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        openPalette();
      }
      if (e.key === "Escape") {
        closePalette();
      }
    }

    function handleCustomOpen() {
      openPalette();
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("open-search-palette", handleCustomOpen);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("open-search-palette", handleCustomOpen);
    };
  }, [openPalette, closePalette]);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Search
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults([]);
      setSelected(0);
      return;
    }

    loadSearchData().then((fuse) => {
      const fuseResults = fuse.search(query, { limit: 12 });
      setResults(fuseResults.map((r) => r.item));
      setSelected(0);
    });
  }, [query]);

  function navigate(item: SearchItem) {
    closePalette();
    router.push(item.href);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && results[selected]) {
      e.preventDefault();
      navigate(results[selected]);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[20vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={closePalette}
      />

      {/* Palette */}
      <div className="relative w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 shadow-2xl">
        {/* Input */}
        <div className="flex items-center gap-3 border-b border-gray-800 px-4 py-3">
          <MagnifyingGlassIcon className="h-5 w-5 text-gray-500" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search books, libraries, categories..."
            className="flex-1 bg-transparent text-gray-200 placeholder-gray-500 outline-none"
          />
          <kbd className="rounded border border-gray-700 bg-gray-800 px-1.5 py-0.5 text-xs font-mono text-gray-500">
            ESC
          </kbd>
        </div>

        {/* Results */}
        {results.length > 0 && (
          <ul className="max-h-[300px] overflow-y-auto p-2">
            {results.map((item, i) => {
              const Icon = typeIcons[item.type];
              return (
                <li key={`${item.type}-${item.id}`}>
                  <button
                    onClick={() => navigate(item)}
                    onMouseEnter={() => setSelected(i)}
                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                      i === selected
                        ? "bg-gray-800 text-white"
                        : "text-gray-400 hover:bg-gray-800/50"
                    }`}
                  >
                    <Icon className="h-5 w-5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.title}
                      </p>
                      <p className="truncate text-xs text-gray-500">
                        {item.subtitle}
                      </p>
                    </div>
                    <span className="flex-shrink-0 text-xs text-gray-600 capitalize">
                      {item.type}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {query.length >= 2 && results.length === 0 && (
          <div className="p-8 text-center text-sm text-gray-500">
            No results found
          </div>
        )}
      </div>
    </div>
  );
}
