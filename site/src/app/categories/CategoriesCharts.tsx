"use client";

import { HorizontalBarChart } from "@/components/charts/HorizontalBarChart";

interface CategoriesChartsProps {
  data: { name: string; value: number }[];
}

export function CategoriesCharts({ data }: CategoriesChartsProps) {
  return (
    <HorizontalBarChart
      data={data}
      height={Math.max(300, data.length * 35)}
      color="#8b5cf6"
    />
  );
}
