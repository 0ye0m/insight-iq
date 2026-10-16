'use strict';

const FILE_STATUSES = {
  UPLOADED: 'UPLOADED',
  VALIDATING: 'VALIDATING',
  PARSING: 'PARSING',
  CLEANING: 'CLEANING',
  ANALYZING: 'ANALYZING',
  INDEXING: 'INDEXING',
  READY: 'READY',
  FAILED: 'FAILED',
  EXPIRED: 'EXPIRED',
};

const FILE_CATEGORIES = {
  TABULAR: 'TABULAR',
  DOCUMENT: 'DOCUMENT',
  MIXED: 'MIXED',
  UNKNOWN: 'UNKNOWN',
};

class FileRegistry {
  constructor() {
    this._registry = new Map();
    this._locks = new Map();
  }

  register(fileId, meta) {
    const entry = {
      fileId,
      fileName: meta.fileName,
      extension: meta.extension,
      mimeType: meta.mimeType,
      category: meta.category || FILE_CATEGORIES.UNKNOWN,
      diskPath: meta.diskPath || null,
      status: FILE_STATUSES.UPLOADED,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      analysisResult: null,
      documentResult: null,
      chunks: null,
      cleaningLog: null,
    };
    this._registry.set(fileId, entry);
    return entry;
  }

  get(fileId) {
    return this._registry.get(fileId) || null;
  }

  updateStatus(fileId, status) {
    const entry = this._registry.get(fileId);
    if (!entry) return null;
    entry.status = status;
    entry.updatedAt = Date.now();
    return entry;
  }

  updateAnalysis(fileId, analysisResult) {
    const entry = this._registry.get(fileId);
    if (!entry) return null;
    entry.analysisResult = analysisResult;
    entry.status = FILE_STATUSES.READY;
    entry.updatedAt = Date.now();
    return entry;
  }

  updateDocument(fileId, documentResult) {
    const entry = this._registry.get(fileId);
    if (!entry) return null;
    entry.documentResult = documentResult;
    entry.status = FILE_STATUSES.READY;
    entry.updatedAt = Date.now();
    return entry;
  }

  markFailed(fileId, error) {
    const entry = this._registry.get(fileId);
    if (!entry) return null;
    entry.status = FILE_STATUSES.FAILED;
    entry.error = error;
    entry.updatedAt = Date.now();
    return entry;
  }

  acquireLock(fileId) {
    if (this._locks.has(fileId)) return false;
    this._locks.set(fileId, true);
    return true;
  }

  releaseLock(fileId) {
    this._locks.delete(fileId);
  }

  isLocked(fileId) {
    return this._locks.has(fileId);
  }

  remove(fileId) {
    this._locks.delete(fileId);
    return this._registry.delete(fileId);
  }

  cleanup(retentionMs) {
    const now = Date.now();
    const expired = [];
    for (const [fileId, entry] of this._registry) {
      if (now - entry.createdAt > retentionMs) {
        entry.status = FILE_STATUSES.EXPIRED;
        expired.push(fileId);
      }
    }
    for (const fid of expired) {
      this._registry.delete(fid);
      this._locks.delete(fid);
    }
    return expired.length;
  }

  get size() {
    return this._registry.size;
  }
}

module.exports = { FILE_STATUSES, FILE_CATEGORIES, FileRegistry };
