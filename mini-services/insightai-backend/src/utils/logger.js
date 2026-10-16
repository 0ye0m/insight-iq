'use strict';

const winston = require('winston');
const config = require('../config');

/** Safely stringify any value, handling Error objects and circular refs */
function safeStringify(val, depth = 3) {
  if (val === undefined || val === null) return '';
  if (typeof val === 'string') return val;
  if (val instanceof Error) {
    return JSON.stringify({
      name: val.name,
      message: val.message,
      stack: val.stack,
    });
  }
  try {
    return JSON.stringify(val);
  } catch {
    return String(val);
  }
}

const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'insightai-backend' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, service, err, ...meta }) => {
          // Handle the err object separately since JSON.stringify fails on Error
          let errStr = '';
          if (err) {
            if (err instanceof Error) {
              errStr = ` ${safeStringify(err)}`;
            } else {
              errStr = ` ${safeStringify(err)}`;
            }
          }
          
          // Serialize remaining meta safely
          const metaKeys = Object.keys(meta);
          const metaStr = metaKeys.length > 0
            ? ` ${safeStringify(meta)}`
            : '';
          return `${timestamp} [${level}]: ${message}${errStr}${metaStr}`;
        })
      ),
    }),
  ],
});

module.exports = logger;
