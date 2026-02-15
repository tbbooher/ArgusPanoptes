"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts";

const COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444",
  "#8b5cf6", "#ec4899", "#14b8a6", "#f97316",
];

interface DonutChartProps {
  data: { name: string; value: number }[];
  className?: string;
  height?: number;
}

export function DonutChart({ data, className, height = 300 }: DonutChartProps) {
  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={60}
            outerRadius={100}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((_, index) => (
              <Cell
                key={`cell-${index}`}
                fill={COLORS[index % COLORS.length]}
              />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "0.5rem",
              color: "#e5e7eb",
            }}
          />
          <Legend
            wrapperStyle={{ fontSize: "12px", color: "#9ca3af" }}
          />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
