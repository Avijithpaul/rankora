"use client";

import { Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const fmtDay = (v: string) => new Date(v).toLocaleDateString("en", { month: "short", day: "numeric" });

/** Position history: 1 is at the top; gaps mean "not ranking in the top 100". */
export function PositionChart({ data, height = 260 }: { data: { date: string; position: number | null }[]; height?: number }) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={fmtDay} minTickGap={24} />
          <YAxis reversed domain={[1, "dataMax"]} allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} width={44} />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", fontSize: 12 }}
            labelFormatter={(v) => new Date(String(v)).toLocaleDateString("en", { dateStyle: "medium" })}
            formatter={(v) => [v === null || v === undefined ? "Not in top 100" : `#${v}`, "Position"]}
          />
          <Line type="monotone" dataKey="position" stroke="var(--chart-1)" strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface DistributionPoint {
  date: string;
  top3: number;
  top10: number;
  top20: number;
  top100: number;
}

/** Stacked count of tracked keywords per position bucket per day. */
export function DistributionChart({ data, height = 240 }: { data: DistributionPoint[]; height?: number }) {
  const series = [
    { key: "top3", label: "Top 3", color: "var(--chart-2)" },
    { key: "top10", label: "4–10", color: "var(--chart-1)" },
    { key: "top20", label: "11–20", color: "var(--chart-4)" },
    { key: "top100", label: "21–100", color: "var(--chart-3)" },
  ];
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} tickFormatter={fmtDay} minTickGap={24} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} width={44} />
          <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", fontSize: 12 }} labelFormatter={(v) => new Date(String(v)).toLocaleDateString("en", { dateStyle: "medium" })} />
          <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          {series.map((s) => (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stackId="1" stroke={s.color} fill={s.color} fillOpacity={0.35} isAnimationActive={false} />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
