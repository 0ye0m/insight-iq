'use strict';

/**
 * Main orchestration service — implements the multi-layer AI architecture:
 *   L0 modality detection (validator) → L1 deterministic profile (python snapshot)
 *   → L2 AI planner → L3 plan validation (repair loop) → L4 deterministic execution
 *   → L5 evidence-grounded explanation → L6 optional critic → L7 UI selection data
 *   → (chat = L8)
 * Every layer has a deterministic fallback when AI is unavailable.
 */

const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');
const { ERROR_CODES, AppError } = require('../utils/errorCodes');
const { validateUpload, validateMagicOnDisk } = require('../validators/fileValidator');
const { sanitizeFilename, detectCategory } = require('../utils/fileSecurity');
const { FileRegistry, FILE_STATUSES } = require('../models/fileState');
const storage = require('../storage/manager');
const { invokePython } = require('../workers/pythonWorker');
const { generatePlan } = require('./ai/planner');
const { validatePlan } = require('./ai/planValidator');
const { explain, deterministicSummary } = require('./ai/explainer');
const { critique } = require('./ai/critic');

const registry = new FileRegistry();

/* ─── Upload (L0) ─────────────────────────────────────────────────── */

function uploadFile(file) {
  const validation = validateUpload(file);
  const fileId = uuidv4();
  const safeName = sanitizeFilename(file.originalname);

  const diskPath = storage.storagePath(fileId, validation.extension);
  fs.copyFileSync(file.path, diskPath);
  validateMagicOnDisk(diskPath, validation.extension);

  const entry = registry.register(fileId, {
    fileName: safeName,
    extension: validation.extension,
    mimeType: file.mimetype,
    category: validation.category,
    diskPath,
  });

  logger.info({ fileId, extension: validation.extension, category: validation.category }, 'File uploaded');
  return {
    fileId,
    fileName: safeName,
    originalName: safeName,
    fileSize: file.size,
    extension: validation.extension,
    mimeType: validation.mimeType,
    category: validation.category,
    status: FILE_STATUSES.UPLOADED,
    uploadedAt: new Date().toISOString(),
  };
}

/** Media metadata snapshot (no tabular/document parsing) */
function snapshotMedia(fileId) {
  const entry = registry.get(fileId);
  if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
  const bytes = fs.existsSync(entry.diskPath) ? fs.statSync(entry.diskPath).size : 0;
  let meta = { bytes };
  if (entry.category === 'IMAGE') {
    try {
      const { execFileSync } = require('child_process');
      const out = execFileSync('python3', ['-c', `from PIL import Image; im = Image.open(${JSON.stringify(entry.diskPath)}); print(im.format, im.size[0], im.size[1], im.mode)`], { timeout: 10000 }).toString().trim();
      const [format, w, h, mode] = out.split(/\s+/);
      meta = { bytes, format, width: parseInt(w, 10), height: parseInt(h, 10), mode };
    } catch (e) {
      meta = { bytes, note: 'metadata unavailable' };
    }
  } else if (entry.category === 'VIDEO') {
    try {
      const { probeVideo, extractVideoInfo } = require('./media/video.service');
      // async probe wrapped — keep it sync-free by deferring to analyze; quick ffprobe here:
      meta = { bytes, note: 'full probe runs during analysis' };
    } catch { /* keep minimal */ }
  }
  entry.fileType = entry.category;
  entry.snapshot = { fileType: entry.category, ...meta };
  return {
    fileType: entry.category,
    fileId,
    format: entry.extension,
    ...meta,
  };
}

/* ─── Snapshot (L1): parse + persist v1 + deterministic profile ───── */

async function snapshotFile(fileId) {
  const entry = registry.get(fileId);
  if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
  if (entry.category === 'IMAGE' || entry.category === 'VIDEO') {
    return snapshotMedia(fileId);
  }

  // Idempotent: if a dataset store already exists, reuse it (survives restarts
  // and preserves cleaning history). Only refresh the entry snapshot.
  const existingMeta = storage.getDatasetMeta(fileId);
  if (existingMeta && existingMeta.versions && existingMeta.versions.length > 0) {
    const profileResult = await invokePython('profile', { fileId, version: existingMeta.currentVersion }).catch(() => null);
    const profile = profileResult ? profileResult.data : null;
    const snap = {
      fileType: existingMeta.fileType || (profile ? 'TABULAR' : 'DOCUMENT'),
      fileId,
      format: entry.extension,
      rowCount: profile ? profile.rowCount : existingMeta.versions[existingMeta.versions.length - 1].rows,
      colCount: profile ? profile.colCount : existingMeta.versions[existingMeta.versions.length - 1].cols,
      columns: profile ? profile.columns.map((c) => c.name) : [],
      profile,
      versionHash: existingMeta.versions[existingMeta.currentVersion - 1] ? existingMeta.versions[existingMeta.currentVersion - 1].hash : '',
    };
    entry.snapshot = snap;
    entry.fileType = snap.fileType;
    return snap;
  }

  if (!registry.acquireLock(fileId)) throw new AppError(ERROR_CODES.PROCESSING_IN_PROGRESS);
  try {
    registry.updateStatus(fileId, FILE_STATUSES.PARSING);
    const result = await invokePython('snapshot', {
      fileId,
      filePath: entry.diskPath,
      format: entry.extension,
      category: entry.category,
      fileName: entry.fileName,
    });
    const data = result.data;
    registry.updateStatus(fileId, FILE_STATUSES.READY);
    entry.fileType = data.fileType;
    entry.snapshot = data;
    return data;
  } catch (err) {
    registry.markFailed(fileId, err.message);
    throw err;
  } finally {
    registry.releaseLock(fileId);
  }
}

/* ─── Full analysis pipeline (L2–L7) ──────────────────────────────── */

async function analyzeFile(fileId, { objective } = {}) {
  const entry = registry.get(fileId);
  if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);

  // 1. ensure snapshot exists (L1); cached analysis short-circuits only when
  //    objective matches or is unchanged
  let snapshot = entry.snapshot;
  if (!snapshot) {
    snapshot = await snapshotFile(fileId);
  }
  const meta = storage.getDatasetMeta(fileId);
  const version = meta ? meta.currentVersion : 1;
  const versionHash = meta && meta.versions[v0Idx(version)] ? meta.versions[v0Idx(version)].hash : '';

  // AI cache lookup includes the objective
  const cachedAnalysis = storage.loadProcessedResult(fileId);
  if (cachedAnalysis && cachedAnalysis.version === version && (cachedAnalysis.objective || '') === (objective || '')) {
    return { ...cachedAnalysis, fromCache: true };
  }

  if (!registry.acquireLock(fileId)) throw new AppError(ERROR_CODES.PROCESSING_IN_PROGRESS);
  try {
    if (snapshot.fileType === 'DOCUMENT') {
      const result = await analyzeDocumentPipeline(fileId, entry, snapshot, objective);
      storage.saveProcessedResult(fileId, result);
      registry.updateAnalysis(fileId, result);
      return result;
    }

    registry.updateStatus(fileId, FILE_STATUSES.ANALYZING);

    // L1 profile — deterministic
    const profileResult = await invokePython('profile', { fileId, version });
    const profile = profileResult.data;
    if (profile.rowCount === 0) throw new AppError(ERROR_CODES.EMPTY_DATASET);

    // L2 planner (AI, optional)
    let planResult = await generatePlan(profile, objective, 'TABULAR', versionHash);
    let plan = planResult.plan;

    // L3 validation + bounded repair
    let validated = validatePlan(plan, profile);
    const repairLog = [];
    if (plan && !validated.valid && validated.repairs.length > 0 && planResult.provider) {
      // one bounded repair attempt: send invalid entries back with the profile
      repairLog.push(`initial validation: ${validated.repairs.length} invalid item(s)`);
      planResult = await generatePlan(profile, `${objective || ''} [NOTE: your previous plan referenced missing columns/ops: ${validated.repairs.slice(0, 6).join('; ')}. Only use the listed columns.]`, 'TABULAR', versionHash);
      plan = planResult.plan;
      if (plan) validated = validatePlan(plan, profile);
    }
    let finalPlan;
    let plannerMeta = { provider: planResult.provider, model: planResult.model, cached: planResult.cached || false, repairs: validated.repairs || [], warnings: validated.warnings || [], repairLog };
    if (validated.valid && validated.plan) {
      finalPlan = validated.plan;
    } else {
      // Deterministic fallback plan (L3 fallback)
      const fb = await invokePython('fallback_plan', { fileId, version });
      finalPlan = fb.data.plan;
      plannerMeta.fallback = true;
      if (planResult.aiError) plannerMeta.aiError = planResult.aiError;
    }
    finalPlan.datasetSummary = finalPlan.datasetSummary || (profile.quality ? `${profile.rowCount} rows × ${profile.colCount} columns; quality score ${profile.quality.qualityScore}/100.` : '');
    finalPlan.notes = finalPlan.notes || '';

    // L4 deterministic execution
    const execResult = await invokePython('execute_plan', { fileId, version, plan: finalPlan });
    const results = execResult.data;

    // L5 evidence-grounded explanation (AI, optional)
    let explanation = await explain(finalPlan, results, profile, versionHash);

    // L6 optional critic — only for high-risk findings
    let criticMeta = { applied: false };
    try {
      const crit = await critique(explanation.explanation, results, profile, versionHash);
      if (crit.explanation) explanation.explanation = crit.explanation;
      criticMeta = { applied: crit.applied, provider: crit.provider || null, reason: crit.reason || null, verdictCount: crit.verdictCount || 0 };
    } catch (e) {
      criticMeta = { applied: false, reason: String(e.message || e) };
    }

    // L7 selection data: relevance already encoded via plan priorities
    const finalResult = {
      fileId,
      fileName: entry.fileName,
      fileType: 'TABULAR',
      format: entry.extension,
      objective: objective || '',
      version,
      versionHash,
      rowCount: profile.rowCount,
      colCount: profile.colCount,
      columns: profile.columns.map((c) => c.name),
      profile,
      plan: finalPlan,
      planner: plannerMeta,
      results,
      explanation: explanation.explanation,
      explainer: { provider: explanation.provider, model: explanation.model, cached: explanation.cached || false, aiError: explanation.aiError || null },
      critic: criticMeta,
      aiAvailable: Boolean(explanation.provider || planResult.provider),
      completedAt: new Date().toISOString(),
    };
    storage.saveProcessedResult(fileId, finalResult);
    registry.updateAnalysis(fileId, finalResult);
    logger.info({ fileId, kpis: finalPlan.kpis.length, charts: finalPlan.charts.length, tests: finalPlan.tests.length }, 'Analysis complete');
    return finalResult;
  } catch (err) {
    registry.markFailed(fileId, err.message);
    throw err;
  } finally {
    registry.releaseLock(fileId);
  }
}

/* ─── Document pipeline (L1 + chunking + optional AI summary) ─────── */

async function analyzeDocumentPipeline(fileId, entry, snapshot, objective) {
  registry.updateStatus(fileId, FILE_STATUSES.INDEXING);
  const infoResult = await invokePython('document_info', { fileId });
  const info = infoResult.data || {};
  const doc = info.document || {};

  let summary = null;
  let summaryProvider = null;
  try {
    const aiCache = require('./ai/aiCache');
    const res = await aiCache.cachedRunJSON('doc_summary', 'summary', { op: 'doc_summary', hash: fileId + (info.chunkCount || 0), text: (doc.fullText || '').slice(0, 12000) }, {
      system: 'You summarize documents for an analytics platform. Ground every statement in the provided text; if something is not in the text, do not mention it. Respond with ONLY JSON: {"summary": "3-5 sentences", "keyPoints": ["..."], "topics": ["..."], "limitations": "what this document does not contain or null"}.',
      user: `DOCUMENT "${entry.fileName}" (type: ${doc.documentType || snapshot.format}, ${snapshot.wordCount} words):\n\n${(doc.fullText || '').slice(0, 12000)}`,
      temperature: 0.2,
      maxTokens: 900,
      label: 'doc-summary',
    });
    summary = res.data;
    summaryProvider = res.provider;
  } catch (e) {
    summary = {
      summary: `Document parsed locally: ${snapshot.wordCount} words, ${info.chunkCount || 0} searchable chunks. AI summary unavailable.`,
      keyPoints: (snapshot.sectionsPreview || []).map((s) => s.title).filter(Boolean).slice(0, 5),
      topics: [],
      limitations: 'AI provider unavailable — showing deterministic extraction only.',
    };
  }

  return {
    fileId,
    fileName: entry.fileName,
    fileType: 'DOCUMENT',
    format: entry.extension,
    objective: objective || '',
    documentType: doc.documentType || snapshot.format,
    totalPages: doc.totalPages || 0,
    textLength: snapshot.textLength,
    wordCount: snapshot.wordCount,
    chunkCount: info.chunkCount || 0,
    metadata: doc.metadata || {},
    sectionsPreview: snapshot.sectionsPreview || [],
    summary,
    summaryProvider,
    aiAvailable: Boolean(summaryProvider),
    completedAt: new Date().toISOString(),
  };
}

/* ─── Listing / status / delete ───────────────────────────────────── */

function listFiles() {
  const items = [];
  for (const entry of registry._registry.values()) {
    items.push({
      fileId: entry.fileId,
      fileName: entry.fileName,
      category: entry.category,
      fileType: entry.fileType || null,
      status: entry.status,
      createdAt: new Date(entry.createdAt).toISOString(),
      snapshot: entry.snapshot ? {
        rowCount: entry.snapshot.rowCount,
        colCount: entry.snapshot.colCount,
        wordCount: entry.snapshot.wordCount,
        chunkCount: entry.snapshot.chunkCount,
      } : null,
    });
  }
  return items.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
}

function getFile(fileId) {
  const entry = registry.get(fileId);
  if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
  return {
    fileId: entry.fileId,
    fileName: entry.fileName,
    category: entry.category,
    fileType: entry.fileType || null,
    status: entry.status,
    error: entry.error || null,
    createdAt: new Date(entry.createdAt).toISOString(),
    snapshot: entry.snapshot || null,
  };
}

function deleteFile(fileId) {
  const entry = registry.get(fileId);
  if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
  storage.cleanupFile(fileId);
  registry.remove(fileId);
  logger.info({ fileId }, 'File deleted');
  return { deleted: fileId };
}

function v0Idx(v) {
  return Math.max(0, parseInt(v, 10) - 1);
}

/**
 * Rehydrate the in-memory registry from disk after a process restart.
 * Scans the processed datasets directory and matches uploads by fileId prefix.
 */
function rehydrateRegistry() {
  try {
    const fs2 = require('fs');
    const procDir = require('path').resolve(__dirname, '../../data/processed');
    if (!fs2.existsSync(procDir)) return 0;
    let count = 0;
    for (const dir of fs2.readdirSync(procDir)) {
      const meta = storage.getDatasetMeta(dir);
      if (!meta || !meta.versions || meta.versions.length === 0) continue;
      // find the uploaded original file
      const uploadsDir = config.paths.uploads;
      const matches = fs2.existsSync(uploadsDir) ? fs2.readdirSync(uploadsDir).filter((f) => f.startsWith(dir)) : [];
      if (matches.length === 0) continue;
      const diskPath = path.join(uploadsDir, matches[0]);
      const extension = path.extname(matches[0]);
      const { detectCategory } = require('../utils/fileSecurity');
      const category = detectCategory(extension) || 'UNKNOWN';
      try {
        const entry = registry.register(dir, {
          fileName: meta.fileName || dir,
          extension,
          mimeType: 'application/octet-stream',
          category,
          diskPath,
        });
        entry.createdAt = new Date(meta.versions[0].createdAt || Date.now()).getTime();
        entry.fileType = fs2.existsSync(path.join(require('path').resolve(__dirname, '../../data/processed'), dir, 'doc.json')) ? 'DOCUMENT' : 'TABULAR';
        entry.snapshot = null; // lazily re-snapshotted
        count += 1;
      } catch (e) {
        logger.warn({ fileId: dir, err: String(e) }, 'Rehydration skip');
      }
    }
    if (count > 0) logger.info({ count }, 'Registry rehydrated from disk');

    // Re-register uploaded media (images/video) that have no processed dataset
    try {
      const uploadsDir = config.paths.uploads;
      if (fs2.existsSync(uploadsDir)) {
        const { detectCategory } = require('../utils/fileSecurity');
        for (const f of fs2.readdirSync(uploadsDir)) {
          const fid = path.basename(f, path.extname(f));
          if (registry.get(fid)) continue;
          const category = detectCategory(path.extname(f));
          if (category !== 'IMAGE' && category !== 'VIDEO') continue;
          const entry = registry.register(fid, {
            fileName: fid.slice(0, 8) + path.extname(f),
            extension: path.extname(f),
            mimeType: category === 'IMAGE' ? 'image/png' : 'video/mp4',
            category,
            diskPath: path.join(uploadsDir, f),
          });
          entry.fileType = category;
          count += 1;
        }
      }
    } catch (e) {
      logger.warn({ err: String(e) }, 'Media rehydration skipped');
    }
    return count;
  } catch (e) {
    logger.warn({ err: String(e) }, 'Registry rehydration failed');
    return 0;
  }
}

/* ─── Preview rows ────────────────────────────────────────────────── */

async function sampleRows(fileId, { version, n = 25, offset = 0 }) {
  const entry = registry.get(fileId);
  if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
  if (entry.snapshot && entry.snapshot.fileType === 'DOCUMENT') {
    throw new AppError(ERROR_CODES.INVALID_DATASET, { detail: 'Row preview is only available for tabular data.' });
  }
  const res = await invokePython('sample_rows', { fileId, version, n: Math.min(parseInt(n, 10) || 25, 200), offset: Math.max(parseInt(offset, 10) || 0, 0) });
  return res.data;
}

module.exports = {
  registry,
  uploadFile,
  snapshotFile,
  snapshotMedia,
  analyzeFile,
  listFiles,
  getFile,
  deleteFile,
  sampleRows,
  rehydrateRegistry,
};
