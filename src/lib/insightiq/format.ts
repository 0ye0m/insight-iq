/** Formatting helpers shared across views */

export function fmtNumber(v: number | string | null | undefined, opts: Intl.NumberFormatOptions = {}): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isFinite(n)) return v;
    v = n;
  }
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v as number);
  if (abs >= 1_000_000) {
    return `${((v as number) / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 2 })}M`;
  }
  if (abs >= 10_000) {
    return `${((v as number) / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 })}k`;
  }
  return (v as number).toLocaleString(undefined, { maximumFractionDigits: 4, ...opts });
}

export function fmtKpiValue(kpi: { value: number | string | null; unit: string }): string {
  if (kpi.value === null || kpi.value === undefined) return '—';
  if (typeof kpi.value === 'string') return kpi.value;
  const n = kpi.value;
  if (kpi.unit === 'percent') return `${fmtNumber(n)}%`;
  if (kpi.unit === 'currency') return `$${fmtNumber(n)}`;
  return fmtNumber(n);
}

export function fmtBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
}

export function fileIconCategory(category: string): 'tabular' | 'document' | 'image' | 'video' | 'unknown' {
  switch (category) {
    case 'TABULAR': return 'tabular';
    case 'DOCUMENT': return 'document';
    case 'IMAGE': return 'image';
    case 'VIDEO': return 'video';
    default: return 'unknown';
  }
}

export function severityColor(severity: string): string {
  if (severity === 'high') return 'text-destructive';
  if (severity === 'medium') return 'text-warning';
  return 'text-muted-foreground';
}

export const CHART_COLORS = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-3)',
  'var(--chart-4)',
  'var(--chart-5)',
];
