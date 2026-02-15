"use client";

import { useRef, useState, useEffect } from "react";
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

function getYAxisConfig(width: number) {
  if (width < 480) return { width: 100, fontSize: 10, marginRight: 20, marginLeft: 10 };
  if (width < 768) return { width: 140, fontSize: 11, marginRight: 25, marginLeft: 15 };
  return { width: 180, fontSize: 11, marginRight: 30, marginLeft: 20 };
}

export function HorizontalBarChart({
  data,
  color = "#3b82f6",
  className,
  height = 400,
}: HorizontalBarChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(768);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    setContainerWidth(el.clientWidth);

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const yAxis = getYAxisConfig(containerWidth);

  return (
    <div ref={containerRef} className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 5, right: yAxis.marginRight, left: yAxis.marginLeft, bottom: 5 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis type="number" stroke="#9ca3af" fontSize={12} />
          <YAxis
            dataKey="name"
            type="category"
            width={yAxis.width}
            stroke="#9ca3af"
            fontSize={yAxis.fontSize}
            tick={{ fill: "#9ca3af" }}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1f2937",
              border: "1px solid #374151",
              borderRadius: "0.5rem",
            }}
            itemStyle={{ color: "#f3f4f6" }}
            labelStyle={{ color: "#f3f4f6" }}
          />
          <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
