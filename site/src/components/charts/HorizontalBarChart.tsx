"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

interface HorizontalBarChartProps {
  data: { name: string; value: number }[];
  color?: string;
  className?: string;
  height?: number;
}

export function HorizontalBarChart({
  data,
  color = "#3b82f6",
  className,
  height = 400,
}: HorizontalBarChartProps) {
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis type="number" stroke="#9ca3af" fontSize={12} />
          <YAxis
            dataKey="name"
            type="category"
            width={180}
            stroke="#9ca3af"
            fontSize={11}
            tick={{ fill: "#9ca3af" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "0.5rem",
              color: "#e5e7eb",
            }}
          />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
