'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { useInsightStore } from '@/lib/insightiq/store';
import { fetchHealth, fetchProviderStatus } from '@/lib/insightiq/api';
import type { HealthData, ProviderStatus } from '@/lib/insightiq/types';
import { fmtDate } from '@/lib/insightiq/format';
import { SectionTitle, StatusDot, EmptyState } from './ui-bits';
import { UploadCloud, ChartColumnBig, GitCompareArrows, MessageSquareText, RefreshCw, FileSpreadsheet, FileText, Image as ImageIcon, Film, ArrowRight, ShieldCheck, Cpu, Zap, Sparkles } from 'lucide-react';

const WORKFLOW = [
  { icon: UploadCloud, title: 'Upload', desc: 'CSV, Excel, JSON, PDF, DOCX, images, video or a URL.' },
  { icon: ChartColumnBig, title: 'Analyze', desc: 'Deterministic profiling, AI-planned KPIs, charts & insights.' },
  { icon: Sparkles, title: 'Clean', desc: 'Preview issues, approve operations, keep versions & history.' },
  { icon: GitCompareArrows, title: 'Compare', desc: 'Dirty vs cleaned or any two datasets — real deltas.' },
  { icon: MessageSquareText, title: 'Ask', desc: 'Grounded chat: exact numbers from your data, with sources.' },
];

export default function DashboardView() {
  const { files, setView, setActiveFile } = useInsightStore();
  const [health, setHealth] = React.useState<HealthData | null>(null);
  const [providers, setProviders] = React.useState<ProviderStatus | null>(null);
  const [loading, setLoading] = React.useState(true);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const [h, p] = await Promise.all([fetchHealth(), fetchProviderStatus()]);
      setHealth(h);
      setProviders(p);
    } catch {
      setHealth(null);
      setProviders(null);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      {/* Hero */}
      <section className="site-noise relative overflow-hidden rounded-xl border bg-card p-6 sm:p-8">
        <div className="max-w-2xl">
          <span className="kicker">Welcome to InsightIQ</span>
          <h1 className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">
            Your data, actually understood.
          </h1>
          <p className="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
            A deterministic analytics engine profiles, cleans and measures your data — then an evidence-grounded
            AI layer explains what the verified numbers mean. No mocked dashboards: every value is computed from your files.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button className="btn-gradient-primary rounded-lg" onClick={() => setView('upload')}>
              <UploadCloud className="mr-2 h-4 w-4" /> Upload data
            </Button>
            <Button variant="outline" className="rounded-lg" onClick={() => setView('analyze')}>
              <ChartColumnBig className="mr-2 h-4 w-4" /> Analyze
            </Button>
          </div>
        </div>
      </section>

      {/* System status */}
      <section className="space-y-3">
        <SectionTitle
          right={
            <Button variant="ghost" size="sm" className="rounded-lg" onClick={load}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
          }
        >
          System status
        </SectionTitle>
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="rounded-xl shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Cpu className="h-4 w-4 text-primary" /> Analytics engine
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <Skeleton className="h-10 w-2/3 rounded-md bg-muted" />
              ) : health ? (
                <>
                  <p className="flex items-center gap-2 text-sm">
                    <StatusDot tone={health.analyticsEngine === 'available' ? 'green' : 'red'} pulse />
                    Python {health.analyticsPythonVersion?.replace('Python ', '') || '—'}
                    <Badge variant="outline" className="ml-1 rounded-md text-[10px]">{health.analyticsEngine}</Badge>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">pandas · NumPy · SciPy — all statistics computed locally</p>
                </>
              ) : (
                <p className="text-sm text-destructive">Backend unreachable — is the Express service running?</p>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <Zap className="h-4 w-4 text-primary" /> AI providers
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {loading ? (
                <Skeleton className="h-10 w-2/3 rounded-md bg-muted" />
              ) : providers ? (
                <div className="space-y-1.5">
                  {Object.entries(providers.providers).map(([name, info]) => {
                    const keys = info.keys || [];
                    const invalidCount = keys.filter((k) => k.validity === 'invalid').length;
                    const regionBlocked = keys.some((k) => (k.lastError || '').includes('region-blocked'));
                    const validOk = keys.some((k) => k.validity === 'valid' && !k.coolingDown && !k.lastError);
                    return (
                      <p key={name} className="flex items-center gap-2 text-sm capitalize">
                        <StatusDot tone={info.configured ? (invalidCount === keys.length && keys.length > 0 ? 'red' : 'orange') : 'gray'} />
                        {name}
                        <span className="text-xs text-muted-foreground">
                          {info.mode === 'managed-fallback'
                            ? info.configured
                              ? 'managed fallback · ready'
                              : 'disabled'
                            : info.configured
                              ? `${info.keys.length} key slot${info.keys.length === 1 ? '' : 's'}`
                              : 'not configured'}
                          {validOk ? ' · keys verified' : ''}
                          {regionBlocked ? ' · region-blocked' : ''}
                          {invalidCount > 0 ? ` · ${invalidCount} rejected` : ''}
                          {keys.some((k) => k.coolingDown) ? ' · cooling down' : ''}
                        </span>
                      </p>
                    );
                  })}
                  <p className="pt-1 text-xs text-muted-foreground">
                    Keys masked server-side — never exposed to the browser. Region-blocked keys are verified valid and auto-engage from a supported egress; the managed fallback keeps AI live meanwhile.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">—</p>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-primary" /> Grounding policy
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <ul className="space-y-1 text-xs text-muted-foreground">
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> Every number computed by the local engine</li>
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> AI plans validated against your schema</li>
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> Unsupported chat questions refused</li>
                <li className="flex gap-1.5"><span className="text-emerald-500">✓</span> Deterministic fallback when AI is down</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Workflow */}
      <section className="space-y-3">
        <SectionTitle>How it works</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {WORKFLOW.map(({ icon: Icon, title, desc }, i) => (
            <Card key={title} className="rounded-xl shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary text-xs font-bold">{i + 1}</span>
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="mt-2 text-sm font-semibold">{title}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Recent datasets */}
      <section className="space-y-3">
        <SectionTitle
          right={
            files.length > 0 ? (
              <Button variant="ghost" size="sm" className="rounded-lg" onClick={() => setView('upload')}>
                Manage all <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            ) : null
          }
        >
          Datasets
        </SectionTitle>
        {files.length === 0 ? (
          <EmptyState
            title="No datasets yet"
            hint="Upload a CSV, Excel file, JSON, document, image or video to get started. Analysis works fully offline with the deterministic engine."
            action={
              <Button className="btn-gradient-primary rounded-lg" onClick={() => setView('upload')}>
                <UploadCloud className="mr-2 h-4 w-4" /> Upload your first dataset
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {files.slice(0, 6).map((f) => (
              <Card
                key={f.fileId}
                className="cursor-pointer rounded-xl shadow-sm transition-shadow hover:shadow-md"
                onClick={() => {
                  setActiveFile(f.fileId);
                  setView(f.category === 'IMAGE' || f.category === 'VIDEO' ? 'media' : 'analyze');
                }}
              >
                <CardContent className="flex items-center gap-3 p-4">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                    {f.category === 'DOCUMENT' ? <FileText className="h-4 w-4 text-primary" /> : f.category === 'IMAGE' ? <ImageIcon className="h-4 w-4 text-primary" /> : f.category === 'VIDEO' ? <Film className="h-4 w-4 text-primary" /> : <FileSpreadsheet className="h-4 w-4 text-primary" />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{f.fileName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {f.snapshot?.rowCount != null
                        ? `${f.snapshot.rowCount} rows × ${f.snapshot.colCount} cols`
                        : f.snapshot?.wordCount != null
                          ? `${f.snapshot.wordCount} words`
                          : f.category}
                      {' · '}
                      {fmtDate(f.createdAt)}
                    </p>
                  </div>
                  {f.snapshot?.qualityScore != null && (
                    <Badge variant="outline" className="rounded-md text-[10px]">Q {f.snapshot.qualityScore}</Badge>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
