'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/hooks/use-toast';
import { useInsightStore } from '@/lib/insightiq/store';
import { previewCleaning, applyCleaning, resetCleaning, listVersions } from '@/lib/insightiq/api';
import { ApiError } from '@/lib/insightiq/api';
import type { CleaningOp, CleanApplyResult, DatasetVersion } from '@/lib/insightiq/types';
import { fmtDate } from '@/lib/insightiq/format';
import { SectionTitle, EmptyState, LoadingBlock, ErrorBlock, InfoNote, KpiCard } from './ui-bits';
import { Sparkles, Undo2, ShieldCheck, AlertTriangle, History, Download } from 'lucide-react';

function severityBadge(sev: string) {
  if (sev === 'high') return <Badge className="rounded-md bg-destructive/10 text-destructive border-0 text-[10px]">high</Badge>;
  if (sev === 'medium') return <Badge className="rounded-md bg-warning/10 text-warning border-0 text-[10px]">medium</Badge>;
  return <Badge variant="secondary" className="rounded-md text-[10px]">low</Badge>;
}

export default function CleanView() {
  const { files, activeFileId, setView } = useInsightStore();
  const { toast } = useToast();
  const file = files.find((f) => f.fileId === activeFileId);

  const [loading, setLoading] = React.useState(false);
  const [ops, setOps] = React.useState<CleaningOp[] | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [applying, setApplying] = React.useState(false);
  const [applyResult, setApplyResult] = React.useState<CleanApplyResult | null>(null);
  const [versions, setVersions] = React.useState<DatasetVersion[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    setApplyResult(null);
    try {
      const [prev, ver] = await Promise.all([previewCleaning(file.fileId), listVersions(file.fileId)]);
      setOps(prev.operations);
      setSelected(new Set(prev.operations.filter((o) => o.affectedCount > 0 && o.id !== 'drop_missing_rows').map((o) => o.id)));
      setVersions(ver.versions);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load cleaning suggestions.');
    } finally {
      setLoading(false);
    }
  }, [file]);

  React.useEffect(() => {
    if (file && file.category !== 'IMAGE' && file.category !== 'VIDEO') load();
    else {
      setOps(null);
      setVersions(null);
    }
  }, [file?.fileId]);

  if (!file) {
    return (
      <EmptyState
        title="Select a dataset to clean"
        hint="InsightIQ proposes deterministic cleaning operations with exact affected counts. You approve each one — original data is never overwritten."
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
        title="Media files have a separate pipeline"
        hint="Images and videos are never cleaned with table operations. Their quality is assessed during media analysis instead."
        action={
          <Button className="btn-gradient-primary rounded-lg" onClick={() => setView('media')}>
            Open Media
          </Button>
        }
      />
    );
  }

  const doApply = async () => {
    if (!file || selected.size === 0) return;
    setApplying(true);
    try {
      const res = await applyCleaning(file.fileId, Array.from(selected));
      setApplyResult(res);
      toast({
        title: `Cleaning applied — dataset v${res.appliedVersion} created`,
        description: `Quality ${res.before.qualityScore} → ${res.after.qualityScore}. Original v${res.parentVersion} preserved.`,
      });
      const ver = await listVersions(file.fileId);
      setVersions(ver.versions);
      setOps(null);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Cleaning failed.';
      toast({ title: 'Cleaning failed', description: msg, variant: 'destructive' });
    } finally {
      setApplying(false);
    }
  };

  const doReset = async () => {
    if (!file) return;
    try {
      await resetCleaning(file.fileId);
      toast({ title: 'Restored original dataset (v1)' });
      setApplyResult(null);
      setOps(null);
      load();
    } catch (e) {
      toast({ title: 'Reset failed', description: String(e instanceof Error ? e.message : e), variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <SectionTitle
        right={
          <div className="flex gap-1.5">
            <Button variant="ghost" size="sm" className="rounded-lg" onClick={load} disabled={loading}>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Re-detect issues
            </Button>
            <Button variant="ghost" size="sm" className="rounded-lg" onClick={doReset}>
              <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Reset to original
            </Button>
          </div>
        }
      >
        Clean · {file.fileName}
      </SectionTitle>

      {error && <ErrorBlock message={error} />}
      {loading && <LoadingBlock label="Detecting quality issues…" />}

      {/* Before/after result */}
      {applyResult && (
        <Card className="rounded-xl shadow-sm border-primary/30">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="h-4 w-4 text-emerald-500" />
              Applied {applyResult.operationsApplied.length} operation(s) — dataset v{applyResult.appliedVersion} created (original v{applyResult.parentVersion} preserved)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-0">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard label="Quality before" kpi={{ value: applyResult.before.qualityScore, unit: 'number' }} note={`Grade ${applyResult.before.grade}`} />
              <KpiCard label="Quality after" kpi={{ value: applyResult.after.qualityScore, unit: 'number' }} note={`Grade ${applyResult.after.grade}`} />
              <KpiCard
                label="Improvement"
                kpi={{ value: Math.round((applyResult.after.qualityScore - applyResult.before.qualityScore) * 10) / 10, unit: 'number' }}
                note="percentage points"
              />
              <KpiCard label="Rows retained" kpi={{ value: applyResult.rowCountAfter, unit: 'number' }} note={`${applyResult.rowCountBefore - applyResult.rowCountAfter} removed · ${applyResult.after.missingCells} missing cells remain`} />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>before {applyResult.before.qualityScore}</span>
                <span>after {applyResult.after.qualityScore}</span>
              </div>
              <Progress value={applyResult.after.qualityScore} className="h-2" />
            </div>
            <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
              <span>Missing cells: {applyResult.before.missingCells} → {applyResult.after.missingCells}</span>
              <span>Duplicates: {applyResult.before.duplicateRows} → {applyResult.after.duplicateRows}</span>
              <span>Whitespace cells: {applyResult.before.whitespaceCells} → {applyResult.after.whitespaceCells}</span>
            </div>
            <InfoNote>
              Deleting rows only improves the score when the deleted rows were actually the problem (e.g. duplicates).
              The score is always recomputed from the cleaned data — removal is never assumed to help.
            </InfoNote>
            <Button
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => setView('compare')}
            >
              Compare dirty vs cleaned →
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Proposed operations */}
      {!loading && ops && ops.length === 0 && !applyResult && (
        <EmptyState
          title="No cleanable issues detected"
          hint="The deterministic engine found no duplicates, missing values, mixed types or formatting problems. Try Compare to see dataset-level differences."
        />
      )}

      {!loading && ops && ops.length > 0 && (
        <Card className="rounded-xl shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Proposed operations ({ops.length})</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{selected.size} selected · affected counts are exact</p>
              <Button className="btn-gradient-primary rounded-lg" size="sm" disabled={applying || selected.size === 0} onClick={doApply}>
                {applying ? 'Applying…' : `Apply ${selected.size} operation${selected.size === 1 ? '' : 's'}`}
              </Button>
            </div>
            <div className="max-h-[360px] space-y-2 overflow-y-auto scroll-slim pr-1">
              {ops.map((op) => {
                const checked = selected.has(op.id);
                const risky = op.id === 'drop_missing_rows' || op.id === 'drop_constant_columns' || op.id === 'drop_all_missing_columns';
                return (
                  <label
                    key={op.id + (op.column || '')}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ${
                      checked ? 'border-primary/50 bg-primary/5' : 'hover:bg-secondary/40'
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        const next = new Set(selected);
                        if (v) next.add(op.id);
                        else next.delete(op.id);
                        setSelected(next);
                      }}
                      className="mt-0.5"
                      aria-label={op.label}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{op.label}</span>
                        {op.column && <Badge variant="secondary" className="rounded-md text-[10px]">{op.column}</Badge>}
                        {risky && (
                          <span className="inline-flex items-center gap-1 text-[10px] text-warning">
                            <AlertTriangle className="h-3 w-3" /> destructive
                          </span>
                        )}
                        <span className="ml-auto text-xs text-muted-foreground">{op.affectedCount} affected</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{op.detail}</p>
                    </div>
                  </label>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Version history */}
      {versions && versions.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>
            <span className="inline-flex items-center gap-2">
              <History className="h-3.5 w-3.5" /> Version history
            </span>
          </SectionTitle>
          <Card className="rounded-xl shadow-sm">
            <CardContent className="p-0">
              <div className="max-h-64 overflow-y-auto scroll-slim">
                {versions.slice().reverse().map((v, idx) => (
                  <React.Fragment key={v.version}>
                    {idx > 0 && <Separator />}
                    <div className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
                      <Badge variant={idx === 0 ? 'default' : 'secondary'} className={`rounded-md ${idx === 0 ? 'btn-gradient-primary border-0' : ''}`}>
                        v{v.version}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {v.rows} rows × {v.cols} cols · {fmtDate(v.createdAt)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {v.opsApplied.length === 0 ? 'original upload' : v.opsApplied.join(', ')}
                      </span>
                      {idx === 0 && <Badge variant="outline" className="ml-auto rounded-md text-[10px]">current</Badge>}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </CardContent>
          </Card>
          <Button
            variant="outline"
            size="sm"
            className="rounded-lg"
            onClick={async () => {
              try {
                const { exportCleanedCsv } = await import('@/lib/insightiq/api');
                await exportCleanedCsv(file.fileId);
              } catch (e) {
                toast({ title: 'Export failed', description: String(e instanceof Error ? e.message : e), variant: 'destructive' });
              }
            }}
          >
            <Download className="mr-2 h-3.5 w-3.5" /> Export cleaned CSV
          </Button>
        </section>
      )}
    </div>
  );
}
