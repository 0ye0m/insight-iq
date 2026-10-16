'use strict';

const ERROR_CODES = {
  // File errors
  INVALID_FILE: { code: 'INVALID_FILE', httpStatus: 400, message: 'The uploaded file is invalid.' },
  UNSUPPORTED_FORMAT: { code: 'UNSUPPORTED_FORMAT', httpStatus: 400, message: 'This file format is not supported.' },
  FILE_TOO_LARGE: { code: 'FILE_TOO_LARGE', httpStatus: 413, message: 'The uploaded file exceeds the maximum allowed size.' },
  FILE_CORRUPTED: { code: 'FILE_CORRUPTED', httpStatus: 400, message: 'The uploaded file appears to be corrupted.' },
  EMPTY_FILE: { code: 'EMPTY_FILE', httpStatus: 400, message: 'The uploaded file is empty.' },
  EMPTY_DATASET: { code: 'EMPTY_DATASET', httpStatus: 422, message: 'The file contains no usable data.' },
  INVALID_DATASET: { code: 'INVALID_DATASET', httpStatus: 422, message: 'The file does not contain valid tabular or document data.' },

  // Processing errors
  PROCESSING_FAILED: { code: 'PROCESSING_FAILED', httpStatus: 500, message: 'File processing failed.' },
  PARSING_FAILED: { code: 'PARSING_FAILED', httpStatus: 422, message: 'Failed to parse the file contents.' },
  ANALYSIS_FAILED: { code: 'ANALYSIS_FAILED', httpStatus: 500, message: 'Data analysis failed.' },
  PYTHON_ENGINE_UNAVAILABLE: { code: 'PYTHON_ENGINE_UNAVAILABLE', httpStatus: 503, message: 'Python analytics engine is not available. Make sure Python 3.9+ is installed with the required packages (pandas, numpy, scipy).' },

  // Document-specific
  OCR_REQUIRED: { code: 'OCR_REQUIRED', httpStatus: 422, message: 'The document appears to be scanned and requires OCR.' },
  OCR_UNAVAILABLE: { code: 'OCR_UNAVAILABLE', httpStatus: 422, message: 'OCR is not configured in this environment.' },
  TABLE_EXTRACTION_FAILED: { code: 'TABLE_EXTRACTION_FAILED', httpStatus: 422, message: 'Table extraction from the document failed.' },

  // RAG / LLM errors
  RAG_FAILED: { code: 'RAG_FAILED', httpStatus: 500, message: 'RAG retrieval failed.' },
  LLM_UNAVAILABLE: { code: 'LLM_UNAVAILABLE', httpStatus: 503, message: 'The AI service is currently unavailable.' },
  LLM_TIMEOUT: { code: 'LLM_TIMEOUT', httpStatus: 504, message: 'The AI service request timed out.' },
  LLM_INVALID_RESPONSE: { code: 'LLM_INVALID_RESPONSE', httpStatus: 502, message: 'The AI service returned an invalid response.' },

  // Export errors
  EXPORT_FAILED: { code: 'EXPORT_FAILED', httpStatus: 500, message: 'Export generation failed.' },

  // Resource errors
  FILE_NOT_FOUND: { code: 'FILE_NOT_FOUND', httpStatus: 404, message: 'The requested file was not found.' },
  PROCESSING_IN_PROGRESS: { code: 'PROCESSING_IN_PROGRESS', httpStatus: 409, message: 'File is currently being processed.' },
  RATE_LIMITED: { code: 'RATE_LIMITED', httpStatus: 429, message: 'Too many requests. Please try again later.' },

  // General
  INTERNAL_ERROR: { code: 'INTERNAL_ERROR', httpStatus: 500, message: 'An internal error occurred.' },
};

class AppError extends Error {
  constructor(errorDef, details = null) {
    super(errorDef.message);
    this.code = errorDef.code;
    this.httpStatus = errorDef.httpStatus;
    this.details = details;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = { ERROR_CODES, AppError };
