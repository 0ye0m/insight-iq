'use strict';

const path = require('path');
const fs = require('fs');
const logger = require('./logger');

/**
 * Maps file extensions to allowed MIME types.
 * Extended for InsightIQ: media (images/video) + URL ingestion.
 */
const ALLOWED_EXTENSIONS = new Set([
  // Tabular
  '.csv', '.tsv', '.txt', '.json', '.jsonl', '.ndjson',
  '.xlsx', '.xls', '.ods', '.parquet',
  // Documents
  '.pdf', '.docx', '.doc', '.pptx', '.ppt', '.odt', '.rtf',
  '.md', '.markdown', '.html', '.htm', '.xml',
  // Images
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp',
  // Video
  '.mp4', '.webm', '.mov', '.mkv', '.avi',
]);

const DANGEROUS_EXTENSIONS = new Set([
  '.exe', '.bat', '.cmd', '.sh', '.ps1', '.dll', '.so', '.dylib',
  '.msi', '.scr', '.pif', '.com', '.vbs', '.js', '.wsf', '.hta',
  '.cpl', '.jar', '.class', '.php', '.asp', '.aspx', '.jsp',
]);

/** Magic-byte signatures for validation */
const MAGIC_BYTES = {
  '.pdf': [0x25, 0x50, 0x44, 0x46],           // %PDF
  '.zip': [0x50, 0x4B, 0x03, 0x04],
  '.xlsx': [0x50, 0x4B, 0x03, 0x04],
  '.docx': [0x50, 0x4B, 0x03, 0x04],
  '.pptx': [0x50, 0x4B, 0x03, 0x04],
  '.odt': [0x50, 0x4B, 0x03, 0x04],
  '.png': [0x89, 0x50, 0x4E, 0x47],
  '.jpg': [0xFF, 0xD8, 0xFF],
  '.jpeg': [0xFF, 0xD8, 0xFF],
  '.gif': [0x47, 0x49, 0x46],
  '.bmp': [0x42, 0x4D],
  '.webm': [0x1A, 0x45, 0xDF, 0xA3],
  '.mp4': [0x00, 0x00, 0x00],                  // ftyp box (loose check)
  '.mov': [0x00, 0x00, 0x00],
  '.mkv': [0x1A, 0x45, 0xDF, 0xA3],
  '.xls': [0xD0, 0xCF, 0x11, 0xE0],
  '.doc': [0xD0, 0xCF, 0x11, 0xE0],
  '.ppt': [0xD0, 0xCF, 0x11, 0xE0],
  '.rtf': [0x7B, 0x5C, 0x72, 0x74],
};

const EXTENSION_TO_CATEGORY = {
  '.csv': 'TABULAR', '.tsv': 'TABULAR', '.json': 'TABULAR',
  '.jsonl': 'TABULAR', '.ndjson': 'TABULAR',
  '.xlsx': 'TABULAR', '.xls': 'TABULAR', '.ods': 'TABULAR', '.parquet': 'TABULAR',
  '.pdf': 'DOCUMENT', '.docx': 'DOCUMENT', '.pptx': 'DOCUMENT',
  '.odt': 'DOCUMENT', '.rtf': 'DOCUMENT', '.md': 'DOCUMENT', '.markdown': 'DOCUMENT',
  '.html': 'DOCUMENT', '.htm': 'DOCUMENT', '.xml': 'DOCUMENT',
  '.txt': 'UNKNOWN',
  '.doc': 'DOCUMENT', '.ppt': 'DOCUMENT',
  '.png': 'IMAGE', '.jpg': 'IMAGE', '.jpeg': 'IMAGE', '.webp': 'IMAGE', '.gif': 'IMAGE', '.bmp': 'IMAGE',
  '.mp4': 'VIDEO', '.webm': 'VIDEO', '.mov': 'VIDEO', '.mkv': 'VIDEO', '.avi': 'VIDEO',
};

function sanitizeFilename(originalName) {
  let safe = originalName.replace(/\0/g, '');
  safe = path.basename(safe);
  return safe;
}

function getExtension(filename) {
  const base = path.basename(filename).toLowerCase();
  const idx = base.lastIndexOf('.');
  return idx >= 0 ? base.substring(idx) : '';
}

function isPathSafe(filePath) {
  return !filePath.includes('..');
}

function validateExtension(filename) {
  const ext = getExtension(filename);
  if (!ext) return { valid: false, reason: 'No file extension found.' };
  if (DANGEROUS_EXTENSIONS.has(ext)) return { valid: false, reason: `Dangerous file type: ${ext}` };
  if (!ALLOWED_EXTENSIONS.has(ext)) return { valid: false, reason: `Unsupported file extension: ${ext}` };
  return { valid: true, extension: ext };
}

function validateMagicBytes(filePath, expectedExt) {
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(8);
    const bytesRead = fs.readSync(fd, buffer, 0, 8, 0);
    fs.closeSync(fd);

    const expected = MAGIC_BYTES[expectedExt];
    if (!expected) return { valid: true, checked: false };
    if (bytesRead < expected.length) return { valid: false, reason: 'File too small for signature check.' };

    for (let i = 0; i < expected.length; i++) {
      if (buffer[i] !== expected[i]) {
        return { valid: false, reason: `File signature does not match expected type ${expectedExt}.` };
      }
    }
    return { valid: true, checked: true };
  } catch (err) {
    logger.warn({ err }, 'Magic byte check failed, skipping');
    return { valid: true, checked: false, skipped: true };
  }
}

function detectCategory(extension) {
  return EXTENSION_TO_CATEGORY[extension] || 'UNKNOWN';
}

function isExecutable(filename) {
  return DANGEROUS_EXTENSIONS.has(getExtension(filename));
}

module.exports = {
  ALLOWED_EXTENSIONS,
  DANGEROUS_EXTENSIONS,
  sanitizeFilename,
  getExtension,
  isPathSafe,
  validateExtension,
  validateMagicBytes,
  detectCategory,
  isExecutable,
};
