'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { useToast } from '@/hooks/use-toast';
import { useInsightStore } from '@/lib/insightiq/store';
import { analyzeFile, previewRows } from '@/lib/insightiq/api';
import { ApiError } from '@/lib/insightiq/api';
import type { AnalysisResult, DocumentResult, ChartResult, TestResult } from '@/lib/insightiq/types';
import { fmtNumber } from '@/lib/insightiq/format';
import { SectionTitle, KpiCard, ChartCard, EmptyState, LoadingBlock, ErrorBlock, InfoNote } from './ui-bits';
import ChartRenderer from './ChartRenderer';
import { ChartColumnBig, ChevronDown, Download, FileText, Info, Sparkles, ShieldCheck, Wand2 } from 'lucide-react';

export default function AnalyzeView() {
  const { files, activeFileId, analysis, setAnalysis, setView } = useInsightStore();
  const { toast } = useToast();
  const file = files.find((f) => f.fileId === activeFileId);
  const result = activeFileId ? analysis[activeFileId] : undefined;

  const [objective, setObjective] = React.useState('');
  const [running, setRunning] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const runAnalysis = async (obj: string) => {
    if (!file) return;
    setRunning(true);
    setError(null);
    try {
      const res = await analyzeFile(file.fileId, obj);
      setAnalysis(file.fileId, res);
      toast({
        title: 'Analysis complete',
        description:
          'fileType' in res && res.fileType === 'DOCUMENT'
            ? 'Document parsed and summarized.'
            : 'KPIs, charts and findings computed from your data.',
      });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Analysis failed.';
      setError(msg);
      toast({ title: 'Analysis failed', description: msg, variant: 'destructive' });
    } finally {
      setRunning(false);
    }
  };

  if (!file) {
    return (
      <EmptyState
        title="Select a dataset to analyze"
        hint="Upload a file first, then pick it from your datasets. Tabular data gets KPIs + charts; documents get structure + summary; images/video go to the Media tab."
        action={
          <Button className="btn-gradient-primary rounded-lg" onClick={() => setView('upload')}>
            Go to Upload
          </Button>
        }
      />
    );
  }

  if (file.category === 'IMAGE' || file.category === 'VIDEO') {
    return (
      <EmptyState
        title={`${file.category === 'IMAGE' ? 'Image' : 'Video'} file detected`}
        hint="Media files are analyzed in the Media tab with a dedicated vision pipeline — no spreadsheets for photographs."
        action={
          <Button className="btn-gradient-primary rounded-lg" onClick={() => setView('media')}>
            Open Media analysis
          </Button>
        }
      />
    );
  }

  const tabResult = result as AnalysisResult | undefined;
  const docResult = result as DocumentResult | undefined;
  const isDocument = docResult && 'fileType' in docResult && docResult.fileType === 'DOCUMENT';

  return (
    <div className="space-y-6">
      <SectionTitle>Analyze · {file.fileName}</SectionTitle>

      {/* Objective input */}
      <Card className="rounded-xl shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="flex-1">
            <label htmlFor="objective" className="text-xs font-medium text-muted-foreground">
              What do you want to learn? (optional — the planner decides on its own if empty)
            </label>
            <Input
              id="objective"
              value={objective}
              onChange={(e) => setObjective(e.target.value)}
              placeholder="e.g. Understand sales performance by region and category"
              className="mt-1.5 rounded-lg"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !running) runAnalysis(objective);
              }}
            />
          </div>
          <Button className="btn-gradient-primary rounded-lg sm:mt-5" disabled={running} onClick={() => runAnalysis(objective)}>
            {running ? 'Analyzing…' : <><Wand2 className="mr-2 h-4 w-4" />{tabResult || docResult ? 'Re-analyze' : 'Analyze'}</>}
          </Button>
        </CardContent>
      </Card>

      {error && <ErrorBlock message={error} />}
      {running && <LoadingBlock label="Profiling → planning → validating → computing → explaining. Every number from your data…" />}

      {!result && !running && (
        <EmptyState
          title="Not analyzed yet"
          hint="Run the analysis to compute KPIs, select relevant charts, test hypotheses and generate evidence-grounded findings."
          action={
            <Button className="btn-gradient-primary rounded-lg" onClick={() => runAnalysis(objective)}>
              <ChartColumnBig className="mr-2 h-4 w-4" /> Run analysis
            </Button>
          }
        />
      )}

      {result && isDocument && docResult && <DocumentReport doc={docResult} />}
      {result && tabResult && !isDocument && (
        <TabularReport res={tabResult} fileId={file.fileId} toast={toast} />
      )}
    </div>
  );
}

/* ─── Document report ─── */
function DocumentReport({ doc }: { doc: DocumentResult }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Words" kpi={{ value: doc.wordCount, unit: 'number' }} />
        <KpiCard label="Pages" kpi={{ value: doc.totalPages, unit: 'number' }} />
        <KpiCard label="Searchable chunks" kpi={{ value: doc.chunkCount, unit: 'number' }} note="Used by grounded chat with citations" />
        <KpiCard label="Document type" kpi={{ value: doc.documentType || '—', unit: 'text' }} />
      </div>

      <Card className="rounded-xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <FileText className="h-4 w-4 text-primary" /> Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0 space-y-3">
          <p className="text-sm leading-6">{doc.summary.summary}</p>
          {doc.summary.keyPoints?.length > 0 && (
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              {doc.summary.keyPoints.map((p, i) => (
                <li key={i} className="flex gap-2"><span className="text-primary">•</span>{p}</li>
              ))}
            </ul>
          )}
          {doc.summary.limitations && <InfoNote>{doc.summary.limitations}</InfoNote>}
          {doc.sectionsPreview?.length > 0 && (
            <div className="max-h-56 space-y-2 overflow-y-auto scroll-slim rounded-lg border p-3">
              {doc.sectionsPreview.map((s, i) => (
                <div key={i}>
                  {s.title ? <p className="text-xs font-semibold">{s.title}</p> : null}
                  <p className="text-xs text-muted-foreground line-clamp-2">{s.preview}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <InfoNote>
        Ask questions about this document in the Chat tab — answers retrieve the exact chunks and cite them.
      </InfoNote>
    </div>
  );
}

/* ─── Tabular report ─── */
function TabularReport({
  res,
  fileId,
  toast,
}: {
  res: AnalysisResult;
  fileId: string;
  toast: ReturnType<typeof useToast>['toast'];
}) {
  const validKpis = res.results.kpis.filter((k) => k.value !== null || k.error);
  const validCharts = res.results.charts.filter((c) => c.result && c.result.data && c.result.data.length > 0);
  const hasMore = validKpis.length > 8 || validCharts.length > 4;

  return (
    <div className="space-y-6">
      {/* Meta strip */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="rounded-md">v{res.version}</Badge>
        <span>{res.rowCount} rows × {res.colCount} columns</span>
        <span>·</span>
        <span className="flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 text-emerald-500" />
          quality {res.profile.quality.qualityScore}/100 ({res.profile.quality.grade})
        </span>
        {res.planner.fallback ? (
          <Badge variant="outline" className="rounded-md border-warning/50 text-warning">deterministic plan (AI unavailable)</Badge>
        ) : (
          <Badge variant="outline" className="rounded-md border-primary/40 text-primary">AI-planned{res.planner.model ? ` · ${res.planner.model}` : ''}</Badge>
        )}
        {res.critic.applied && <Badge variant="outline" className="rounded-md border-emerald-500/40 text-emerald-600">critic verified</Badge>}
      </div>

      {/* Summary + findings */}
      <Card className="rounded-xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-primary" /> Findings (evidence-grounded)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          <p className="text-sm leading-6">{res.explanation.summary}</p>
          {res.explanation.criticOverall && (
            <InfoNote>Critic: {res.explanation.criticOverall}</InfoNote>
          )}
          <div className="grid gap-3 md:grid-cols-2">
            {res.explanation.findings.map((f) => (
              <div key={f.id} className="rounded-lg border p-3">
                <p className="text-sm font-semibold">{f.title}</p>
                <p className="mt-1 text-sm leading-5">{f.statement}</p>
                {f.why && <p className="mt-1.5 text-xs text-muted-foreground">Why it matters: {f.why}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {f.evidence.map((e, i) => (
                    <Badge key={i} variant="secondary" className="rounded-md text-[10px] font-mono">
                      {e.ref}: {typeof e.value === 'number' ? fmtNumber(e.value) : String(e.value).slice(0, 40)}
                    </Badge>
                  ))}
                </div>
                {f.limitation && <p className="mt-1.5 text-[11px] text-warning">⚠ {f.limitation}</p>}
              </div>
            ))}
            {res.explanation.followUps.map((q, i) => (
              <div key={`q-${i}`} className="rounded-lg border border-dashed bg-secondary/40 p-3 text-sm text-muted-foreground">
                Try asking: “{q}” in the Chat tab
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <section className="space-y-3">
        <SectionTitle right={<span className="text-xs text-muted-foreground">{validKpis.length} computed from your data</span>}>
          Key metrics
        </SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {validKpis.slice(0, 8).map((k) => (
            <KpiCard
              key={k.id}
              label={k.label}
              kpi={{ value: k.value, unit: k.unit }}
              derived={k.kind === 'derived'}
              note={k.error || k.description || (k.result?.groups ? k.result.groups.slice(0, 3).map((g) => `${g.name}: ${fmtNumber(g.value)}`).join(' · ') : null)}
              error={k.error}
            />
          ))}
        </div>
        {validKpis.length > 8 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
              <ChevronDown className="h-3.5 w-3.5" /> Show all {validKpis.length} metrics
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {validKpis.slice(8).map((k) => (
                  <KpiCard key={k.id} label={k.label} kpi={{ value: k.value, unit: k.unit }} derived={k.kind === 'derived'} note={k.error || k.description} error={k.error} />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </section>

      {/* Charts */}
      <section className="space-y-3">
        <SectionTitle>Selected visualizations</SectionTitle>
        <div className="grid gap-4 lg:grid-cols-2">
          {validCharts.slice(0, 4).map((c) => (
            <ChartCard key={c.id} title={c.title} reason={c.reason}>
              <ChartRenderer chart={c as ChartResult} />
            </ChartCard>
          ))}
        </div>
        {validCharts.length > 4 && (
          <Collapsible>
            <CollapsibleTrigger className="flex items-center gap-1 text-xs font-medium text-primary outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
              <ChevronDown className="h-3.5 w-3.5" /> Show all {validCharts.length} charts
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="mt-3 grid gap-4 lg:grid-cols-2">
                {validCharts.slice(4).map((c) => (
                  <ChartCard key={c.id} title={c.title} reason={c.reason}>
                    <ChartRenderer chart={c as ChartResult} />
                  </ChartCard>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
        {validCharts.length === 0 && (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No charts were appropriate for this dataset (check column types and cardinality).
          </p>
        )}
      </section>

      {/* Tests */}
      {res.results.tests.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>Statistical tests</SectionTitle>
          <div className="grid gap-3 md:grid-cols-2">
            {res.results.tests.map((t) => (
              <TestCard key={t.id} test={t as TestResult} />
            ))}
          </div>
        </section>
      )}

      <Tabs defaultValue="profile">
        <TabsList className="rounded-lg">
          <TabsTrigger value="profile" className="rounded-md">Column profiles</TabsTrigger>
          <TabsTrigger value="data" className="rounded-md">Data preview</TabsTrigger>
          <TabsTrigger value="plan" className="rounded-md">Analysis plan</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          <Card className="rounded-xl shadow-sm">
            <CardContent className="p-0">
              <div className="max-h-[420px] overflow-auto scroll-slim">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Column</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Missing</TableHead>
                      <TableHead>Unique</TableHead>
                      <TableHead>Min / Mean / Max</TableHead>
                      <TableHead>Sample values</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {res.profile.columns.map((c) => (
                      <TableRow key={c.name}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="rounded-md text-[10px]">{c.semanticType}</Badge>
                          {c.isIdLike && <Badge variant="outline" className="ml-1 rounded-md text-[10px]">id-like</Badge>}
                          {c.isConstant && <Badge variant="outline" className="ml-1 rounded-md text-[10px]">constant</Badge>}
                        </TableCell>
                        <TableCell className={c.missingPct > 20 ? 'text-destructive' : c.missingPct > 0 ? 'text-warning' : ''}>
                          {c.missingCount} ({c.missingPct}%)
                        </TableCell>
                        <TableCell>{c.uniqueCount}</TableCell>
                        <TableCell className="text-xs">
                          {c.semanticType === 'integer' || c.semanticType === 'float'
                            ? `${fmtNumber(c.min as number)} / ${fmtNumber(c.mean as number)} / ${fmtNumber(c.max as number)}`
                            : c.semanticType === 'datetime'
                              ? `${String(c.min).slice(0, 10)} → ${String(c.max).slice(0, 10)}`
                              : '—'}
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-xs text-muted-foreground" title={c.sampleValues.join(', ')}>
                          {c.sampleValues.slice(0, 3).join(', ')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="data" className="mt-4">
          <DataTable fileId={fileId} />
        </TabsContent>

        <TabsContent value="plan" className="mt-4">
          <Card className="rounded-xl shadow-sm">
            <CardContent className="space-y-3 p-4 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Objectives</p>
                <ul className="mt-1 list-inside list-disc text-muted-foreground">
                  {res.plan.objectives.map((o, i) => <li key={i}>{o}</li>)}
                </ul>
              </div>
              {res.plan.notes && <InfoNote>{res.plan.notes}</InfoNote>}
              <div className="grid gap-3 md:grid-cols-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">KPIs planned</p>
                  <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                    {res.plan.kpis.map((k) => (
                      <li key={k.id}>
                        <span className="font-medium text-foreground">{k.label}</span> — {k.kind}
                        {k.formula ? ` (${k.formula.op})` : ''}
                        {k.formula ? <span className="block font-mono text-[10px]">{JSON.stringify(k.formula)}</span> : null}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Charts planned</p>
                  <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                    {res.plan.charts.map((c) => (
                      <li key={c.id}>
                        <span className="font-medium text-foreground">{c.type}</span> — {c.title}
                        <span className="block text-[10px]">{c.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Validation</p>
                  <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                    <li>Repairs: {res.planner.repairs.length === 0 ? 'none' : res.planner.repairs.join('; ')}</li>
                    <li>Warnings: {res.planner.warnings.length === 0 ? 'none' : res.planner.warnings.join('; ')}</li>
                    <li>Executor: deterministic engine (no model-generated code)</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          className="rounded-lg"
          onClick={async () => {
            try {
              const { exportReport } = await import('@/lib/insightiq/api');
              await exportReport(fileId);
            } catch (e) {
              toast({ title: 'Export failed', description: String(e instanceof Error ? e.message : e), variant: 'destructive' });
            }
          }}
        >
          <Download className="mr-2 h-4 w-4" /> Export XLSX report
        </Button>
        <Button variant="outline" className="rounded-lg" onClick={() => setView('clean')}>
          <Sparkles className="mr-2 h-4 w-4" /> Clean this dataset
        </Button>
        <Button variant="outline" className="rounded-lg" onClick={() => setView('chat')}>
          <Info className="mr-2 h-4 w-4" /> Ask about these results
        </Button>
      </div>
    </div>
  );
}

function TestCard({ test }: { test: TestResult }) {
  const r = (test.result || {}) as Record<string, unknown>;
  return (
    <Card className="rounded-xl shadow-sm">
      <CardContent className="p-4">
        <p className="text-sm font-semibold capitalize">
          {test.type} test{test.columns?.length ? ` · ${test.columns.join(' × ')}` : ''}
        </p>
        {test.error || r.error ? (
          <p className="mt-1 text-xs text-warning">{test.error || String(r.error)}</p>
        ) : test.type === 'correlation' ? (
          <div className="mt-2 space-y-1 text-sm">
            <p>
              Pearson <span className="font-semibold">{String(r.correlation)}</span> ({String(r.strength)} {String(r.direction)}) · Spearman {String(r.spearman ?? '—')}
            </p>
            <p className="text-xs text-muted-foreground">
              n={String(r.n)} · p≈{String(r.pValue ?? '—')} — an association, not causation.
            </p>
          </div>
        ) : test.type === 'ttest' ? (
          <div className="mt-2 space-y-1 text-sm">
            <p>
              {String((r.groupA as Record<string, unknown>)?.name)}: <span className="font-semibold">{String((r.groupA as Record<string, unknown>)?.mean)}</span> vs{' '}
              {String((r.groupB as Record<string, unknown>)?.name)}: <span className="font-semibold">{String((r.groupB as Record<string, unknown>)?.mean)}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              t={String(r.tStatistic)} · p={String(r.pValue)} · {r.significant ? 'significant at α=0.05' : 'not significant at α=0.05'}
            </p>
          </div>
        ) : (
          <div className="mt-2 space-y-1 text-sm">
            <p>χ²=<span className="font-semibold">{String(r.chi2)}</span> · p={String(r.pValue)} · Cramér's V={String(r.cramersV)}</p>
            <p className="text-xs text-muted-foreground">{r.significant ? 'Significant association' : 'No significant association'} between the two categorical columns.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DataTable({ fileId }: { fileId: string }) {
  const [data, setData] = React.useState<{ columns: string[]; rows: (string | null)[][]; total: number } | null>(null);
  const [page, setPage] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const PAGE = 15;

  React.useEffect(() => {
    let alive = true;
    previewRows(fileId, PAGE, page * PAGE)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof ApiError ? e.message : 'Preview failed'));
    return () => {
      alive = false;
    };
  }, [fileId, page]);

  if (error) return <ErrorBlock message={error} />;
  if (!data) return <LoadingBlock label="Loading rows…" />;

  return (
    <Card className="rounded-xl shadow-sm">
      <CardContent className="p-0">
        <div className="max-h-[420px] overflow-auto scroll-slim">
          <Table>
            <TableHeader>
              <TableRow>
                {data.columns.map((c) => (
                  <TableHead key={c} className="whitespace-nowrap">{c}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row, i) => (
                <TableRow key={i}>
                  {row.map((cell, j) => (
                    <TableCell key={j} className={`max-w-[240px] truncate whitespace-nowrap text-xs ${cell === null ? 'text-muted-foreground/50' : ''}`}>
                      {cell === null ? '—' : cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <div className="flex items-center justify-between border-t px-4 py-2 text-xs text-muted-foreground">
          <span>
            Rows {page * PAGE + 1}–{Math.min((page + 1) * PAGE, data.total)} of {data.total}
          </span>
          <div className="flex gap-1.5">
            <Button variant="outline" size="sm" className="h-7 rounded-md" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <Button variant="outline" size="sm" className="h-7 rounded-md" disabled={(page + 1) * PAGE >= data.total} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
