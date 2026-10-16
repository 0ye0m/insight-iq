'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

// Load root project .env (single source of truth for secrets), fall back to local .env
const rootEnv = path.resolve(__dirname, '../../../../.env');
const localEnv = path.resolve(__dirname, '../../.env');
if (fs.existsSync(rootEnv)) require('dotenv').config({ path: rootEnv });
else if (fs.existsSync(localEnv)) require('dotenv').config({ path: localEnv });

function detectPythonPath() {
  if (process.env.PYTHON_PATH) {
    // Allow absolute paths from env
    if (fs.existsSync(process.env.PYTHON_PATH)) return process.env.PYTHON_PATH;
    return process.env.PYTHON_PATH;
  }
  const candidates = process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];
  for (const cmd of candidates) {
    try {
      const version = execFileSync(cmd, ['--version'], { stdio: 'pipe', timeout: 5000, windowsHide: true }).toString().trim();
      if (version.startsWith('Python ')) return cmd;
    } catch { /* try next */ }
  }
  return 'python';
}

const detectedPython = detectPythonPath();

const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3030,

  upload: {
    maxFileSizeBytes: (parseInt(process.env.MAX_FILE_SIZE_MB, 10) || 100) * 1024 * 1024,
    maxRows: parseInt(process.env.MAX_ROWS, 10) || 100000,
    maxColumns: parseInt(process.env.MAX_COLUMNS, 10) || 500,
    maxPages: parseInt(process.env.MAX_PAGES, 10) || 200,
    maxExtractedTextChars: parseInt(process.env.MAX_EXTRACTED_TEXT_CHARS, 10) || 500000,
  },

  media: {
    maxVideoBytes: (parseInt(process.env.MAX_VIDEO_MB, 10) || 100) * 1024 * 1024,
    maxVideoSeconds: parseInt(process.env.MAX_VIDEO_SECONDS, 10) || 600,
    maxFrames: parseInt(process.env.MAX_FRAMES, 10) || 10,
    maxImageBytes: 20 * 1024 * 1024,
  },

  retention: {
    hours: parseInt(process.env.FILE_RETENTION_HOURS, 10) || 72,
  },

  analytics: {
    pythonPath: detectedPython,
    scriptPath: path.resolve(__dirname, '../../analytics/main.py'),
    timeoutMs: parseInt(process.env.ANALYTICS_TIMEOUT_MS, 10) || 180000,
  },

  providers: {
    gemini: {
      name: 'gemini',
      keys: [process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY_3]
        .filter((k) => k && k.trim() && !k.startsWith('YOUR_')),
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      models: [
        { id: 'gemini-3.8-flash', capabilities: ['text', 'json', 'vision'], contextTokens: 1048576, priority: 1 },
        { id: 'gemini-3.5-flash-lite', capabilities: ['text', 'json', 'vision'], contextTokens: 1048576, priority: 2 },
        { id: 'gemini-flash-latest', capabilities: ['text', 'json', 'vision'], contextTokens: 1048576, priority: 3 },
        { id: 'gemini-2.0-flash', capabilities: ['text', 'json', 'vision'], contextTokens: 1048576, priority: 4 },
      ],
    },
    groq: {
      name: 'groq',
      keys: [process.env.GROQ_API_KEY_1, process.env.GROQ_API_KEY_2, process.env.GROQ_API_KEY_3]
        .filter((k) => k && k.trim() && !k.startsWith('YOUR_')),
      baseUrl: 'https://api.groq.com/openai/v1',
      models: [
        { id: 'llama-3.3-70b-versatile', capabilities: ['text', 'json'], contextTokens: 128000, priority: 1 },
        { id: 'llama-3.1-8b-instant', capabilities: ['text', 'json'], contextTokens: 128000, priority: 2 },
        { id: 'meta-llama/llama-4-scout-17b-16e-instruct', capabilities: ['text', 'json', 'vision'], contextTokens: 131072, priority: 3 },
      ],
    },
  },

  ai: {
    timeoutMs: parseInt(process.env.AI_TIMEOUT_MS, 10) || 45000,
    maxRetries: parseInt(process.env.AI_MAX_RETRIES, 10) || 2,
    dailyRequestBudget: parseInt(process.env.AI_DAILY_REQUEST_BUDGET, 10) || 2000,
  },

  rag: {
    chunkSize: parseInt(process.env.CHUNK_SIZE, 10) || 1000,
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP, 10) || 200,
    maxChunks: parseInt(process.env.MAX_CHUNKS, 10) || 500,
    topK: parseInt(process.env.RAG_TOP_K, 10) || 5,
  },

  logLevel: process.env.LOG_LEVEL || 'info',

  paths: {
    uploads: path.resolve(__dirname, '../../data/uploads'),
    processed: path.resolve(__dirname, '../../data/processed'),
    chunks: path.resolve(__dirname, '../../data/chunks'),
    cache: path.resolve(__dirname, '../../data/ai-cache'),
    media: path.resolve(__dirname, '../../data/media'),
    tmp: path.resolve(__dirname, '../../data/tmp'),
  },
};

module.exports = config;
