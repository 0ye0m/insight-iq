'use client';

/**
 * API client for the InsightIQ Express mini-service (port 3030).
 * All requests go through the gateway using the XTransformPort query param,
 * relative paths only.
 */

import type {
  ApiResponse,
  HealthData,
  ProviderStatus,
  FileItem,
  UploadResult,
  AnalysisResult,
  DocumentResult,
  CleaningOp,
  CleanApplyResult,
  DatasetVersion,
  CompareResult,
  ChatMessage,
  ImageAnalysis,
  VideoAnalysis,
  UrlResult,
  QualityReport,
} from './types';

const PORT = 3030;
const TIMEOUT = 240_000;

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function url(path: string, query: Record<string, string | number | undefined> = {}): string {
  const params = new URLSearchParams({ XTransformPort: String(PORT) });
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  return `/api${path}?${params.toString()}`;
}

async function request<T>(path: string, init: RequestInit & { query?: Record<string, string | number | undefined> } = {}): Promise<T> {
  const { query, ...rest } = init;
  const res = await fetch(url(path, query), { ...rest, signal: AbortSignal.timeout(TIMEOUT) });
  let body: ApiResponse<T> | null = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok || !body || body.success === false) {
    throw new ApiError(
      body?.error?.code || 'NETWORK_ERROR',
      body?.error?.message || `Request failed (${res.status})`,
      res.status
    );
  }
  return body.data;
}

function get<T>(path: string, query?: Record<string, string | number | undefined>) {
  return request<T>(path, { method: 'GET', query });
}

function post<T>(path: string, body?: unknown, query?: Record<string, string | number | undefined>) {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    query,
  });
}

/* ─── Health + providers ─── */
export const fetchHealth = () => get<HealthData>('/health');
export const fetchProviderStatus = () => get<ProviderStatus>('/providers/status');
export const testProviders = () => post<{ results: Record<string, { ok: boolean; reason?: string; model?: string; latencyMs?: number }> }>('/providers/test');

/* ─── Files ─── */
export const listFiles = () => get<FileItem[]>('/files');
export const uploadFile = async (file: File): Promise<UploadResult> => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(url('/files/upload'), { method: 'POST', body: form, signal: AbortSignal.timeout(TIMEOUT) });
  const body = (await res.json()) as ApiResponse<UploadResult>;
  if (!res.ok || body.success === false) throw new ApiError(body?.error?.code || 'UPLOAD_FAILED', body?.error?.message || 'Upload failed', res.status);
  return body.data;
};
export const deleteFile = (fileId: string) => request<{ deleted: string }>(`/files/${fileId}`, { method: 'DELETE' });

export const analyzeFile = (fileId: string, objective: string) =>
  post<AnalysisResult | DocumentResult>(`/files/${fileId}/analyze`, { objective: objective || '' });

export const previewRows = (fileId: string, rows = 25, offset = 0) =>
  get<{ columns: string[]; rows: (string | null)[][]; total: number; offset: number }>(`/files/${fileId}/preview`, { rows, offset });

export const listVersions = (fileId: string) => get<{ versions: DatasetVersion[]; currentVersion: number }>(`/files/${fileId}/versions`);

export const exportCleanedCsv = async (fileId: string) => {
  const res = await fetch(url(`/files/${fileId}/export/cleaned`));
  if (!res.ok) throw new ApiError('EXPORT_FAILED', 'Export failed', res.status);
  const blob = await res.blob();
  downloadBlob(blob, `insightiq_cleaned_${fileId.slice(0, 8)}.csv`);
};

export const exportReport = async (fileId: string) => {
  const res = await fetch(url(`/files/${fileId}/export/report`));
  if (!res.ok) throw new ApiError('EXPORT_FAILED', 'Report export failed (run analysis first)', res.status);
  const blob = await res.blob();
  downloadBlob(blob, `insightiq_report_${fileId.slice(0, 8)}.xlsx`);
};

function downloadBlob(blob: Blob, filename: string) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(u);
}

/* ─── Cleaning ─── */
export const previewCleaning = (fileId: string) => get<{ version: number; operations: CleaningOp[] }>(`/data/${fileId}/clean/preview`);
export const applyCleaning = (fileId: string, operations: string[]) => post<CleanApplyResult>(`/data/${fileId}/clean/apply`, { operations });
export const resetCleaning = (fileId: string) => post<{ reset: boolean; reason?: string }>(`/data/${fileId}/clean/reset`);
export const fetchQuality = (fileId: string, version?: number) => get<QualityReport>(`/data/${fileId}/quality`, { version });

/* ─── Compare ─── */
export const compareDatasets = (a: { fileId: string; version?: number }, b: { fileId: string; version?: number }) =>
  post<CompareResult>('/data/compare', { fileIdA: a.fileId, versionA: a.version, fileIdB: b.fileId, versionB: b.version });

/* ─── Chat ─── */
export const sendChat = (fileId: string, question: string, history: { role: string; content: string }[]) =>
  post<{ answer: string; sources?: string[]; grounded?: string; intent?: string; provider?: string | null }>('/chat', { fileId, question, history });

/* ─── Media ─── */
export const analyzeImage = (fileId: string) => post<ImageAnalysis>(`/media/image/${fileId}/analyze`);
export const analyzeVideo = (fileId: string) => post<VideoAnalysis>(`/media/video/${fileId}/analyze`);
export const analyzeUrl = (u: string) => post<UrlResult>('/media/url', { url: u });
export const frameImageUrl = (fileId: string, name: string) => url(`/media/${fileId}/frames/${name}`);
