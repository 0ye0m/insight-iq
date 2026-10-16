'use strict';

/**
 * Cleaning service — deterministic operations proposed by the Python engine,
 * approved by the user, applied into a NEW versioned snapshot (original data
 * is never mutated). Returns before/after quality comparison.
 */

const logger = require('../utils/logger');
const { ERROR_CODES, AppError } = require('../utils/errorCodes');
const { invokePython } = require('../workers/pythonWorker');
const { registry } = require('./fileProcessing.service');
const storage = require('../storage/manager');

async function previewCleaning(fileId, version) {
  const entry = registry.get(fileId);
  if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
  const res = await invokePython('clean_preview', { fileId, version });
  return res.data;
}

const MAX_OPS = 12;

async function applyCleaning(fileId, operations) {
  const entry = registry.get(fileId);
  if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new AppError(ERROR_CODES.INVALID_FILE, { detail: 'No cleaning operations selected.' });
  }
  const safeOps = operations.slice(0, MAX_OPS).map((o) => String(o).replace(/[^a-z_]/gi, '')).filter(Boolean);
  if (safeOps.length === 0) throw new AppError(ERROR_CODES.INVALID_FILE, { detail: 'Invalid operation ids.' });

  const res = await invokePython('clean_apply', { fileId, operations: safeOps });
  const data = res.data;
  logger.info({ fileId, applied: data.appliedVersion, ops: data.operationsApplied }, 'Cleaning applied');
  // invalidate any cached analysis for this dataset
  storage.deleteProcessedResult(fileId);
  const entryRef = registry.get(fileId);
  if (entryRef) entryRef.snapshot = null; // force re-profile on next analyze
  return data;
}

async function resetCleaning(fileId) {
  const entry = registry.get(fileId);
  if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
  const res = await invokePython('clean_reset', { fileId });
  if (res.data && res.data.reset) {
    storage.deleteProcessedResult(fileId);
    entry.snapshot = null;
  }
  return res.data;
}

async function listVersions(fileId) {
  const entry = registry.get(fileId);
  if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
  const res = await invokePython('versions', { fileId });
  return res.data;
}

async function quality(fileId, version) {
  const entry = registry.get(fileId);
  if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
  const res = await invokePython('quality', { fileId, version });
  return res.data;
}

async function exportCsv(fileId, version) {
  const entry = registry.get(fileId);
  if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
  const res = await invokePython('export_csv', { fileId, version });
  return res.data;
}

module.exports = { previewCleaning, applyCleaning, resetCleaning, listVersions, quality, exportCsv };
