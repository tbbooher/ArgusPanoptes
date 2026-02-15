import { notFound } from "next/navigation";
import Link from "next/link";
import { getAllBooks, getBook } from "@/lib/data";
import { AUDIENCE_LABELS, TOPIC_LABELS } from "@/lib/types";
import { AudienceBadge, TopicBadge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { BookMap } from "./BookMap";

export async function generateStaticParams() {
  const books = getAllBooks();
  return books.map((b) => ({ isbn13: b.isbn13 }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ isbn13: string }>;
}) {
  const { isbn13 } = await params;
  const book = getBook(isbn13);
  return {
    title: book ? `${book.title} - Argus Panoptes` : "Book Not Found",
  };
}

export default async function BookDetailPage({
  params,
}: {
  params: Promise<{ isbn13: string }>;
}) {
  const { isbn13 } = await params;
  const book = getBook(isbn13);
  if (!book) notFound();

  const audienceLabel = book.audience
    ? AUDIENCE_LABELS[book.audience] ?? book.audience
    : null;

  const markers = book.libraries
    .filter((l) => l.lat !== null && l.lng !== null)
    .map((l) => ({
      id: l.systemId,
      name: l.systemName,
      lat: l.lat!,
      lng: l.lng!,
      city: l.city,
      copies: l.copies,
    }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-6 text-sm text-gray-500">
        <Link href="/books" className="hover:text-gray-300">
          Books
        </Link>
        <span className="mx-2">/</span>
        <span className="text-gray-300">{book.title}</span>
      </nav>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">{book.title}</h1>
        <p className="mt-2 text-lg text-gray-400">
          {book.authors.join(", ") || "Unknown author"}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {audienceLabel && (
            <AudienceBadge audience={book.audience!} label={audienceLabel} />
          )}
          {book.topics.map((t) => (
            <TopicBadge key={t} label={TOPIC_LABELS[t] ?? t} />
          ))}
        </div>
      </div>

      {/* Stats */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="ISBN-13" value={book.isbn13} />
        <StatCard label="Libraries" value={book.systemCount} />
        <StatCard label="Total Copies" value={book.totalCopies} />
        <StatCard label="Available" value={book.totalAvailable} />
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Map */}
        {markers.length > 0 && (
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <h2 className="mb-3 text-lg font-semibold text-white">
              Library Locations
            </h2>
            <BookMap markers={markers} />
          </div>
        )}

        {/* Holding libraries */}
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
          <h2 className="mb-3 text-lg font-semibold text-white">
            Holding Libraries ({book.libraries.length})
          </h2>
          <div className="max-h-[400px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="px-3 py-2 text-left text-gray-400">
                    Library
                  </th>
                  <th className="px-3 py-2 text-right text-gray-400">
                    Copies
                  </th>
                  <th className="px-3 py-2 text-right text-gray-400">
                    Available
                  </th>
                </tr>
              </thead>
              <tbody>
                {book.libraries.map((l) => (
                  <tr
                    key={l.systemId}
                    className="border-b border-gray-800/50 hover:bg-gray-800/30"
                  >
                    <td className="px-3 py-2">
                      <Link
                        href={`/libraries/${l.systemId}`}
                        className="text-blue-400 hover:text-blue-300"
                      >
                        {l.systemName}
                      </Link>
                      {l.city && (
                        <span className="ml-2 text-xs text-gray-500">
                          {l.city}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-300">
                      {l.copies}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-300">
                      {l.available}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Metadata */}
      <div className="mt-8 rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">Details</h2>
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {book.year && (
            <div>
              <dt className="text-sm text-gray-500">Year</dt>
              <dd className="text-gray-200">{book.year}</dd>
            </div>
          )}
          {book.publisher && (
            <div>
              <dt className="text-sm text-gray-500">Publisher</dt>
              <dd className="text-gray-200">{book.publisher}</dd>
            </div>
          )}
          {book.confidence !== null && (
            <div>
              <dt className="text-sm text-gray-500">Classification Confidence</dt>
              <dd className="font-mono text-gray-200">
                {(book.confidence * 100).toFixed(0)}%
              </dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}
