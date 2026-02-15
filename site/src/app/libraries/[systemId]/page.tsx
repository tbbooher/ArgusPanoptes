import { notFound } from "next/navigation";
import Link from "next/link";
import { getAllLibraries, getLibrary } from "@/lib/data";
import { StatCard } from "@/components/ui/StatCard";
import { Badge } from "@/components/ui/Badge";
import { LibraryMap } from "./LibraryMap";

export async function generateStaticParams() {
  const libraries = getAllLibraries();
  return libraries.map((l) => ({ systemId: l.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = await params;
  const library = getLibrary(systemId);
  return {
    title: library ? `${library.name} - Argus Panoptes` : "Library Not Found",
  };
}

export default async function LibraryDetailPage({
  params,
}: {
  params: Promise<{ systemId: string }>;
}) {
  const { systemId } = await params;
  const library = getLibrary(systemId);
  if (!library) notFound();

  const marker =
    library.lat !== null && library.lng !== null
      ? {
          id: library.id,
          name: library.name,
          lat: library.lat,
          lng: library.lng,
          city: library.city,
        }
      : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/libraries" className="hover:text-gray-300">
          Libraries
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-300">{library.name}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">{library.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-gray-400">
          {library.city && <span>{library.city}</span>}
          <span>{library.region}</span>
          <Badge>{library.vendor}</Badge>
          {library.protocol && <Badge variant="blue">{library.protocol}</Badge>}
        </div>
      </div>

      {/* Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Books Held" value={library.booksHeld} />
        <StatCard label="Total Copies" value={library.totalCopies} />
        <StatCard label="Available" value={library.totalAvailable} />
        <StatCard
          label="Status"
          value={library.enabled ? "Active" : "Disabled"}
        />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Map */}
        {marker && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-3 text-lg font-semibold text-white">Location</h2>
            <LibraryMap marker={marker} />
          </div>
        )}

        {/* Book list */}
        <div
          className={`rounded-lg border border-gray-800 bg-gray-900 p-4 ${
            !marker ? "lg:col-span-2" : ""
          }`}
        >
          <h2 className="mb-3 text-lg font-semibold text-white">
            Books Held ({library.books.length})
          </h2>
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-3 py-2 text-left text-gray-400">Title</th>
                  <th className="px-3 py-2 text-right text-gray-400">
                    Copies
                  </th>
                  <th className="px-3 py-2 text-right text-gray-400">
                    Available
                  </th>
                </tr>
              </thead>
              <tbody>
                {library.books.map((b) => (
                  <tr
                    key={b.isbn13}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/books/${b.isbn13}`}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        {b.title}
                      </Link>
                      <span className="ml-2 text-xs text-gray-500">
                        {b.authors.join(", ")}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-300">
                      {b.copies}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-300">
                      {b.available}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
