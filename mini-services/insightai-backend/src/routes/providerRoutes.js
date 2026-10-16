'use strict';

const express = require('express');
const router = express.Router();

const providerManager = require('../services/ai/providerManager');

/* Credential-free provider health (masked keys) */
router.get('/status', (_req, res) => {
  res.json({ success: true, data: providerManager.getStatus() });
});

/* One tiny live ping per provider (never reveals keys) */
router.post('/test', async (_req, res) => {
  const results = await providerManager.pingProviders();
  res.json({ success: true, data: { results, testedAt: new Date().toISOString() } });
});

module.exports = router;
