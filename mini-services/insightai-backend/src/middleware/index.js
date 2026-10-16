'use strict';

const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const logger = require('../utils/logger');
const { ERROR_CODES } = require('../utils/errorCodes');

function sanitizeError(err) {
  if (err && err.isOperational) {
    return { code: err.code, message: err.message, details: err.details };
  }
  if (err && err.code === 'PROVIDERS_UNAVAILABLE') {
    return { code: err.code, message: err.message };
  }
  if (err && err.type === 'entity.too.large') {
    return { code: ERROR_CODES.FILE_TOO_LARGE.code, message: ERROR_CODES.FILE_TOO_LARGE.message };
  }
  if (process.env.NODE_ENV === 'production') {
    return { code: 'INTERNAL_ERROR', message: 'An internal error occurred.' };
  }
  return { code: 'INTERNAL_ERROR', message: err.message || 'An internal error occurred.', details: { stack: err && err.stack } };
}

function errorHandler(err, req, res, _next) {
  const errorInfo = sanitizeError(err);
  const httpStatus = err.httpStatus || err.status || err.statusCode || 500;
  if (httpStatus >= 500) {
    logger.error({ err, code: errorInfo.code, path: req.path, method: req.method }, 'Request error');
  }
  res.status(httpStatus).json({ success: false, error: errorInfo });
}

function notFoundHandler(req, res) {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found.` },
  });
}

// Generous limits: all gateway traffic arrives from 127.0.0.1 (X-Forwarded-For
// is trusted per-key, not per-IP counting), so we keep high ceilings while
// retaining basic abuse protection.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 2000,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, error: ERROR_CODES.RATE_LIMITED }),
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ success: false, error: ERROR_CODES.RATE_LIMITED }),
});

function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info({ method: req.method, path: req.path, status: res.statusCode, durationMs: duration }, 'Request completed');
  });
  next();
}

module.exports = {
  helmet: helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }),
  cors: cors({ origin: '*', methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowedHeaders: ['Content-Type', 'Authorization'] }),
  apiLimiter,
  uploadLimiter,
  requestLogger,
  errorHandler,
  notFoundHandler,
};
