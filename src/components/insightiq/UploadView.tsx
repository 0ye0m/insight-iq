'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useToast } from '@/hooks/use-toast';
import { useInsightStore } from '@/lib/insightiq/store';
import { uploadFile, deleteFile, listFiles, exportCleanedCsv, exportReport } from '@/lib/insightiq/api';
import { ApiError } from '@/lib/insightiq/api';
import { fmtBytes, fmtDate } from '@/lib/insightiq/format';
import { SectionTitle, ErrorBlock, InfoNote } from './ui-bits';
import { UploadCloud, FileSpreadsheet, FileText, Image as ImageIcon, Film, Trash2, ChartColumnBig, MessageSquareText, Download, FileOutput, RefreshCw } from 'lucide-react';

const ACCEPT = '.csv,.tsv,.txt,.json,.jsonl,.ndjson,.xlsx,.xls,.ods,.parquet,.pdf,.docx,.pptx,.odt,.rtf,.md,.markdown,.html,.htm,.xml,.png,.jpg,.jpeg,.webp,.gif,.bmp,.mp4,.webm,.mov,.mkv,.avi';
const MAX_MB = 100;

function catIcon(category: string) {
  if (category === 'DOCUMENT') return <FileText className="h-4 w-4 text-primary" />;
  if (category === 'IMAGE') return <ImageIcon className="h-4 w-4 text-primary" />;
  if (category === 'VIDEO') return <Film className="h-4 w-4 text-primary" />;
  return <FileSpreadsheet className="h-4 w-4 text-primary" />;
}

export default function UploadView() {
  const { files, setFiles, upsertFile, removeFile, setActiveFile, setView, filesLoadedOnce } = useInsightStore();
  const { toast } = useToast();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = React.useState(false);
  const [uploading, setUploading] = React.useState<{ name: string; progress: number } | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const list = await listFiles();
      setFiles(list);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the backend service.');
    }
  }, [setFiles]);

  React.useEffect(() => {
    if (!filesLoadedOnce) refresh();
  }, [filesLoadedOnce, refresh]);

  const doUpload = React.useCallback(
    async (file: File) => {
      setError(null);
      if (file.size > MAX_MB * 1024 * 1024) {
        setError(`"${file.name}" is ${fmtBytes(file.size)} — the limit is ${MAX_MB}MB.`);
        return;
      }
      setUploading({ name: file.name, progress: 15 });
      try {
        setUploading({ name: file.name, progress: 55 });
        const result = await uploadFile(file);
        upsertFile({
          fileId: result.fileId,
          fileName: result.fileName,
          category: result.category,
          fileType: (result.snapshot?.fileType as FileItem['fileType']) || null,
          status: result.status,
          createdAt: new Date().toISOString(),
          snapshot: result.snapshot,
          snapshotError: result.snapshotError,
        });
        setUploading({ name: file.name, progress: 100 });
        if (result.snapshotError) {
          toast({ title: 'Uploaded, but profiling failed', description: result.snapshotError, variant: 'destructive' });
        } else {
          toast({ title: 'Dataset uploaded & profiled', description: `${result.fileName} ready for analysis.` });
        }
        setActiveFile(result.fileId);
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'Upload failed.';
        setError(msg);
        toast({ title: 'Upload failed', description: msg, variant: 'destructive' });
      } finally {
        setTimeout(() => setUploading(null), 600);
      }
    },
    [upsertFile, setActiveFile, toast]
  );

  const onDrop = React.useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const files = Array.from(e.dataTransfer.files || []);
      if (files.length > 0) doUpload(files[0]);
    },
    [doUpload]
  );

  const goAnalyze = (fileId: string) => {
    setActiveFile(fileId);
    setView('analyze');
  };
  const goChat = (fileId: string) => {
    setActiveFile(fileId);
    setView('chat');
  };

  return (
    <div className="space-y-6">
      <SectionTitle>Upload data</SectionTitle>

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload a file"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`site-noise flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          dragging ? 'border-primary bg-primary/5' : 'border-border bg-card/60 hover:border-primary/50'
        }`}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-primary/40 bg-primary/10 text-primary">
          <UploadCloud className="h-6 w-6" />
        </span>
        <p className="mt-4 text-sm font-semibold">Drop a file here or click to browse</p>
        <p className="mt-1 max-w-md text-xs leading-5 text-muted-foreground">
          Tabular (CSV, TSV, Excel, JSON, Parquet) · Documents (PDF, DOCX, PPTX, MD, HTML…) · Images (PNG, JPG, WebP…) · Video (MP4, WebM, MOV — ≤ 100MB / 10 min)
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) doUpload(f);
            e.currentTarget.value = '';
          }}
        />
      </div>

      {uploading && (
        <Card className="rounded-xl shadow-sm">
          <CardContent className="p-4">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium">Uploading {uploading.name}…</span>
              <span className="text-muted-foreground">{uploading.progress}%</span>
            </div>
            <Progress value={uploading.progress} className="h-1.5" />
          </CardContent>
        </Card>
      )}

      {error && <ErrorBlock message={error} hint="Check file size and format, then try again." />}

      <InfoNote>
        Files are processed server-side by the Python analytics engine; images/video are only sent to the configured
        vision model when you explicitly run an analysis. Everything works without AI — profiling, cleaning, comparison
        and charts are computed locally.
      </InfoNote>

      {/* File list */}
      <section className="space-y-3">
        <SectionTitle
          right={
            <Button variant="ghost" size="sm" className="rounded-lg" onClick={refresh}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Refresh
            </Button>
          }
        >
          {files.length > 0 ? `Your datasets (${files.length})` : 'Your datasets'}
        </SectionTitle>

        {files.length === 0 ? (
          <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            Nothing uploaded yet.
          </p>
        ) : (
          <div className="max-h-[480px] space-y-3 overflow-y-auto scroll-slim pr-1">
            {files.map((f) => (
              <Card key={f.fileId} className="rounded-xl shadow-sm">
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                      {catIcon(f.category)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium" title={f.fileName}>{f.fileName}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {f.snapshot?.rowCount != null
                          ? `${f.snapshot.rowCount} rows × ${f.snapshot.colCount} cols · `
                          : ''}
                        {f.snapshot?.wordCount != null ? `${f.snapshot.wordCount} words · ` : ''}
                        {f.snapshot?.chunkCount != null ? `${f.snapshot.chunkCount} chunks · ` : ''}
                        {fmtDate(f.createdAt)}
                      </p>
                      {f.snapshotError ? <p className="mt-1 text-xs text-destructive">{f.snapshotError}</p> : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {f.snapshot?.qualityScore != null && (
                        <Badge variant="outline" className="rounded-md text-[10px]">quality {f.snapshot.qualityScore}</Badge>
                      )}
                      {(f.category === 'TABULAR' || f.category === 'UNKNOWN') && (
                        <>
                          <Button size="sm" variant="outline" className="rounded-lg" onClick={() => goAnalyze(f.fileId)}>
                            <ChartColumnBig className="mr-1.5 h-3.5 w-3.5" /> Analyze
                          </Button>
                          <Button size="sm" variant="outline" className="rounded-lg" onClick={() => goChat(f.fileId)}>
                            <MessageSquareText className="mr-1.5 h-3.5 w-3.5" /> Chat
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-lg"
                            title="Export cleaned CSV"
                            onClick={async () => {
                              try {
                                await exportCleanedCsv(f.fileId);
                              } catch (err) {
                                toast({ title: 'Export failed', description: String(err instanceof Error ? err.message : err), variant: 'destructive' });
                              }
                            }}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-lg"
                            title="Export XLSX report"
                            onClick={async () => {
                              try {
                                await exportReport(f.fileId);
                              } catch (err) {
                                toast({ title: 'Report export failed', description: String(err instanceof Error ? err.message : err), variant: 'destructive' });
                              }
                            }}
                          >
                            <FileOutput className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-lg text-destructive hover:text-destructive"
                        aria-label={`Delete ${f.fileName}`}
                        onClick={async () => {
                          try {
                            await deleteFile(f.fileId);
                            removeFile(f.fileId);
                            toast({ title: 'Dataset removed' });
                          } catch (err) {
                            toast({ title: 'Delete failed', description: String(err instanceof Error ? err.message : err), variant: 'destructive' });
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
