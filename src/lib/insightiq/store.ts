'use client';

import { create } from 'zustand';
import type {
  AnalysisResult,
  DocumentResult,
  FileItem,
  ChatMessage,
  ImageAnalysis,
  VideoAnalysis,
  UrlResult,
} from './types';

export type ViewId = 'dashboard' | 'upload' | 'analyze' | 'clean' | 'compare' | 'chat' | 'media';

interface InsightState {
  view: ViewId;
  setView: (v: ViewId) => void;

  files: FileItem[];
  filesLoadedOnce: boolean;
  setFiles: (files: FileItem[]) => void;
  upsertFile: (file: FileItem) => void;
  removeFile: (fileId: string) => void;

  activeFileId: string | null;
  setActiveFile: (fileId: string | null) => void;

  analysis: Record<string, AnalysisResult | DocumentResult>;
  setAnalysis: (fileId: string, result: AnalysisResult | DocumentResult) => void;

  imageAnalysis: Record<string, ImageAnalysis>;
  videoAnalysis: Record<string, VideoAnalysis>;
  urlResult: UrlResult | null;
  setImageAnalysis: (fileId: string, r: ImageAnalysis) => void;
  setVideoAnalysis: (fileId: string, r: VideoAnalysis) => void;
  setUrlResult: (r: UrlResult | null) => void;

  chat: Record<string, ChatMessage[]>;
  appendChat: (fileId: string, msg: ChatMessage) => void;
  clearChat: (fileId: string) => void;
}

export const useInsightStore = create<InsightState>((set) => ({
  view: 'dashboard',
  setView: (view) => set({ view }),

  files: [],
  filesLoadedOnce: false,
  setFiles: (files) => set({ files, filesLoadedOnce: true }),
  upsertFile: (file) =>
    set((s) => ({
      files: [file, ...s.files.filter((f) => f.fileId !== file.fileId)],
    })),
  removeFile: (fileId) =>
    set((s) => ({
      files: s.files.filter((f) => f.fileId !== fileId),
      activeFileId: s.activeFileId === fileId ? null : s.activeFileId,
    })),

  activeFileId: null,
  setActiveFile: (activeFileId) => set({ activeFileId }),

  analysis: {},
  setAnalysis: (fileId, result) => set((s) => ({ analysis: { ...s.analysis, [fileId]: result } })),

  imageAnalysis: {},
  videoAnalysis: {},
  urlResult: null,
  setImageAnalysis: (fileId, r) => set((s) => ({ imageAnalysis: { ...s.imageAnalysis, [fileId]: r } })),
  setVideoAnalysis: (fileId, r) => set((s) => ({ videoAnalysis: { ...s.videoAnalysis, [fileId]: r } })),
  setUrlResult: (urlResult) => set({ urlResult }),

  chat: {},
  appendChat: (fileId, msg) =>
    set((s) => ({ chat: { ...s.chat, [fileId]: [...(s.chat[fileId] || []), msg] } })),
  clearChat: (fileId) => set((s) => ({ chat: { ...s.chat, [fileId]: [] } })),
}));

export function activeFile(state: InsightState): FileItem | undefined {
  return state.files.find((f) => f.fileId === state.activeFileId);
}

/* ─── Session persistence (active dataset + view survive reloads) ─── */
const PERSIST_KEY = 'insightiq_session_v1';

export function persistSession(state: { activeFileId: string | null; view: ViewId }) {
  try {
    localStorage.setItem(PERSIST_KEY, JSON.stringify({ activeFileId: state.activeFileId, view: state.view }));
  } catch {
    /* ignore */
  }
}

export function restoreSession(): { activeFileId: string | null; view: ViewId } | null {
  try {
    const raw = localStorage.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed) {
      return { activeFileId: parsed.activeFileId ?? null, view: parsed.view ?? 'dashboard' };
    }
    return null;
  } catch {
    return null;
  }
}
