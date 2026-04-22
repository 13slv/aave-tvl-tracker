"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine,
  CartesianGrid,
} from "recharts";
import type { Row, Metric } from "@/lib/tvl";

const COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
  "#f97316",
];

function fmtAxis(v: number): string {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(0)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

type Props = {
  rows: Row[];
  metric: Metric;
  dates: string[];
  hackDateIndex: number;
  totals: number[];
  topN?: number;
};

export default function TvlChart({
  rows,
  metric,
  dates,
  hackDateIndex,
  totals,
  topN = 5,
}: Props) {
  const top = rows.slice(0, topN);
  const chartData = dates.map((date, i) => {
    const point: Record<string, string | number> = {
      date,
      TOTAL: totals[i] ?? 0,
    };
    for (const row of top) {
      point[row.name] = row[metric][i] ?? 0;
    }
    return point;
  });

  return (
    <div className="w-full h-[360px]">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 10, right: 20, left: 10, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" opacity={0.3} />
          <XAxis dataKey="date" stroke="#71717a" fontSize={12} />
          <YAxis
            tickFormatter={fmtAxis}
            stroke="#71717a"
            fontSize={12}
            width={60}
          />
          <Tooltip
            formatter={(val) => fmtAxis(typeof val === "number" ? val : Number(val))}
            contentStyle={{
              background: "rgba(24,24,27,0.95)",
              border: "1px solid #3f3f46",
              borderRadius: 6,
              color: "#fafafa",
              fontSize: 12,
            }}
            labelStyle={{ color: "#fafafa" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {hackDateIndex >= 0 && (
            <ReferenceLine
              x={dates[hackDateIndex]}
              stroke="#f59e0b"
              strokeDasharray="4 4"
              label={{
                value: "Hack",
                position: "top",
                fill: "#f59e0b",
                fontSize: 11,
              }}
            />
          )}
          <Line
            type="monotone"
            dataKey="TOTAL"
            stroke="#18181b"
            strokeWidth={2.5}
            dot={false}
          />
          {top.map((row, idx) => (
            <Line
              key={row.name}
              type="monotone"
              dataKey={row.name}
              stroke={COLORS[idx % COLORS.length]}
              strokeWidth={1.5}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
