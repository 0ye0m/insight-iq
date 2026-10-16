'use strict';

const express = require('express');
const router = express.Router();

const cleanService = require('../services/clean.service');
const compareService = require('../services/compare.service');
const { ERROR_CODES, AppError } = require('../utils/errorCodes');

/* Cleaning */
router.get('/:fileId/clean/preview', async (req, res, next) => {
  try {
    res.json({ success: true, data: await cleanService.previewCleaning(req.params.fileId, req.query.version) });
  } catch (err) { next(err); }
});

router.post('/:fileId/clean/apply', async (req, res, next) => {
  try {
    const { operations } = req.body || {};
    res.json({ success: true, data: await cleanService.applyCleaning(req.params.fileId, operations) });
  } catch (err) { next(err); }
});

router.post('/:fileId/clean/reset', async (req, res, next) => {
  try {
    res.json({ success: true, data: await cleanService.resetCleaning(req.params.fileId) });
  } catch (err) { next(err); }
});

router.get('/:fileId/quality', async (req, res, next) => {
  try {
    res.json({ success: true, data: await cleanService.quality(req.params.fileId, req.query.version) });
  } catch (err) { next(err); }
});

/* Compare two datasets / versions */
router.post('/compare', async (req, res, next) => {
  try {
    const { fileIdA, versionA, fileIdB, versionB } = req.body || {};
    if (!fileIdA || !fileIdB) throw new AppError(ERROR_CODES.INVALID_FILE, { detail: 'Both fileIdA and fileIdB are required.' });
    res.json({ success: true, data: await compareService.compare({ fileIdA, versionA, fileIdB, versionB }) });
  } catch (err) { next(err); }
});

module.exports = router;
