'use strict';

const express = require('express');
const router = express.Router();

const config = require('../config');

router.get('/', async (_req, res) => {
  let analytics = 'unavailable';
  let analyticsVersion = null;
  try {
    const { execFileSync } = require('child_process');
    analyticsVersion = execFileSync(config.analytics.pythonPath, ['--version'], { stdio: 'pipe', timeout: 5000 }).toString().trim();
    const { invokePython } = require('../workers/pythonWorker');
    await invokePython('ping', {});
    analytics = 'available';
  } catch {
    analytics = 'unavailable';
  }

  const providers = config.providers;
  const aiConfigured = providers.gemini.keys.length > 0 || providers.groq.keys.length > 0;

  res.json({
    success: true,
    data: {
      status: analytics === 'available' ? 'healthy' : 'degraded',
      service: 'insightai-backend',
      version: '2.0.0',
      analyticsEngine: analytics,
      analyticsPythonVersion: analyticsVersion,
      aiProvidersConfigured: aiConfigured,
      aiProviderKeys: { gemini: providers.gemini.keys.length, groq: providers.groq.keys.length },
      ffmpeg: await new Promise((resolve) => {
        const { execFile } = require('child_process');
        execFile('ffmpeg', ['-version'], { timeout: 5000 }, (err) => resolve(err ? 'unavailable' : 'available'));
      }),
      environment: config.env,
    },
  });
});

module.exports = router;
