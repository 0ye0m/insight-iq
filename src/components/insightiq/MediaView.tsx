'use client';

import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { useInsightStore } from '@/lib/insightiq/store';
import { analyzeImage, analyzeVideo, analyzeUrl, frameImageUrl, deleteFile, listFiles } from '@/lib/insightiq/api';
import { ApiError } from '@/lib/insightiq/api';
import type { ImageAnalysis, VideoAnalysis, UrlResult } from '@/lib/insightiq/types';
import { fmtBytes } from '@/lib/insightiq/format';
import { SectionTitle, EmptyState, LoadingBlock, ErrorBlock, InfoNote } from './ui-bits';
import { ImageIcon, Film, Link2, Sparkles, Trash2, ScanSearch, Clock, Volume2, VolumeX, Captions } from 'lucide-react';

export default function MediaView() {
  const { files, setFiles, activeFileId, setActiveFile, setView, imageAnalysis, videoAnalysis, setImageAnalysis, setVideoAnalysis, urlResult, setUrlResult } = useInsightStore();
  const { toast } = useToast();
  const [listLoaded, setListLoaded] = React.useState(false);

  React.useEffect(() => {
    listFiles()
      .then((all) => setFiles(all))
      .catch(() => undefined)
      .finally(() => setListLoaded(true));
  }, []);

  const mediaFiles = files.filter((f) => f.category === 'IMAGE' || f.category === 'VIDEO');
  const file = mediaFiles.find((f) => f.fileId === activeFileId) || mediaFiles[0];

  const [imageUrl, setImageUrl] = React.useState('');
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const runImage = async (fileId: string) => {
    setBusy('image');
    setError(null);
    try {
      const res = await analyzeImage(fileId);
      setImageAnalysis(fileId, res);
      if (!res.aiAvailable) toast({ title: 'Vision model unavailable', description: res.aiError || 'Configure a working Gemini or Groq key to enable image understanding.', variant: 'destructive' });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Image analysis failed.';
      setError(msg);
      toast({ title: 'Image analysis failed', description: msg, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const runVideo = async (fileId: string) => {
    setBusy('video');
    setError(null);
    try {
      const res = await analyzeVideo(fileId);
      setVideoAnalysis(fileId, res);
      toast({ title: 'Video analyzed', description: `${res.frames.length} frames extracted${res.transcript.available ? ', transcript available' : ''}.` });
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Video analysis failed.';
      setError(msg);
      toast({ title: 'Video analysis failed', description: msg, variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  const runUrl = async () => {
    if (!imageUrl.trim()) return;
    setBusy('url');
    setError(null);
    try {
      const res = await analyzeUrl(imageUrl.trim());
      setUrlResult(res);
      if (res.kind === 'youtube') {
        toast({ title: 'YouTube metadata fetched', description: res.accessible ? 'Public metadata only — upload the file for full analysis.' : res.reason || 'Not accessible.' });
      } else if (res.kind === 'page') {
        toast({ title: 'Page text extracted', description: `${res.wordCount} words readable.` });
      } else {
        toast({ title: `${res.kind} downloaded and analyzed` });
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'URL analysis failed.';
      setError(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <SectionTitle>Media understanding</SectionTitle>

      {/* URL input */}
      <Card className="rounded-xl shadow-sm">
        <CardContent className="flex flex-col gap-3 p-4 sm:flex-row">
          <div className="flex-1">
            <label htmlFor="media-url" className="text-xs font-medium text-muted-foreground">
              Public link — YouTube, direct image/video URL, or web page
            </label>
            <Input
              id="media-url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
              className="mt-1.5 rounded-lg"
              onKeyDown={(e) => e.key === 'Enter' && runUrl()}
            />
          </div>
          <Button className="btn-gradient-primary rounded-lg sm:mt-5" onClick={runUrl} disabled={busy === 'url'}>
            <Link2 className="mr-2 h-4 w-4" /> {busy === 'url' ? 'Fetching…' : 'Analyze link'}
          </Button>
        </CardContent>
      </Card>

      {error && <ErrorBlock message={error} />}
      {busy && <LoadingBlock label={busy === 'video' ? 'Extracting frames with ffmpeg, then analyzing with the vision model…' : busy === 'image' ? 'Analyzing with the vision model…' : 'Fetching what is publicly accessible…'} />}

      {/* URL result */}
      {urlResult && !busy && <UrlReport result={urlResult} />}

      {/* Media file selector */}
      {mediaFiles.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {mediaFiles.map((f) => (
            <button
              key={f.fileId}
              onClick={() => setActiveFile(f.fileId)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                file?.fileId === f.fileId ? 'border-primary bg-primary/5 text-foreground' : 'text-muted-foreground hover:border-primary/40'
              }`}
            >
              {f.category === 'IMAGE' ? <ImageIcon className="h-3.5 w-3.5" /> : <Film className="h-3.5 w-3.5" />}
              {f.fileName}
            </button>
          ))}
        </div>
      )}

      {/* Selected file analysis */}
      {file ? (
        file.category === 'IMAGE' ? (
          <ImageReport fileId={file.fileId} fileName={file.fileName} analysis={imageAnalysis[file.fileId]} busy={busy === 'image'} onRun={() => runImage(file.fileId)} />
        ) : (
          <VideoReport fileId={file.fileId} fileName={file.fileName} analysis={videoAnalysis[file.fileId]} busy={busy === 'video'} onRun={() => runVideo(file.fileId)} />
        )
      ) : (
        <EmptyState
          title="No media files uploaded yet"
          hint="Upload an image or video in the Upload tab — or paste a link above. Images get description, objects, OCR and Q&A; videos get frame sampling, timeline and transcripts when available."
          action={
            <Button className="btn-gradient-primary rounded-lg" onClick={() => setView('upload')}>
              Upload media
            </Button>
          }
        />
      )}

      <InfoNote>
        Images and video frames are only sent to the configured vision model when you press Analyze. Files stay local
        otherwise; transcription is attempted via a local service and simply reported as unavailable if it is not reachable.
      </InfoNote>
    </div>
  );
}

function ImageReport({
  fileId,
  fileName,
  analysis,
  busy,
  onRun,
}: {
  fileId: string;
  fileName: string;
  analysis?: ImageAnalysis;
  busy: boolean;
  onRun: () => void;
}) {
  return (
    <Card className="rounded-xl shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <ImageIcon className="h-4 w-4 text-primary" /> {fileName}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {!analysis && !busy && (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">Run the vision analysis to describe what is visible, extract text and identify the subject — with explicit uncertainty.</p>
            <Button className="btn-gradient-primary mt-3 rounded-lg" onClick={onRun}>
              <ScanSearch className="mr-2 h-4 w-4" /> Analyze image
            </Button>
          </div>
        )}
        {busy && <LoadingBlock label="Looking at the image…" />}
        {analysis && !busy && (
          analysis.analysis ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
                <p className="mt-1 text-sm leading-6">{analysis.analysis.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant="outline" className="rounded-md text-[10px]">{analysis.analysis.category}</Badge>
                  {analysis.analysis.colors?.slice(0, 5).map((c) => (
                    <Badge key={c} variant="secondary" className="rounded-md text-[10px]">{c}</Badge>
                  ))}
                </div>
              </div>

              {analysis.analysis.objects?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Visible objects</p>
                  <div className="mt-1.5 grid gap-1.5 sm:grid-cols-2">
                    {analysis.analysis.objects.map((o, i) => (
                      <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                        <span className="font-medium">{o.name}</span>
                        <span className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate max-w-[180px]">{o.attributes}</span>
                          <Badge variant="secondary" className="rounded-md text-[10px]">{Math.round((o.confidence || 0) * 100)}%</Badge>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {analysis.analysis.text && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Text found (OCR)</p>
                  <pre className="mt-1.5 max-h-40 overflow-auto scroll-slim whitespace-pre-wrap rounded-lg border bg-secondary/40 p-3 text-xs">{analysis.analysis.text}</pre>
                </div>
              )}

              {analysis.analysis.interpretation && (
                <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-primary">Likely subject (with uncertainty)</p>
                  <p className="mt-1 text-sm">{analysis.analysis.interpretation.likelySubject}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    confidence {Math.round((analysis.analysis.interpretation.confidence || 0) * 100)}% — {analysis.analysis.interpretation.reasoning}
                  </p>
                </div>
              )}

              {analysis.analysis.limitations && <InfoNote>{analysis.analysis.limitations}</InfoNote>}
              <p className="text-[11px] text-muted-foreground">
                Analyzed by {analysis.provider || '—'} · {analysis.model || '—'}. Ask follow-up questions in the Chat tab.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm text-destructive">{analysis.aiError || 'Vision analysis unavailable.'}</p>
              <p className="mt-1 text-xs text-muted-foreground">Configure a working Gemini or Groq vision key in the server environment, then retry.</p>
            </div>
          )
        )}
      </CardContent>
    </Card>
  );
}

function VideoReport({
  fileId,
  fileName,
  analysis,
  busy,
  onRun,
}: {
  fileId: string;
  fileName: string;
  analysis?: VideoAnalysis;
  busy: boolean;
  onRun: () => void;
}) {
  if (!analysis && !busy) {
    return (
      <Card className="rounded-xl shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-semibold">
            <Film className="h-4 w-4 text-primary" /> {fileName}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Extracts keyframes with ffmpeg (sampled, capped), describes them with the vision model, detects scenes into a timeline, and reports subtitles/audio availability.
            </p>
            <Button className="btn-gradient-primary mt-3 rounded-lg" onClick={onRun}>
              <Sparkles className="mr-2 h-4 w-4" /> Analyze video
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  if (busy) return <LoadingBlock label="Extracting frames with ffmpeg, then analyzing with the vision model…" />;

  return (
    <Card className="rounded-xl shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <Film className="h-4 w-4 text-primary" /> {fileName}
          <Badge variant="outline" className="rounded-md text-[10px]"><Clock className="mr-1 h-3 w-3" />{analysis?.info.durationSec}s</Badge>
          {analysis?.info.width && <Badge variant="outline" className="rounded-md text-[10px]">{analysis.info.width}×{analysis.info.height}</Badge>}
          {analysis?.info.hasAudio ? <Volume2 className="h-3.5 w-3.5 text-emerald-500" /> : <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />}
          {analysis?.subtitles.available && <Captions className="h-3.5 w-3.5 text-emerald-500" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</p>
          <p className="mt-1 text-sm leading-6">{analysis?.synthesis.summary}</p>
        </div>

        {analysis?.synthesis.subjects?.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {analysis.synthesis.subjects.map((s, i) => (
              <Badge key={i} variant="secondary" className="rounded-md">{s}</Badge>
            ))}
          </div>
        )}

        {analysis?.synthesis.timeline && analysis.synthesis.timeline.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Timeline</p>
            <div className="mt-2 max-h-64 space-y-2 overflow-y-auto scroll-slim pr-1">
              {analysis.synthesis.timeline.map((t, i) => (
                <div key={i} className="flex gap-3 rounded-lg border p-2.5 text-sm">
                  <Badge variant="outline" className="h-fit shrink-0 rounded-md font-mono text-[10px]">{t.timestamp}</Badge>
                  <span className="text-sm leading-5">{t.event}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Frames strip */}
        {analysis?.frames && analysis.frames.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Extracted frames ({analysis.frames.length})</p>
            <div className="mt-2 flex gap-2 overflow-x-auto scroll-slim pb-1">
              {analysis.frames.map((f) => (
                <figure key={f.file} className="shrink-0">
                  <img
                    src={frameImageUrl(fileId, f.file)}
                    alt={`Frame at ${f.timestamp}`}
                    className="h-24 rounded-lg border object-cover"
                    loading="lazy"
                  />
                  <figcaption className="mt-1 text-center text-[10px] text-muted-foreground">{f.timestamp}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        {analysis?.transcript.available && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Transcript</p>
            <pre className="mt-1.5 max-h-40 overflow-auto scroll-slim whitespace-pre-wrap rounded-lg border bg-secondary/40 p-3 text-xs">{analysis.transcript.text}</pre>
          </div>
        )}

        {analysis?.synthesis.limitations && <InfoNote>{analysis.synthesis.limitations}</InfoNote>}
      </CardContent>
    </Card>
  );
}

function UrlReport({ result }: { result: UrlResult }) {
  const isYouTube = result.kind === 'youtube';
  return (
    <Card className="rounded-xl shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Link2 className="h-4 w-4 text-primary" /> {result.title || result.url}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline" className="rounded-md text-[10px]">{result.kind}</Badge>
          {isYouTube && (
            <Badge variant="outline" className={`rounded-md text-[10px] ${result.accessible ? 'border-emerald-500/40 text-emerald-600' : 'border-destructive/40 text-destructive'}`}>
              {result.accessible ? 'public metadata available' : 'not accessible'}
            </Badge>
          )}
          {result.author && <Badge variant="secondary" className="rounded-md text-[10px]">{result.author}</Badge>}
          {result.wordCount != null && <Badge variant="secondary" className="rounded-md text-[10px]">{result.wordCount} words</Badge>}
        </div>

        {isYouTube && (
          <InfoNote>
            {result.processingNote} {!result.accessible && result.reason}
          </InfoNote>
        )}

        {result.kind === 'page' && result.text && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Extracted page text (first 1500 chars)</p>
            <pre className="mt-1.5 max-h-52 overflow-auto scroll-slim whitespace-pre-wrap rounded-lg border bg-secondary/40 p-3 text-xs">{result.text.slice(0, 1500)}</pre>
          </div>
        )}

        {result.analysis && 'analysis' in result && (
          <p className="text-xs text-muted-foreground">Media downloaded ({fmtBytes(result.analysis?.fileSize || 0)}) and analyzed — see the result above.</p>
        )}
      </CardContent>
    </Card>
  );
}
