"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface TrendSeries {
  key: string;
  label: string;
  color: string;
}

export function TrendChart({
  data,
  series,
  height = 240,
  xKey = "date",
}: {
  data: Record<string, string | number | null>[];
  series: TrendSeries[];
  height?: number;
  xKey?: string;
}) {
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <defs>
            {series.map((s) => (
              <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity={0.18} />
                <stop offset="100%" stopColor={s.color} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>
          <CartesianGrid stroke="var(--line)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey={xKey}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            tickFormatter={(v: string) => new Date(v).toLocaleDateString("en", { month: "short", day: "numeric" })}
            minTickGap={24}
          />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: "var(--muted)", fontSize: 12 }} width={48} />
          <Tooltip
            contentStyle={{ borderRadius: 8, border: "1px solid var(--line)", fontSize: 12 }}
            labelFormatter={(v) => new Date(String(v)).toLocaleDateString("en", { dateStyle: "medium" })}
          />
          {series.map((s) => (
            <Area
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              fill={`url(#fill-${s.key})`}
              isAnimationActive={false}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
