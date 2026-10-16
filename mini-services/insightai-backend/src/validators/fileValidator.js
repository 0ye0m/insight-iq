'use strict';

const { validateExtension, validateMagicBytes, detectCategory, getExtension } = require('../utils/fileSecurity');
const { ERROR_CODES, AppError } = require('../utils/errorCodes');
const config = require('../config');

function validateUpload(file) {
  if (!file) {
    throw new AppError(ERROR_CODES.INVALID_FILE, { detail: 'No file provided in the request.' });
  }

  if (!file.originalname || typeof file.originalname !== 'string') {
    throw new AppError(ERROR_CODES.INVALID_FILE, { detail: 'File has no name.' });
  }

  // Check empty file
  if (file.size === 0) {
    throw new AppError(ERROR_CODES.EMPTY_FILE);
  }

  // Check max file size
  if (file.size > config.upload.maxFileSizeBytes) {
    throw new AppError(ERROR_CODES.FILE_TOO_LARGE, {
      size: file.size,
      max: config.upload.maxFileSizeBytes,
    });
  }

  // Validate extension
  const extResult = validateExtension(file.originalname);
  if (!extResult.valid) {
    throw new AppError(ERROR_CODES.UNSUPPORTED_FORMAT, { reason: extResult.reason });
  }

  const extension = extResult.extension;
  const category = detectCategory(extension);

  return {
    extension,
    category,
    originalName: file.originalname,
    size: file.size,
    mimeType: file.mimetype,
  };
}

function validateMagicOnDisk(diskPath, extension) {
  const result = validateMagicBytes(diskPath, extension);
  if (!result.valid && !result.skipped) {
    throw new AppError(ERROR_CODES.FILE_CORRUPTED, { reason: result.reason });
  }
}

module.exports = { validateUpload, validateMagicOnDisk };
