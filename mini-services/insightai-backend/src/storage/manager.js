'use strict';

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger');

/** Ensure all storage directories exist */
function ensureDirs() {
  for (const dir of Object.values(config.paths)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function storagePath(fileId, extension) {
  const safeName = `${fileId}${extension}`;
  return path.join(config.paths.uploads, safeName);
}

/** Dataset store: data/processed/{fileId}/meta.json + v{n}.pkl snapshots */
function datasetDir(fileId) {
  return path.join(config.paths.processed, fileId);
}

function datasetMetaPath(fileId) {
  return path.join(datasetDir(fileId), 'meta.json');
}

function datasetVersionPath(fileId, version) {
  return path.join(datasetDir(fileId), `v${version}.pkl`);
}

function documentPath(fileId) {
  return path.join(datasetDir(fileId), 'doc.json');
}

function chunksPath(fileId) {
  return path.join(datasetDir(fileId), 'chunks.json');
}

function mediaDir(fileId) {
  return path.join(config.paths.media, fileId);
}

function readJson(p) {
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch { return null; }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data), 'utf-8');
}

function getDatasetMeta(fileId) {
  return readJson(datasetMetaPath(fileId));
}

function saveDatasetMeta(fileId, meta) {
  writeJson(datasetMetaPath(fileId), meta);
}

/** Register a new dataset version snapshot; returns version number */
function addDatasetVersion(fileId, { opsApplied = [], rows, cols, hash }) {
  const meta = getDatasetMeta(fileId) || { fileId, versions: [], currentVersion: 0 };
  const version = meta.versions.length + 1;
  meta.versions.push({
    version,
    opsApplied,
    rows,
    cols,
    hash,
    createdAt: new Date().toISOString(),
  });
  meta.currentVersion = version;
  saveDatasetMeta(fileId, meta);
  return version;
}

function setCurrentVersion(fileId, version) {
  const meta = getDatasetMeta(fileId);
  if (!meta) return null;
  meta.currentVersion = version;
  saveDatasetMeta(fileId, meta);
  return meta;
}

/** Remove all artifacts for a file */
function cleanupFile(fileId) {
  const dirs = [config.paths.uploads, config.paths.processed, config.paths.chunks, config.paths.media, config.paths.cache];
  for (const dir of dirs) {
    try {
      const entries = fs.readdirSync(dir);
      for (const f of entries) {
        if (f.startsWith(fileId) || f === fileId) {
          const full = path.join(dir, f);
          const stat = fs.statSync(full);
          if (stat.isDirectory()) fs.rmSync(full, { recursive: true, force: true });
          else fs.unlinkSync(full);
        }
      }
    } catch (err) {
      logger.warn({ err, fileId, dir }, 'Cleanup warning');
    }
  }
}

function saveProcessedResult(fileId, data) {
  writeJson(path.join(config.paths.processed, `${fileId}.analysis.json`), data);
}

function loadProcessedResult(fileId) {
  return readJson(path.join(config.paths.processed, `${fileId}.analysis.json`));
}

function deleteProcessedResult(fileId) {
  const p = path.join(config.paths.processed, `${fileId}.analysis.json`);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function saveChunks(fileId, chunks) {
  writeJson(chunksPath(fileId), chunks);
}

function loadChunks(fileId) {
  return readJson(chunksPath(fileId));
}

function saveDocument(fileId, doc) {
  writeJson(documentPath(fileId), doc);
}

function loadDocument(fileId) {
  return readJson(documentPath(fileId));
}

/* ─── AI cache (versioned, disk-backed) ─── */
function cachePath(hash) {
  return path.join(config.paths.cache, `${hash}.json`);
}

function getCache(hash) {
  const data = readJson(cachePath(hash));
  if (!data) return null;
  return data;
}

function setCache(hash, data) {
  writeJson(cachePath(hash), { ...data, cachedAt: new Date().toISOString() });
}

module.exports = {
  ensureDirs,
  storagePath,
  datasetDir,
  datasetMetaPath,
  datasetVersionPath,
  getDatasetMeta,
  saveDatasetMeta,
  addDatasetVersion,
  setCurrentVersion,
  cleanupFile,
  saveProcessedResult,
  loadProcessedResult,
  deleteProcessedResult,
  saveChunks,
  loadChunks,
  saveDocument,
  loadDocument,
  mediaDir,
  getCache,
  setCache,
  readJson,
  writeJson,
};
