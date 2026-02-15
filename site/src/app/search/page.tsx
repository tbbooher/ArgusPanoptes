import type { Metadata } from "next";
import { SearchClient } from "./SearchClient";

export const metadata: Metadata = {
  title: "Search Libraries - Argus Panoptes",
  description:
    "Search for books across 260+ Texas public library systems by ISBN or title",
};

export default function SearchPage() {
  return <SearchClient />;
}
