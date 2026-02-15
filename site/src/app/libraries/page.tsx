import { getAllLibraries } from "@/lib/data";
import { LibrariesClient } from "./LibrariesClient";

export const metadata = {
  title: "Libraries - Argus Panoptes",
  description: "Browse Texas public library systems tracked by Argus Panoptes",
};

export default function LibrariesPage() {
  const libraries = getAllLibraries();
  return <LibrariesClient libraries={libraries} />;
}
