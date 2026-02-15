"use client";

import { DonutChart } from "@/components/charts/DonutChart";
import { HorizontalBarChart } from "@/components/charts/HorizontalBarChart";

interface DashboardChartsProps {
  foundNotFound: { name: string; value: number }[];
  topLibraries: { name: string; value: number }[];
  audienceData: { name: string; value: number }[];
  topicData: { name: string; value: number }[];
}

export function DashboardCharts({
  foundNotFound,
  topLibraries,
  audienceData,
  topicData,
}: DashboardChartsProps) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Found vs Not Found */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Books Found vs Not Found
        </h2>
        <DonutChart data={foundNotFound} height={280} />
      </div>

      {/* Audience Distribution */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Audience Distribution
        </h2>
        {audienceData.length > 0 ? (
          <DonutChart data={audienceData} height={280} />
        ) : (
          <p className="py-12 text-center text-gray-500">
            Run categorization to see audience distribution
          </p>
        )}
      </div>

      {/* Top Libraries */}
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 lg:col-span-2">
        <h2 className="mb-4 text-lg font-semibold text-white">
          Top 20 Libraries by Books Held
        </h2>
        <HorizontalBarChart
          data={topLibraries}
          height={Math.max(400, topLibraries.length * 28)}
          color="#3b82f6"
        />
      </div>

      {/* Top Topics */}
      {topicData.length > 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-6 lg:col-span-2">
          <h2 className="mb-4 text-lg font-semibold text-white">
            Top Challenge Topics
          </h2>
          <HorizontalBarChart
            data={topicData}
            height={Math.max(300, topicData.length * 35)}
            color="#8b5cf6"
          />
        </div>
      )}
    </div>
  );
}
