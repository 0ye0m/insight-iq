'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { fmtKpiValue } from '@/lib/insightiq/format';
import { AlertTriangle, Info, Loader2 } from 'lucide-react';

export function SectionTitle({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <span className="kicker">{children}</span>
      {right}
    </div>
  );
}

export function StatusDot({ tone = 'green', pulse = false }: { tone?: 'green' | 'orange' | 'red' | 'gray'; pulse?: boolean }) {
  const cls =
    tone === 'green' ? 'bg-emerald-500' : tone === 'orange' ? 'bg-orange-500' : tone === 'red' ? 'bg-red-500' : 'bg-zinc-400';
  return <span className={`inline-block h-2 w-2 rounded-full ${cls} ${pulse ? 'dot-live' : ''}`} aria-hidden />;
}

export function KpiCard({
  label,
  kpi,
  derived,
  note,
  error,
}: {
  label: string;
  kpi?: { value: number | string | null; unit: string };
  derived?: boolean;
  note?: string | null;
  error?: string | null;
}) {
  return (
    <Card className="rounded-xl shadow-sm">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground leading-4">{label}</p>
          {derived && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/40 text-primary shrink-0">
              derived
            </Badge>
          )}
        </div>
        <p className={`mt-2 text-2xl font-semibold tracking-tight truncate ${error ? 'text-muted-foreground' : ''}`} title={error || undefined}>
          {error ? '—' : fmtKpiValue({ value: kpi?.value ?? null, unit: kpi?.unit ?? 'number' })}
        </p>
        {error ? (
          <p className="mt-1 text-[11px] text-warning leading-4" title={error}>{error}</p>
        ) : note ? (
          <p className="mt-1 text-[11px] text-muted-foreground leading-4 line-clamp-2" title={note}>{note}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ChartCard({
  title,
  reason,
  children,
  footer,
}: {
  title: string;
  reason?: string | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card className="rounded-xl shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold leading-5">{title}</CardTitle>
        {reason ? <p className="text-xs text-muted-foreground">{reason}</p> : null}
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
      {footer ? <div className="px-6 pb-4 -mt-1">{footer}</div> : null}
    </Card>
  );
}

export function EmptyState({ title, hint, action }: { title: string; hint?: string; action?: React.ReactNode }) {
  return (
    <div className="site-noise rounded-xl border border-dashed bg-card/60 p-10 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border-2 border-primary/30 text-primary font-bold rotate-6">
        IQ
      </div>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      {hint ? <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{hint}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = 'Working…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
      {label}
    </div>
  );
}

export function SkeletonGrid({ rows = 3 }: { rows?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: rows * 4 }).map((_, i) => (
        <Skeleton key={i} className="h-24 rounded-xl bg-muted" />
      ))}
    </div>
  );
}

export function ErrorBlock({ message, hint }: { message: string; hint?: string }) {
  return (
    <Alert variant="destructive" className="rounded-xl">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription>
        {message}
        {hint ? <span className="block mt-1 opacity-80">{hint}</span> : null}
      </AlertDescription>
    </Alert>
  );
}

export function InfoNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <div>{children}</div>
    </div>
  );
}
