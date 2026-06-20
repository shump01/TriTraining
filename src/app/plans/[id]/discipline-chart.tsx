"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface ChartPoint {
  week: string; // YYYY-MM-DD
  target: number;
}

export function DisciplineChart({
  data,
  cap,
  startingVolume,
}: {
  data: ChartPoint[];
  cap: number;
  startingVolume: number;
}) {
  return (
    <div style={{ width: "100%", height: 280 }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="week" tick={{ fontSize: 11 }} minTickGap={24} />
          <YAxis
            tick={{ fontSize: 11 }}
            width={72}
            tickFormatter={(v: number) => v.toLocaleString()}
          />
          <Tooltip formatter={(value) => [`${Number(value).toLocaleString()} m`, "Target"]} />

          {/* 3.5× hard cap */}
          <ReferenceLine
            y={cap}
            stroke="#b00020"
            strokeDasharray="6 4"
            label={{ value: "3.5× cap", position: "insideTopRight", fontSize: 11, fill: "#b00020" }}
          />
          {/* Starting weekly volume */}
          <ReferenceLine
            y={startingVolume}
            stroke="#0a7d28"
            strokeDasharray="2 4"
            label={{ value: "start", position: "insideBottomRight", fontSize: 11, fill: "#0a7d28" }}
          />

          <Line
            type="monotone"
            dataKey="target"
            stroke="#1f6feb"
            strokeWidth={2}
            dot={{ r: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
