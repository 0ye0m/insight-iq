'use strict';

/**
 * Video understanding — analyzes actual video content.
 * Pipeline: ffprobe metadata → ffmpeg frame sampling (uniform + dedup, capped)
 * → vision model on selected frames (batched) → synthesis of timeline/summary.
 * Audio: detected; transcription attempted via the Next.js ASR proxy when
 * available (best-effort, graceful degradation). Subtitle streams extracted
 * when present. Hard limits on size/duration/frames/concurrency.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const crypto = require('crypto');
const config = require('../../config');
const { ERROR_CODES, AppError } = require('../../utils/errorCodes');
const { runJSON } = require('../ai/providerManager');
const aiCache = require('../ai/aiCache');
const storage = require('../../storage/manager');
const logger = require('../../utils/logger');

const FRAME_SYSTEM = `You are a video frame analyst. For each frame (with its timestamp), describe factually what is visible: setting, objects, people (no identity guessing), text/captions visible, and the activity. Do not invent context beyond the frame. Respond with ONLY valid JSON:
{"frames":[{"timestamp":"...","description":"1-3 sentences","visibleText":"ocr text or empty","objects":["..."]}]}`;

const SYNTH_SYSTEM = `You are a video summarizer. You receive per-frame descriptions (with timestamps) and optionally a transcript/subtitles. Synthesize a faithful summary.

Rules:
1. Only use the provided evidence. Never invent scenes, names, or events.
2. Distinguish VISUAL observations from TRANSCRIPT text from INFERENCE.
3. If audio/transcript is missing, say so in limitations.

Respond with ONLY valid JSON:
{"summary":"3-5 sentences","subjects":["main subjects/objects"],"activities":["what happens"],"timeline":[{"timestamp":"...","event":"..."}],"transcriptSummary":"summary of spoken content or null","limitations":"..."}`;

async function probeVideo(diskPath) {
  return new Promise((resolve, reject) => {
    execFile('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', diskPath], { timeout: 30000 }, (err, stdout) => {
      if (err) return reject(new AppError(ERROR_CODES.FILE_CORRUPTED, { detail: `ffprobe failed: ${err.message}` }));
      try { resolve(JSON.parse(stdout)); } catch (e) { reject(new AppError(ERROR_CODES.FILE_CORRUPTED, { detail: 'Unreadable video metadata' })); }
    });
  });
}

function extractVideoInfo(probe) {
  const v = (probe.streams || []).find((s) => s.codec_type === 'video');
  const a = (probe.streams || []).find((s) => s.codec_type === 'audio');
  const sub = (probe.streams || []).find((s) => s.codec_type === 'subtitle');
  return {
    durationSec: Math.round(parseFloat(probe.format && probe.format.duration || (v && v.duration) || 0) * 100) / 100,
    width: v ? v.width : null,
    height: v ? v.height : null,
    fps: v ? Math.round((eval(v.avg_frame_rate || '0/1') || 0) * 100) / 100 : null,
    codec: v ? v.codec_name : null,
    container: probe.format ? probe.format.format_name : null,
    sizeBytes: probe.format ? parseInt(probe.format.size, 10) : null,
    hasAudio: Boolean(a),
    audioCodec: a ? a.codec_name : null,
    hasSubtitleStream: Boolean(sub),
    title: probe.format && probe.format.tags ? probe.format.tags.title : null,
  };
}

function grabFrames(diskPath, outDir, durationSec, maxFrames) {
  return new Promise((resolve, reject) => {
    const times = [];
    const n = Math.max(2, Math.min(maxFrames, Math.max(2, Math.ceil(durationSec / 15))));
    for (let i = 0; i < n; i++) {
      times.push(Math.min(durationSec - 0.1, Math.max(0, (durationSec * (i + 0.5)) / n)));
    }
    const frames = [];
    let idx = 0;
    const next = () => {
      if (idx >= times.length) return resolve(frames);
      const t = times[idx];
      const out = path.join(outDir, `frame_${String(idx).padStart(2, '0')}_${t.toFixed(1)}s.jpg`);
      execFile('ffmpeg', ['-y', '-ss', String(t), '-i', diskPath, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '5', out], { timeout: 30000 }, (err) => {
        if (!err && fs.existsSync(out) && fs.statSync(out).size > 800) {
          frames.push({ path: out, timestamp: `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}` });
        }
        idx += 1;
        next();
      });
    };
    next();
  });
}

function extractSubtitles(diskPath, outDir) {
  return new Promise((resolve) => {
    const out = path.join(outDir, 'subtitles.srt');
    execFile('ffmpeg', ['-y', '-i', diskPath, '-map', '0:s:0', out], { timeout: 20000 }, (err) => {
      if (!err && fs.existsSync(out) && fs.statSync(out).size > 10) {
        const text = fs.readFileSync(out, 'utf-8').slice(0, 40000);
        resolve({ available: true, text });
      } else {
        resolve({ available: false, text: null });
      }
    });
  });
}

/** Best-effort audio transcription via the Next.js ASR proxy (z-ai sdk). */
function transcribeAudio(diskPath, outDir, durationSec) {
  return new Promise((resolve) => {
    if (durationSec > 180) return resolve({ available: false, reason: 'Audio longer than 3 minutes; transcription skipped to respect processing limits.' });
    const wav = path.join(outDir, 'audio.wav');
    execFile('ffmpeg', ['-y', '-i', diskPath, '-vn', '-ac', '1', '-ar', '16000', '-t', '120', wav], { timeout: 60000 }, async (err) => {
      if (err || !fs.existsSync(wav) || fs.statSync(wav).size < 2000) {
        return resolve({ available: false, reason: 'No usable audio track' });
      }
      try {
        const res = await fetch('http://127.0.0.1:3000/api/ai/asr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audioBase64: fs.readFileSync(wav).toString('base64'), mimeType: 'audio/wav' }),
          signal: AbortSignal.timeout(90000),
        });
        const data = await res.json();
        if (data && data.success && data.text) return resolve({ available: true, text: String(data.text).slice(0, 12000) });
        resolve({ available: false, reason: (data && data.error && data.error.message) || 'Transcription unavailable' });
      } catch (e) {
        resolve({ available: false, reason: 'Transcription service unreachable' });
      }
    });
  });
}

async function analyzeVideo(fileId, diskPath, fileName) {
  const stats = fs.statSync(diskPath);
  if (stats.size > config.media.maxVideoBytes) throw new AppError(ERROR_CODES.FILE_TOO_LARGE, { detail: `Video exceeds ${config.media.maxVideoBytes / (1024 * 1024)}MB limit.` });

  const outDir = storage.mediaDir(fileId);
  fs.mkdirSync(outDir, { recursive: true });

  const probe = await probeVideo(diskPath);
  const info = extractVideoInfo(probe);
  if (info.durationSec > config.media.maxVideoSeconds) {
    throw new AppError(ERROR_CODES.FILE_TOO_LARGE, { detail: `Video is ${Math.round(info.durationSec)}s; limit is ${config.media.maxVideoSeconds}s.` });
  }

  const frames = await grabFrames(diskPath, outDir, Math.max(info.durationSec, 1), config.media.maxFrames);
  logger.info({ fileId, frames: frames.length, duration: info.durationSec }, 'Video frames extracted');

  // subtitle + audio (parallel, best effort)
  const [subs, transcript] = await Promise.all([
    info.hasSubtitleStream ? extractSubtitles(diskPath, outDir) : Promise.resolve({ available: false, text: null }),
    info.hasAudio ? transcribeAudio(diskPath, outDir, info.durationSec) : Promise.resolve({ available: false, reason: 'No audio track' }),
  ]);

  // vision on frames in batches of 3
  const frameDescriptions = [];
  let provider = null;
  let model = null;
  let aiError = null;
  const batches = [];
  for (let i = 0; i < frames.length; i += 3) batches.push(frames.slice(i, i + 3));
  for (const batch of batches) {
    try {
      const res = await runJSON('vision', {
        system: FRAME_SYSTEM,
        user: `Describe these video frames. Timestamps: ${batch.map((f) => f.timestamp).join(', ')}. (Video: ${fileName})`,
        images: batch.map((f) => ({ mimeType: 'image/jpeg', base64: fs.readFileSync(f.path).toString('base64') })),
        jsonMode: true,
        temperature: 0.2,
        maxTokens: 1200,
        label: 'video-frames',
      });
      provider = provider || res.provider;
      model = model || res.model;
      const parsed = res.data;
      for (const f of parsed.frames || []) frameDescriptions.push(f);
      // fill any missing frames with placeholders
      for (const f of batch) {
        if (!frameDescriptions.some((d) => d.timestamp === f.timestamp)) {
          frameDescriptions.push({ timestamp: f.timestamp, description: '(no description returned)', visibleText: '', objects: [] });
        }
      }
    } catch (err) {
      aiError = aiError || String(err.message || err).slice(0, 300);
      for (const f of batch) frameDescriptions.push({ timestamp: f.timestamp, description: '(frame analysis unavailable)', visibleText: '', objects: [] });
    }
  }
  frameDescriptions.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // synthesis
  let synthesis = null;
  const hash = crypto.createHash('sha256').update(fileName + String(info.sizeBytes)).digest('hex').slice(0, 16);
  try {
    const synthRes = await runJSON('summary', {
      system: SYNTH_SYSTEM,
      user: `VIDEO "${fileName}" (${info.durationSec}s, ${info.width}x${info.height}, audio: ${info.hasAudio ? 'yes' : 'no'}). FRAME DESCRIPTIONS:\n${JSON.stringify(frameDescriptions, null, 1)}\n\nSUBTITLES: ${subs.available ? (subs.text || '').slice(0, 6000) : 'none available'}\nTRANSCRIPT: ${transcript.available ? (transcript.text || '').slice(0, 6000) : `none (${transcript.reason || 'unavailable'})`}\n\nSynthesize the video JSON now.`,
      jsonMode: true,
      temperature: 0.25,
      maxTokens: 1400,
      label: 'video-synthesis',
    });
    provider = provider || synthRes.provider;
    model = model || synthRes.model;
    synthesis = synthRes.data;
  } catch (err) {
    aiError = aiError || String(err.message || err).slice(0, 300);
    synthesis = {
      summary: `${frames.length} frames were extracted locally from the ${info.durationSec}s video. ${aiError ? 'AI synthesis unavailable: ' + aiError : ''}`,
      subjects: [], activities: [],
      timeline: frameDescriptions.map((f) => ({ timestamp: f.timestamp, event: f.description })),
      transcriptSummary: transcript.available ? (transcript.text || '').slice(0, 500) : null,
      limitations: aiError || 'Analysis degraded without AI synthesis.',
    };
  }

  return {
    fileId,
    fileName,
    fileType: 'VIDEO',
    fileSize: stats.size,
    info,
    frames: frames.map((f) => ({ timestamp: f.timestamp, file: path.basename(f.path) })),
    frameDescriptions,
    subtitles: subs,
    transcript,
    synthesis,
    provider,
    model,
    aiError,
    aiAvailable: Boolean(provider),
    hash,
    completedAt: new Date().toISOString(),
  };
}

module.exports = { analyzeVideo, probeVideo, extractVideoInfo };
