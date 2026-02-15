import { getSummaryStats, getAllBooks, getAllLibraries, getCategories } from "@/lib/data";
import { StatCard } from "@/components/ui/StatCard";
import { AUDIENCE_LABELS } from "@/lib/types";
import { DashboardCharts } from "./DashboardCharts";

export default function DashboardPage() {
  const stats = getSummaryStats();
  const books = getAllBooks();
  const libraries = getAllLibraries();
  const categories = getCategories();

  const foundRate = stats.booksScanned > 0
    ? ((stats.booksFound / stats.booksScanned) * 100).toFixed(1)
    : "0";

  // Top 20 libraries by books held
  const topLibraries = libraries
    .filter((l) => l.booksHeld > 0)
    .sort((a, b) => b.booksHeld - a.booksHeld)
    .slice(0, 20)
    .map((l) => ({ name: l.name, value: l.booksHeld }));

  // Audience distribution
  const audienceCounts = new Map<string, number>();
  for (const b of books) {
    if (b.audience) {
      audienceCounts.set(b.audience, (audienceCounts.get(b.audience) ?? 0) + 1);
    }
  }
  const audienceData = Array.from(audienceCounts.entries()).map(
    ([key, count]) => ({
      name: AUDIENCE_LABELS[key] ?? key,
      value: count,
    }),
  );

  // Found vs Not Found
  const foundNotFound = [
    { name: "Found", value: stats.booksFound },
    { name: "Not Found", value: stats.booksNotFound },
  ];

  // Top topics
  const topicCategories = categories
    .filter((c) => c.type === "topic")
    .slice(0, 10)
    .map((c) => ({ name: c.label, value: c.count }));

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white">
          Texas Library Holdings Dashboard
        </h1>
        <p className="mt-2 text-gray-400">
          Tracking {stats.booksScanned.toLocaleString()} challenged books across{" "}
          {stats.systemCount.toLocaleString()} library systems
        </p>
      </div>

      {/* Stat cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Books Scanned"
          value={stats.booksScanned}
        />
        <StatCard
          label="Books Found"
          value={stats.booksFound}
          subtitle={`${foundRate}% found rate`}
        />
        <StatCard
          label="Total Holdings"
          value={stats.holdingsCount}
          subtitle="Book-library combinations"
        />
        <StatCard
          label="Library Systems"
          value={stats.systemCount}
          subtitle="With at least one holding"
        />
      </div>

      {/* Charts */}
      <DashboardCharts
        foundNotFound={foundNotFound}
        topLibraries={topLibraries}
        audienceData={audienceData}
        topicData={topicCategories}
      />
    </div>
  );
}
