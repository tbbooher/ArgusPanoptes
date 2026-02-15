import Link from "next/link";
import { getCategories } from "@/lib/data";
import { CategoriesCharts } from "./CategoriesCharts";

export const metadata = {
  title: "Categories - Argus Panoptes",
  description: "Book challenge categories and topic distribution",
};

export default function CategoriesPage() {
  const categories = getCategories();
  const audienceCategories = categories.filter((c) => c.type === "audience");
  const topicCategories = categories.filter((c) => c.type === "topic");

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Categories</h1>
        <p className="mt-1 text-gray-400">
          Classification of challenged books by audience and topic
        </p>
      </div>

      {/* Audience section */}
      <section className="mb-10">
        <h2 className="mb-4 text-xl font-semibold text-white">
          By Audience Level
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {audienceCategories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/categories/${cat.slug}`}
              className="rounded-lg border border-gray-800 bg-gray-900 p-5 hover:border-gray-700 transition-colors"
            >
              <p className="text-sm text-gray-400">{cat.label}</p>
              <p className="mt-2 text-2xl font-bold font-mono text-white">
                {cat.count}
              </p>
              <p className="text-xs text-gray-500">books</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Topic section */}
      <section className="mb-10">
        <h2 className="mb-4 text-xl font-semibold text-white">
          By Challenge Topic
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topicCategories.map((cat) => (
            <Link
              key={cat.slug}
              href={`/categories/${cat.slug}`}
              className="rounded-lg border border-gray-800 bg-gray-900 p-5 hover:border-gray-700 transition-colors"
            >
              <p className="text-sm text-gray-400">{cat.label}</p>
              <p className="mt-2 text-2xl font-bold font-mono text-white">
                {cat.count}
              </p>
              <p className="text-xs text-gray-500">books</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Chart */}
      {topicCategories.length > 0 && (
        <section>
          <h2 className="mb-4 text-xl font-semibold text-white">
            Topic Distribution
          </h2>
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
            <CategoriesCharts
              data={topicCategories.map((c) => ({
                name: c.label,
                value: c.count,
              }))}
            />
          </div>
        </section>
      )}
    </div>
  );
}
