'use strict';

const express = require('express');
const router = express.Router();

const { chat } = require('../services/ai/chat.service');

router.post('/', async (req, res, next) => {
  try {
    const { fileId, question, history, mediaEvidence } = req.body || {};
    const result = await chat({ fileId, question, history, mediaEvidence });
    res.json({ success: true, data: result });
  } catch (err) { next(err); }
});

module.exports = router;
