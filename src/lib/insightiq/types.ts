/* ─── Shared types between the React frontend and the Express backend ─── */

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

export interface HealthData {
  status: 'healthy' | 'degraded';
  service: string;
  analyticsEngine: 'available' | 'unavailable';
  analyticsPythonVersion?: string;
  aiProvidersConfigured: boolean;
  aiProviderKeys: { gemini: number; groq: number };
  ffmpeg: string;
  environment: string;
}

export interface ProviderKeyStatus {
  slot: number;
  masked: string;
  validity?: 'unknown' | 'valid' | 'invalid';
  requests: number;
  tokensIn: number;
  tokensOut: number;
  rateLimitHits: number;
  coolingDown: boolean;
  cooldownSecondsRemaining: number;
  lastError: string | null;
  lastUsedAt: string | null;
}

export interface ProviderStatus {
  providers: Record<
    string,
    {
      configured: boolean;
      models: string[];
      keys: ProviderKeyStatus[];
      mode?: string;
      note?: string;
    }
  >;
  budget: { day: string; used: number; limit: number };
  note: string;
}

export interface FileItem {
  fileId: string;
  fileName: string;
  category: string;
  fileType: 'TABULAR' | 'DOCUMENT' | 'IMAGE' | 'VIDEO' | null;
  status: string;
  createdAt: string;
  snapshot?: {
    fileType?: string;
    rowCount?: number;
    colCount?: number;
    wordCount?: number;
    chunkCount?: number;
    qualityScore?: number | null;
    issues?: number | null;
  } | null;
  snapshotError?: string;
}

export interface UploadResult {
  fileId: string;
  fileName: string;
  fileSize: number;
  category: string;
  status: string;
  snapshot?: FileItem['snapshot'];
  snapshotError?: string;
}

export interface ColumnProfile {
  name: string;
  dtype: string;
  semanticType: string;
  totalValues: number;
  missingCount: number;
  missingPct: number;
  uniqueCount: number;
  sampleValues: string[];
  isConstant: boolean;
  isIdLike: boolean;
  min?: number | string;
  max?: number | string;
  mean?: number;
  median?: number;
  std?: number;
  sum?: number;
  topValues?: { value: string; count: number; percentage: number }[];
}

export interface QualityReport {
  qualityScore: number;
  grade: string;
  scoreBreakdown: Record<string, number>;
  missingCells: number;
  missingPct: number;
  duplicateRows: number;
  duplicatePct: number;
  constantColumns: number;
  mixedTypeColumns: number;
  invalidDates: number;
  whitespaceCells: number;
  suspectedOutliers: number;
  idLikeColumns: string[];
  totalRows: number;
  totalColumns: number;
  issues: QualityIssue[];
}

export interface QualityIssue {
  id: string;
  type: string;
  severity: 'low' | 'medium' | 'high';
  column: string | null;
  count: number;
  description: string;
}

export interface ProfileData {
  rowCount: number;
  colCount: number;
  columns: ColumnProfile[];
  typeMap: Record<string, string>;
  statistics: Record<string, Record<string, unknown>>;
  correlations: CorrelationPair[];
  quality: QualityReport;
  timeRange: { column: string; min: string; max: string; distinctDays: number } | null;
  samples: string[][];
  version?: number;
  versionHash?: string;
}

export interface CorrelationPair {
  columnA: string;
  columnB: string;
  correlation: number;
  absCorrelation: number;
  direction: string;
  strength: string;
}

/* ─── Plan + results ─── */
export interface PlanKpi {
  id: string;
  label: string;
  kind: 'aggregate' | 'grouped' | 'derived';
  column?: string;
  aggregate?: string;
  group?: { by: string; column: string; aggregate: string; limit: number };
  formula?: { op: string; numerator?: { column: string; aggregate: string }; denominator?: { column: string; aggregate: string }; value?: number };
  unit: string;
  description: string;
  priority: number;
}

export interface PlanChart {
  id: string;
  type: 'line' | 'area' | 'bar' | 'stacked_bar' | 'pie' | 'donut' | 'histogram' | 'box' | 'scatter';
  title: string;
  reason: string;
  x: { column: string; bin: string };
  y: { column: string | null; aggregate: string };
  series: { column: string; max: number } | null;
  limit: number;
  priority: number;
}

export interface PlanTest {
  id: string;
  type: 'correlation' | 'ttest' | 'chi2';
  columns: string[];
  description: string;
}

export interface AnalysisPlan {
  objectives: string[];
  datasetSummary: string;
  kpis: PlanKpi[];
  charts: PlanChart[];
  tests: PlanTest[];
  cleaningFocus: string[];
  notes: string;
}

export interface KpiResult extends PlanKpi {
  value: number | string | null;
  error?: string;
  result: {
    groups?: { name: string; value: number | null; share?: number }[];
    total?: number | null;
    formula?: unknown;
    numerator?: number;
    denominator?: number;
    sourceColumn?: string;
    aggregate?: string;
  };
}

export interface ChartResult extends PlanChart {
  result: {
    data: Record<string, unknown>[];
    xLabel: string;
    yLabel: string;
    seriesKeys: string[] | null;
    extremes?: Record<string, unknown>;
    bins?: number;
    correlation?: number | null;
    sampleSize?: number;
    totalSize?: number;
  } | null;
  error?: string;
}

export interface TestResult extends PlanTest {
  result: Record<string, unknown> | null;
  error?: string;
}

export interface Finding {
  id: string;
  title: string;
  statement: string;
  evidence: { ref: string; value: string | number }[];
  why: string | null;
  limitation: string | null;
}

export interface Explanation {
  summary: string;
  findings: Finding[];
  followUps: string[];
  criticOverall?: string;
}

export interface AnalysisResult {
  fileId: string;
  fileName: string;
  fileType: 'TABULAR' | 'DOCUMENT';
  objective: string;
  version: number;
  versionHash: string;
  rowCount: number;
  colCount: number;
  columns: string[];
  profile: ProfileData;
  plan: AnalysisPlan;
  planner: {
    provider: string | null;
    model: string | null;
    fallback?: boolean;
    repairs: string[];
    warnings: string[];
    aiError?: string;
  };
  results: { kpis: KpiResult[]; charts: ChartResult[]; tests: TestResult[] };
  explanation: Explanation;
  explainer: { provider: string | null; model: string | null };
  critic: { applied: boolean; provider?: string | null; reason?: string | null; verdictCount?: number };
  aiAvailable: boolean;
  completedAt: string;
}

export interface DocumentResult {
  fileId: string;
  fileName: string;
  fileType: 'DOCUMENT';
  documentType: string;
  totalPages: number;
  textLength: number;
  wordCount: number;
  chunkCount: number;
  metadata: Record<string, unknown>;
  sectionsPreview: { title: string; preview: string }[];
  summary: { summary: string; keyPoints: string[]; topics: string[]; limitations: string | null };
  summaryProvider: string | null;
  aiAvailable: boolean;
  completedAt: string;
}

/* ─── Cleaning ─── */
export interface CleaningOp {
  id: string;
  type: string;
  label: string;
  description: string;
  column: string | null;
  affectedCount: number;
  detail: string;
}

export interface CleanApplyResult {
  appliedVersion: number;
  parentVersion: number;
  operationsApplied: string[];
  details: Record<string, Record<string, unknown>>;
  before: QualityReport;
  after: QualityReport;
  rowCountBefore: number;
  rowCountAfter: number;
}

export interface DatasetVersion {
  version: number;
  opsApplied: string[];
  rows: number;
  cols: number;
  hash: string;
  createdAt: string;
}

/* ─── Compare ─── */
export interface CompareResult {
  labels: { a: string; b: string };
  shape: { rowsA: number; rowsB: number; rowDelta: number; colsA: number; colsB: number; colDelta: number };
  quality: {
    scoreA: number;
    scoreB: number;
    delta: number;
    gradeA: string;
    gradeB: string;
    missingPctA: number;
    missingPctB: number;
    duplicateRowsA: number;
    duplicateRowsB: number;
    rowsRetained: number;
  };
  schema: {
    commonColumns: { column: string; typeA: string; typeB: string; compatible: boolean }[];
    onlyInA: { column: string; type: string }[];
    onlyInB: { column: string; type: string }[];
    typeIssues: { column: string; typeA: string; typeB: string }[];
  };
  numeric: {
    column: string;
    meanA: number | null;
    meanB: number | null;
    meanDelta: number | null;
    medianA: number | null;
    medianB: number | null;
    minA: number | null;
    maxA: number | null;
    minB: number | null;
    maxB: number | null;
  }[];
  missingness: { column: string; missingPctA: number; missingPctB: number; delta: number }[];
  categorical: { column: string; uniqueA: number; uniqueB: number; distributionDistance: number; topA: { value: string; pct: number }[]; topB: { value: string; pct: number }[] }[];
  dates: { column: string; minA: string | null; maxA: string | null; minB: string | null; maxB: string | null }[];
  records: { matched: boolean; keyColumn?: string; inA?: number; inB?: number; added?: number; removed?: number; common?: number; reason?: string };
}

/* ─── Chat ─── */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  sources?: string[];
  grounded?: string;
  intent?: string;
  provider?: string | null;
  ts: number;
}

/* ─── Media ─── */
export interface ImageAnalysis {
  fileId: string;
  fileName: string;
  fileType: 'IMAGE';
  analysis: {
    description: string;
    category: string;
    objects: { name: string; attributes: string; confidence: number }[];
    text: string;
    colors: string[];
    interpretation: { likelySubject: string; confidence: number; reasoning: string };
    quality: Record<string, string>;
    limitations: string;
  } | null;
  provider: string | null;
  model: string | null;
  aiError: string | null;
  aiAvailable: boolean;
}

export interface VideoAnalysis {
  fileId: string;
  fileName: string;
  fileType: 'VIDEO';
  info: {
    durationSec: number;
    width: number | null;
    height: number | null;
    fps: number | null;
    codec: string | null;
    hasAudio: boolean;
    hasSubtitleStream: boolean;
    sizeBytes: number | null;
  };
  frames: { timestamp: string; file: string }[];
  frameDescriptions: { timestamp: string; description: string; visibleText: string; objects: string[] }[];
  subtitles: { available: boolean; text: string | null };
  transcript: { available: boolean; text?: string; reason?: string };
  synthesis: {
    summary: string;
    subjects: string[];
    activities: string[];
    timeline: { timestamp: string; event: string }[];
    transcriptSummary: string | null;
    limitations: string;
  };
  provider: string | null;
  aiAvailable: boolean;
  aiError: string | null;
}

export interface UrlResult {
  kind: 'youtube' | 'page' | 'image' | 'video';
  url: string;
  videoId?: string;
  title?: string;
  author?: string;
  thumbnail?: string;
  accessible?: boolean;
  reason?: string;
  processingNote?: string;
  text?: string;
  textLength?: number;
  wordCount?: number;
  fileId?: string;
  analysis?: ImageAnalysis | VideoAnalysis;
}
