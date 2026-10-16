'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const config = require('../config');
const { ERROR_CODES, AppError } = require('../utils/errorCodes');
const fileProcessing = require('../services/fileProcessing.service');
const cleanService = require('../services/clean.service');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmp = config.paths.tmp;
    fs.mkdirSync(tmp, { recursive: true });
    cb(null, tmp);
  },
  filename: (_req, file, cb) => cb(null, `up_${Date.now()}_${Math.round(Math.random() * 1e6)}${path.extname(file.originalname || '')}`),
});

const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxFileSizeBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname) return cb(new AppError(ERROR_CODES.INVALID_FILE, { detail: 'File has no name.' }));
    cb(null, true);
  },
});

/* Upload */
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) throw new AppError(ERROR_CODES.INVALID_FILE, { detail: 'No file provided (field name must be "file").' });
    const result = fileProcessing.uploadFile(req.file);
    // Clean up multer tmp copy after copyFileSync in uploadFile
    fs.unlink(req.file.path, () => {});
    // Snapshot immediately so the dataset list shows row/col counts
    try {
      const snapshot = await fileProcessing.snapshotFile(result.fileId);
      result.snapshot = snapshot.fileType === 'IMAGE' || snapshot.fileType === 'VIDEO'
        ? { fileType: snapshot.fileType, bytes: snapshot.bytes, format: snapshot.format, width: snapshot.width, height: snapshot.height }
        : {
            fileType: snapshot.fileType,
            rowCount: snapshot.rowCount,
            colCount: snapshot.colCount,
            wordCount: snapshot.wordCount,
            chunkCount: snapshot.chunkCount,
            qualityScore: snapshot.profile && snapshot.profile.quality ? snapshot.profile.quality.qualityScore : null,
            issues: snapshot.profile && snapshot.profile.quality ? snapshot.profile.quality.issues.length : null,
          };
    } catch (snapErr) {
      result.snapshotError = String(snapErr.message || snapErr).slice(0, 300);
    }
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/* List / get / delete */
router.get('/', (_req, res) => {
  res.json({ success: true, data: fileProcessing.listFiles() });
});

router.get('/:fileId', (req, res) => {
  res.json({ success: true, data: fileProcessing.getFile(req.params.fileId) });
});

router.delete('/:fileId', (req, res) => {
  res.json({ success: true, data: fileProcessing.deleteFile(req.params.fileId) });
});

/* Snapshot (re-run deterministic profiling) */
router.post('/:fileId/snapshot', async (req, res, next) => {
  try {
    res.json({ success: true, data: await fileProcessing.snapshotFile(req.params.fileId) });
  } catch (err) { next(err); }
});

/* Analyze (full multi-layer pipeline) */
router.post('/:fileId/analyze', async (req, res, next) => {
  try {
    const { objective } = req.body || {};
    const result = await fileProcessing.analyzeFile(req.params.fileId, { objective });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

/* Row preview */
router.get('/:fileId/preview', async (req, res, next) => {
  try {
    const data = await fileProcessing.sampleRows(req.params.fileId, {
      version: req.query.version,
      n: req.query.rows,
      offset: req.query.offset,
    });
    res.json({ success: true, data });
  } catch (err) { next(err); }
});

/* Versions */
router.get('/:fileId/versions', async (req, res, next) => {
  try {
    res.json({ success: true, data: await cleanService.listVersions(req.params.fileId) });
  } catch (err) { next(err); }
});

/* Export cleaned CSV */
router.get('/:fileId/export/cleaned', async (req, res, next) => {
  try {
    const data = await cleanService.exportCsv(req.params.fileId, req.query.version);
    const entry = fileProcessing.getFile(req.params.fileId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cleaned_${entry.fileName.replace(/\.[^.]+$/, '')}.csv"`);
    res.send(data.csv);
  } catch (err) { next(err); }
});

/* XLSX report export (exceljs — original project dependency) */
router.get('/:fileId/export/report', async (req, res, next) => {
  try {
    const ExcelJS = require('exceljs');
    const analysis = require('../storage/manager').loadProcessedResult(req.params.fileId);
    if (!analysis) throw new AppError(ERROR_CODES.FILE_NOT_FOUND, { detail: 'Run analysis first.' });
    const wb = new ExcelJS.Workbook();
    wb.creator = 'InsightIQ';

    const ws1 = wb.addWorksheet('Overview');
    ws1.addRow(['InsightIQ Analysis Report']);
    ws1.addRow(['File', analysis.fileName]);
    ws1.addRow(['Rows', analysis.rowCount]);
    ws1.addRow(['Columns', analysis.colCount]);
    ws1.addRow(['Generated', new Date().toISOString()]);
    if (analysis.explanation && analysis.explanation.summary) ws1.addRow(['Summary', analysis.explanation.summary]);
    ws1.getRow(1).font = { bold: true, size: 14 };

    if (analysis.plan) {
      const ws2 = wb.addWorksheet('KPIs');
      ws2.addRow(['KPI', 'Value', 'Unit', 'Description']);
      for (const k of analysis.results.kpis) ws2.addRow([k.label, k.value, k.unit, k.description || '']);
      ws2.getRow(1).font = { bold: true };

      const ws3 = wb.addWorksheet('Findings');
      ws3.addRow(['Title', 'Statement', 'Why it matters', 'Limitation']);
      for (const f of (analysis.explanation.findings || [])) ws3.addRow([f.title, f.statement, f.why || '', f.limitation || '']);
      ws3.getRow(1).font = { bold: true };
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="insightiq_report_${req.params.fileId.slice(0, 8)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

module.exports = router;
