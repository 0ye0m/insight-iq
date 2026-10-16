'use client';

import * as React from 'react';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import type { ChartResult } from '@/lib/insightiq/types';
import { CHART_COLORS, fmtNumber } from '@/lib/insightiq/format';

const AXIS_STYLE = { fontSize: 11, fill: 'var(--muted-foreground)' } as const;

function tooltipStyle() {
  return {
    contentStyle: {
      background: 'var(--popover)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      fontSize: 12,
      color: 'var(--popover-foreground)',
    },
    labelStyle: { color: 'var(--muted-foreground)', fontSize: 11 },
  };
}

/** Box plot renderer (min-q1-median-q3-max strips) — no recharts box primitive */
function BoxStrip({ data }: { data: Record<string, unknown>[] }) {
  const rows = data.map((d) => ({
    group: String(d.group ?? ''),
    min: Number(d.min), q1: Number(d.q1), median: Number(d.median), q3: Number(d.q3), max: Number(d.max), count: Number(d.count ?? 0),
  })).filter((r) => Number.isFinite(r.min));
  if (rows.length === 0) return <p className="py-8 text-center text-xs text-muted-foreground">No numeric data.</p>;
  const lo = Math.min(...rows.map((r) => r.min));
  const hi = Math.max(...rows.map((r) => r.max));
  const span = hi - lo || 1;
  const pct = (v: number) => `${((v - lo) / span) * 100}%`;
  return (
    <div className="space-y-3 py-2">
      {rows.map((r) => (
        <div key={r.group}>
          <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{r.group}</span>
            <span>min {fmtNumber(r.min)} · q1 {fmtNumber(r.q1)} · med {fmtNumber(r.median)} · q3 {fmtNumber(r.q3)} · max {fmtNumber(r.max)} (n={r.count})</span>
          </div>
          <div className="relative h-3 rounded-full bg-muted">
            <div
              className="absolute h-3 rounded-md bg-primary/60"
              style={{ left: pct(r.q1), width: `calc(${((r.q3 - r.q1) / span) * 100}% )`, minWidth: 4 }}
              title={`IQR ${fmtNumber(r.q1)} – ${fmtNumber(r.q3)}`}
            />
            <div className="absolute -top-0.5 h-4 w-0.5 rounded bg-primary" style={{ left: pct(r.median) }} title={`median ${fmtNumber(r.median)}`} />
            <div className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-border" style={{ left: pct(r.min), width: `calc(${((r.min - lo) / span) * 100}%)` }} />
            <div className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-border" style={{ left: pct(r.q3), width: `calc(${((r.max - r.q3) / span) * 100}%)` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ChartRenderer({ chart }: { chart: ChartResult }) {
  const result = chart.result;
  if (!result || !result.data || result.data.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">{chart.error || 'No plottable data for this chart.'}</p>;
  }
  const data = result.data;
  const seriesKeys = result.seriesKeys || null;
  const tt = tooltipStyle();

  if (chart.type === 'box') {
    return <BoxStrip data={data} />;
  }

  if (chart.type === 'pie' || chart.type === 'donut') {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius={chart.type === 'donut' ? 58 : 0}
            outerRadius={95}
            paddingAngle={2}
            stroke="var(--card)"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip {...tt} formatter={(v: number | string, n) => [fmtNumber(Number(v)), String(n)]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === 'scatter') {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <ScatterChart margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="x" type="number" name={result.xLabel} tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: 'var(--border)' }} tickFormatter={(v) => fmtNumber(Number(v))} />
          <YAxis dataKey="y" type="number" name={result.yLabel} tick={AXIS_STYLE} tickLine={false} axisLine={false} width={52} tickFormatter={(v) => fmtNumber(Number(v))} />
          <Tooltip {...tt} cursor={{ strokeDasharray: '3 3' }} />
          {result.correlation != null && (
            <text x="50%" y={12} textAnchor="middle" fill="var(--muted-foreground)" fontSize={11}>
              r = {result.correlation} (association, not causation)
            </text>
          )}
          <Scatter data={data} fill="var(--chart-1)" fillOpacity={0.75} />
        </ScatterChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === 'histogram') {
    return (
      <ResponsiveContainer width="100%" height={260}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="binStart"
            tick={AXIS_STYLE}
            tickLine={false}
            axisLine={{ stroke: 'var(--border)' }}
            tickFormatter={(v, i) => fmtNumber(Number(v))}
            interval="preserveStartEnd"
          />
          <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={40} allowDecimals={false} />
          <Tooltip
            {...tt}
            cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
            formatter={(v: number | string) => [`${v}`, 'count']}
            labelFormatter={(v, payload) => {
              const p = payload?.[0]?.payload as { binStart: number; binEnd: number } | undefined;
              return p ? `${fmtNumber(p.binStart)} – ${fmtNumber(p.binEnd)}` : String(v);
            }}
          />
          <Bar dataKey="count" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  }

  if (chart.type === 'bar' || chart.type === 'stacked_bar') {
    const stacked = chart.type === 'stacked_bar' && seriesKeys;
    return (
      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }} {...(stacked ? { barCategoryGap: '20%' } : {})}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="x" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval={0} angle={data.length > 7 ? -20 : 0} textAnchor={data.length > 7 ? 'end' : 'middle'} height={data.length > 7 ? 52 : 30} tickFormatter={(v) => (String(v).length > 14 ? `${String(v).slice(0, 13)}…` : v)} />
          <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => fmtNumber(Number(v))} />
          <Tooltip {...tt} cursor={{ fill: 'var(--muted)', opacity: 0.4 }} formatter={(v: number | string, n) => [fmtNumber(Number(v)), String(n)]} />
          {seriesKeys && seriesKeys.length > 1 ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
          {(seriesKeys && seriesKeys.length > 1 ? seriesKeys : ['y']).map((key, i) => (
            <Bar
              key={key}
              dataKey={key}
              name={seriesKeys && seriesKeys.length > 1 ? key : result.yLabel}
              stackId={stacked ? 'a' : undefined}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              radius={stacked ? undefined : [4, 4, 0, 0]}
              maxBarSize={44}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    );
  }

  // line / area (with optional series)
  const ChartWrap = chart.type === 'area' ? AreaChart : LineChart;
  const SeriesEl = chart.type === 'area' ? Area : Line;
  const keys = seriesKeys && seriesKeys.length > 0 ? seriesKeys : ['y'];
  const multiple = keys.length > 1;
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ChartWrap data={data} margin={{ top: 8, right: 12, bottom: 4, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="x" tick={AXIS_STYLE} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval="preserveStartEnd" tickFormatter={(v) => (String(v).length > 12 ? `${String(v).slice(0, 11)}…` : v)} />
        <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={56} tickFormatter={(v) => fmtNumber(Number(v))} />
        <Tooltip {...tt} formatter={(v: number | string, n) => [fmtNumber(Number(v)), String(n)]} />
        {multiple ? <Legend wrapperStyle={{ fontSize: 11 }} /> : null}
        {keys.map((key, i) => (
          <SeriesEl
            key={key}
            type="monotone"
            dataKey={key}
            name={multiple ? key : result.yLabel}
            stroke={CHART_COLORS[i % CHART_COLORS.length]}
            fill={chart.type === 'area' ? CHART_COLORS[i % CHART_COLORS.length] : undefined}
            fillOpacity={chart.type === 'area' ? 0.18 : undefined}
            strokeWidth={2}
            dot={data.length <= 24 ? { r: 2.5, fill: CHART_COLORS[i % CHART_COLORS.length] } : false}
            activeDot={{ r: 4 }}
            connectNulls
          />
        ))}
      </ChartWrap>
    </ResponsiveContainer>
  );
}
