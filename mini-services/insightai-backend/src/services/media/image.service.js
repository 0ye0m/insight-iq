'use strict';

/**
 * Image understanding — Google-Lens-like experience.
 * Uses a vision-capable model (verified capabilities only) on the uploaded
 * image. Describes what is visible; extracts text/OCR; never invents identities
 * without evidence. Images are processed only for this analysis.
 */

const fs = require('fs');
const path = require('path');
const { ERROR_CODES, AppError } = require('../../utils/errorCodes');
const { runJSON } = require('../ai/providerManager');
const aiCache = require('../ai/aiCache');
const logger = require('../../utils/logger');

const VISION_SYSTEM = `You are InsightIQ's image analysis engine. Describe ONLY what is actually visible in the image.

Rules:
1. Do not invent names, titles, people, locations or brands unless they are visibly written in the image or unmistakable. When unsure, express uncertainty explicitly ("appears to be", "likely").
2. Distinguish: directly visible facts vs plausible interpretation. Put interpretation in "interpretation" with a confidence value.
3. Extract any visible text verbatim into "text".
4. If the image is a document/screenshot, structure the extracted text.
5. Never identify specific real people by name from faces.

Respond with ONLY valid JSON:
{
  "description": "2-3 sentence factual description of what is visible",
  "category": "best-guess category (e.g. photograph, chart, screenshot, document, poster, product photo, artwork)",
  "objects": [{"name":"...","attributes":"color/size/position/notes","confidence":0.0-1.0}],
  "text": "all visible text verbatim (OCR), empty string if none",
  "colors": ["dominant colors as words"],
  "interpretation": {"likelySubject": "what this probably shows (with uncertainty)", "confidence": 0.0-1.0, "reasoning": "why"},
  "quality": {"lighting":"...","composition":"...","notes":"..."},
  "limitations": "anything that could not be determined"
}`;

async function analyzeImage(fileId, diskPath, mimeType, fileName) {
  const base64 = fs.readFileSync(diskPath).toString('base64');
  const bytes = fs.statSync(diskPath).size;
  if (bytes > 20 * 1024 * 1024) throw new AppError(ERROR_CODES.FILE_TOO_LARGE, { detail: 'Image exceeds 20MB.' });

  const hash = require('crypto').createHash('sha256').update(base64).digest('hex').slice(0, 16);
  const payload = { op: 'image_analysis', hash };

  let analysis = null;
  let provider = null;
  let model = null;
  let aiError = null;
  try {
    const cached = aiCache.hashPayload('image_analysis', payload);
    const hit = require('../../storage/manager').getCache(cached);
    if (hit && hit.data) {
      analysis = hit.data;
      provider = hit.provider;
      model = hit.model;
    } else {
      const res = await runJSON('vision', {
        system: VISION_SYSTEM,
        user: `Analyze this image ("${fileName}"). Respond with the JSON structure from your instructions.`,
        images: [{ mimeType: mimeType || 'image/png', base64 }],
        jsonMode: true,
        temperature: 0.2,
        maxTokens: 1600,
        label: 'image-analysis',
      });
      analysis = res.data;
      provider = res.provider;
      model = res.model;
      require('../../storage/manager').setCache(cached, { op: 'image_analysis', data: analysis, provider, model });
    }
  } catch (err) {
    aiError = String(err.message || err).slice(0, 300);
    logger.warn({ err: aiError, fileId }, 'Image analysis failed');
  }

  return {
    fileId,
    fileName,
    fileType: 'IMAGE',
    fileSize: bytes,
    analysis,
    provider,
    model,
    aiError,
    aiAvailable: Boolean(analysis),
    hash,
    completedAt: new Date().toISOString(),
  };
}

module.exports = { analyzeImage };
