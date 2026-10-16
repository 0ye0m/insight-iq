'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/hooks/use-toast';
import { useInsightStore } from '@/lib/insightiq/store';
import { compareDatasets, listVersions } from '@/lib/insightiq/api';
import { ApiError } from '@/lib/insightiq/api';
import type { CompareResult, DatasetVersion } from '@/lib/insightiq/types';
import { fmtNumber } from '@/lib/insightiq/format';
import { SectionTitle, EmptyState, LoadingBlock, ErrorBlock, InfoNote } from './ui-bits';
import { GitCompareArrows, ArrowRight, ArrowDown, ArrowUp, Minus } from 'lucide-react';

function Delta({ v, invert = false, suffix = '' }: { v: number | null | undefined; invert?: boolean; suffix?: string }) {
  if (v === null || v === undefined || v === 0) return <span className="inline-flex items-center gap-0.5 text-muted-foreground"><Minus className="h-3 w-3" />0{suffix}</span>;
  const positive = v > 0;
  const good = invert ? !positive : positive;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${good ? 'text-emerald-600' : 'text-destructive'}`}>
      {positive ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {fmtNumber(Math.abs(v))}{suffix}
    </span>
  );
}

export default function CompareView() {
  const { files } = useInsightStore();
  const { toast } = useToast();
  const tabular = files.filter((f) => f.category === 'TABULAR' || f.category === 'UNKNOWN');

  const [aId, setAId] = React.useState<string>('');
  const [bId, setBId] = React.useState<string>('');
  const [versA, setVersA] = React.useState<DatasetVersion[]>([]);
  const [versB, setVersB] = React.useState<DatasetVersion[]>([]);
  const [verA, setVerA] = React.useState<string>('latest');
  const [verB, setVerB] = React.useState<string>('latest');
  const [result, setResult] = React.useState<CompareResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    (async () => {
      const first = tabular[0];
      const second = tabular[1] || tabular[0];
      if (first && !aId) setAId(first.fileId);
      if (second && !bId) setBId(second.fileId);
    })();
  }, [files.length]);

  React.useEffect(() => {
    (async () => {
      if (aId) {
        try {
          const v = await listVersions(aId);
          setVersA(v.versions);
        } catch { setVersA([]); }
      }
    })();
  }, [aId]);
  React.useEffect(() => {
    (async () => {
      if (bId) {
        try {
          const v = await listVersions(bId);
          setVersB(v.versions);
        } catch { setVersB([]); }
      }
    })();
  }, [bId]);

  const runCompare = async () => {
    if (!aId || !bId) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await compareDatasets(
        { fileId: aId, version: verA === 'latest' ? undefined : parseInt(verA, 10) },
        { fileId: bId, version: verB === 'latest' ? undefined : parseInt(verB, 10) }
      );
      setResult(res);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Comparison failed.';
      setError(msg);
      toast({ title: 'Comparison failed', description: msg, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const labelFor = (id: string) => files.find((f) => f.fileId === id)?.fileName || id.slice(0, 8);

  return (
    <div className="space-y-6">
      <SectionTitle>Compare datasets</SectionTitle>

      <Card className="rounded-xl shadow-sm">
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_auto_1fr_auto] md:items-end">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Dataset A (e.g. original)</p>
            <Select value={aId} onValueChange={(v) => { setAId(v); setVerA('latest'); }}>
              <SelectTrigger className="rounded-lg" aria-label="Dataset A"><SelectValue placeholder="Pick dataset A" /></SelectTrigger>
              <SelectContent>
                {tabular.map((f) => (
                  <SelectItem key={f.fileId} value={f.fileId}>{f.fileName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-2">
              <Select value={verA} onValueChange={setVerA}>
                <SelectTrigger className="h-8 rounded-lg text-xs" aria-label="Version A"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">latest version</SelectItem>
                  {versA.map((v) => (
                    <SelectItem key={v.version} value={String(v.version)}>v{v.version}{v.opsApplied.length ? ` (${v.opsApplied[0]}…)` : ' (original)'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <GitCompareArrows className="hidden h-5 w-5 text-primary md:mb-8" />

          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Dataset B (e.g. cleaned)</p>
            <Select value={bId} onValueChange={(v) => { setBId(v); setVerB('latest'); }}>
              <SelectTrigger className="rounded-lg" aria-label="Dataset B"><SelectValue placeholder="Pick dataset B" /></SelectTrigger>
              <SelectContent>
                {tabular.map((f) => (
                  <SelectItem key={f.fileId} value={f.fileId}>{f.fileName}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-2">
              <Select value={verB} onValueChange={setVerB}>
                <SelectTrigger className="h-8 rounded-lg text-xs" aria-label="Version B"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">latest version</SelectItem>
                  {versB.map((v) => (
                    <SelectItem key={v.version} value={String(v.version)}>v{v.version}{v.opsApplied.length ? ` (${v.opsApplied[0]}…)` : ' (original)'}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button className="btn-gradient-primary rounded-lg" disabled={!aId || !bId || loading} onClick={runCompare}>
            {loading ? 'Comparing…' : <><GitCompareArrows className="mr-2 h-4 w-4" /> Compare</>}
          </Button>
        </CardContent>
      </Card>

      {error && <ErrorBlock message={error} />}
      {loading && <LoadingBlock label="Computing real differences…" />}

      {!result && !loading && !error && (
        <EmptyState
          title="Pick two datasets or versions"
          hint="Compare original vs cleaned versions of the same dataset, or any two tabular datasets. Columns are matched by name AND type — mismatches are reported, not guessed."
        />
      )}

      {result && (
        <div className="space-y-6">
          {/* Quality verdict */}
          <Card className="rounded-xl shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">
                {result.labels.a} <ArrowRight className="inline h-3.5 w-3.5 text-primary" /> {result.labels.b}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Quality score</p>
                  <p className="mt-1 text-lg font-semibold">
                    {result.quality.scoreA} → {result.quality.scoreB}
                  </p>
                  <p className="mt-0.5"><Delta v={result.quality.delta} suffix=" pts" /></p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Rows</p>
                  <p className="mt-1 text-lg font-semibold">
                    {result.shape.rowsA} → {result.shape.rowsB}
                  </p>
                  <p className="mt-0.5"><Delta v={result.shape.rowDelta} invert /></p>
                </div>
                <div className="rounded-lg border p-3">
                  <p className="text-xs text-muted-foreground">Missing cells %</p>
                  <p className="mt-1 text-lg font-semibold">
                    {result.quality.missingPctA}% → {result.quality.missingPctB}%
                  </p>
                </div>
              </div>
              {result.quality.delta === 0 && (
                <div className="mt-3">
                  <InfoNote>
                    Quality did not change. Cleaning only helps when it resolves actual measurable issues — this is the honest score.
                  </InfoNote>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Records matching */}
          <Card className="rounded-xl shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Record-level matching</CardTitle></CardHeader>
            <CardContent className="pt-0">
              {result.records.matched ? (
                <div className="grid gap-3 text-sm sm:grid-cols-4">
                  <div><p className="text-xs text-muted-foreground">Key column</p><p className="font-medium">{result.records.keyColumn}</p></div>
                  <div><p className="text-xs text-muted-foreground">Common</p><p className="font-semibold text-emerald-600">{result.records.common}</p></div>
                  <div><p className="text-xs text-muted-foreground">Added in B</p><p className="font-semibold">{result.records.added}</p></div>
                  <div><p className="text-xs text-muted-foreground">Removed from A</p><p className="font-semibold">{result.records.removed}</p></div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{result.records.reason}</p>
              )}
            </CardContent>
          </Card>

          {/* Schema */}
          <Card className="rounded-xl shadow-sm">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Schema differences</CardTitle></CardHeader>
            <CardContent className="pt-0">
              <div className="flex flex-wrap gap-1.5">
                {result.schema.onlyInA.map((c) => (
                  <Badge key={`a-${c.column}`} variant="outline" className="rounded-md text-[10px] border-destructive/40 text-destructive">only in A: {c.column}</Badge>
                ))}
                {result.schema.onlyInB.map((c) => (
                  <Badge key={`b-${c.column}`} variant="outline" className="rounded-md text-[10px] border-emerald-500/40 text-emerald-600">only in B: {c.column}</Badge>
                ))}
                {result.schema.typeIssues.map((c) => (
                  <Badge key={`t-${c.column}`} variant="outline" className="rounded-md text-[10px] border-warning/50 text-warning">type mismatch: {c.column} ({c.typeA} vs {c.typeB})</Badge>
                ))}
                {result.schema.onlyInA.length + result.schema.onlyInB.length + result.schema.typeIssues.length === 0 && (
                  <span className="text-xs text-muted-foreground">Schemas fully aligned — all {result.schema.commonColumns.length} common columns compatible.</span>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Numeric deltas */}
          {result.numeric.length > 0 && (
            <Card className="rounded-xl shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Numeric statistics</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <div className="max-h-72 overflow-auto scroll-slim">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Column</TableHead>
                        <TableHead>Mean A</TableHead>
                        <TableHead>Mean B</TableHead>
                        <TableHead>Δ</TableHead>
                        <TableHead>Median A</TableHead>
                        <TableHead>Median B</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.numeric.map((n) => (
                        <TableRow key={n.column}>
                          <TableCell className="font-medium">{n.column}</TableCell>
                          <TableCell>{fmtNumber(n.meanA)}</TableCell>
                          <TableCell>{fmtNumber(n.meanB)}</TableCell>
                          <TableCell><Delta v={n.meanDelta} /></TableCell>
                          <TableCell>{fmtNumber(n.medianA)}</TableCell>
                          <TableCell>{fmtNumber(n.medianB)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Missingness */}
          {result.missingness.length > 0 && (
            <Card className="rounded-xl shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Missingness changes</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <div className="max-h-64 overflow-auto scroll-slim">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Column</TableHead>
                        <TableHead>A</TableHead>
                        <TableHead>B</TableHead>
                        <TableHead>Δ (pp)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {result.missingness.map((m) => (
                        <TableRow key={m.column}>
                          <TableCell className="font-medium">{m.column}</TableCell>
                          <TableCell>{m.missingPctA}%</TableCell>
                          <TableCell>{m.missingPctB}%</TableCell>
                          <TableCell><Delta v={m.delta} invert /></TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Categorical shifts */}
          {result.categorical.length > 0 && (
            <Card className="rounded-xl shadow-sm">
              <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Categorical distribution shifts</CardTitle></CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-2 text-sm">
                  {result.categorical.map((c) => (
                    <div key={c.column} className="rounded-lg border p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{c.column}</span>
                        <Badge variant="outline" className="rounded-md text-[10px]">TVD {c.distributionDistance}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        A: {c.topA.map((t) => `${t.value} ${t.pct}%`).join(', ') || '—'}
                        {' · '}
                        B: {c.topB.map((t) => `${t.value} ${t.pct}%`).join(', ') || '—'}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
