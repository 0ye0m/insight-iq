'use strict';

const express = require('express');
const router = express.Router();

const { ERROR_CODES, AppError } = require('../utils/errorCodes');
const { registry } = require('../services/fileProcessing.service');
const imageService = require('../services/media/image.service');
const videoService = require('../services/media/video.service');
const urlService = require('../services/media/url.service');
const storage = require('../storage/manager');

/* Analyze an uploaded image */
router.post('/image/:fileId/analyze', async (req, res, next) => {
  try {
    const entry = registry.get(req.params.fileId);
    if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
    if (entry.category !== 'IMAGE') throw new AppError(ERROR_CODES.INVALID_DATASET, { detail: 'This file is not an image.' });
    res.json({ success: true, data: await imageService.analyzeImage(entry.fileId, entry.diskPath, entry.mimeType, entry.fileName) });
  } catch (err) { next(err); }
});

/* Analyze an uploaded video */
router.post('/video/:fileId/analyze', async (req, res, next) => {
  try {
    const entry = registry.get(req.params.fileId);
    if (!entry) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
    if (entry.category !== 'VIDEO') throw new AppError(ERROR_CODES.INVALID_DATASET, { detail: 'This file is not a video.' });
    res.json({ success: true, data: await videoService.analyzeVideo(entry.fileId, entry.diskPath, entry.fileName) });
  } catch (err) { next(err); }
});

/* List extracted frame files (served as base64 data URLs to keep media private) */
router.get('/:fileId/frames/:name', async (req, res, next) => {
  try {
    const { fileId, name } = req.params;
    if (!/^[\w.-]+$/.test(name) || ((!name.startsWith('frame_') || !name.endsWith('.jpg')) && name !== 'subtitles.srt')) {
      throw new AppError(ERROR_CODES.INVALID_FILE, { detail: 'Invalid frame name.' });
    }
    const p = require('path').join(storage.mediaDir(fileId), name);
    if (!require('fs').existsSync(p)) throw new AppError(ERROR_CODES.FILE_NOT_FOUND);
    if (name.endsWith('.srt')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.send(require('fs').readFileSync(p, 'utf-8'));
    }
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(require('fs').readFileSync(p));
  } catch (err) { next(err); }
});

/* URL ingestion: classify, fetch what is legitimately accessible */
router.post('/url', async (req, res, next) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') throw new AppError(ERROR_CODES.INVALID_FILE, { detail: 'A "url" field is required.' });
    const result = await urlService.analyzeUrl(url.trim());

    if (result.kind === 'youtube' || result.kind === 'page') {
      return res.json({ success: true, data: result });
    }

    // downloaded media → analyze via the same pipelines as uploads
    const { v4: uuidv4 } = require('uuid');
    const { sanitizeFilename, validateMagicBytes } = require('../utils/fileSecurity');
    const fileId = uuidv4();
    const reg = registry;
    const category = result.kind === 'image' ? 'IMAGE' : 'VIDEO';
    const name = sanitizeFilename(new URL(url).pathname.split('/').pop() || `${result.kind}_download${result.downloaded.extension}`);
    const diskPath = result.downloaded.path;
    const magic = validateMagicBytes(diskPath, result.downloaded.extension === '.jpg' ? '.jpg' : result.downloaded.extension);
    if (!magic.valid && !magic.skipped) throw new AppError(ERROR_CODES.FILE_CORRUPTED, { detail: magic.reason });
    reg.register(fileId, { fileName: name, extension: result.downloaded.extension, mimeType: result.downloaded.contentType || category, category, diskPath });

    let analysis;
    if (category === 'IMAGE') analysis = await imageService.analyzeImage(fileId, diskPath, result.downloaded.contentType || 'image/png', name);
    else analysis = await videoService.analyzeVideo(fileId, diskPath, name);

    res.json({ success: true, data: { ...result, kind: result.kind, fileId, fileName: name, analysis } });
  } catch (err) { next(err); }
});

module.exports = router;
