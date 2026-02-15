"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "./ThemeToggle";
import { SearchTrigger } from "../search/SearchTrigger";

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/search", label: "Search" },
  { href: "/books", label: "Books" },
  { href: "/libraries", label: "Libraries" },
  { href: "/map", label: "Map" },
  { href: "/categories", label: "Categories" },
  { href: "/about", label: "About" },
];

export function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-gray-800 bg-gray-950/80 backdrop-blur-sm dark:border-gray-800 dark:bg-gray-950/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-lg font-bold text-white">Argus Panoptes</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/"
                  ? pathname === "/"
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-gray-800 text-white"
                      : "text-gray-400 hover:bg-gray-800/50 hover:text-gray-200",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <SearchTrigger />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
