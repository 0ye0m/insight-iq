'use strict';

const { spawn } = require('child_process');
const path = require('path');
const config = require('../config');
const logger = require('../utils/logger');
const { ERROR_CODES, AppError } = require('../utils/errorCodes');

/**
 * Safely invoke the Python analytics engine via subprocess.
 * Sends JSON via stdin, receives JSON via stdout.
 * Never constructs shell commands from user input.
 */
function invokePython(command, payload) {
  return new Promise((resolve, reject) => {
    const input = JSON.stringify({ command, ...payload });

    const pythonArgs = [config.analytics.scriptPath];

    logger.info({ command, payloadSize: input.length }, 'Invoking Python analytics engine');

    const proc = spawn(config.analytics.pythonPath, pythonArgs, {
      cwd: path.resolve(__dirname, '../../'),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const timeout = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new AppError(ERROR_CODES.PROCESSING_FAILED, {
        detail: `Python analytics timed out after ${config.analytics.timeoutMs}ms`,
      }));
    }, config.analytics.timeoutMs);

    proc.on('error', (err) => {
      clearTimeout(timeout);
      logger.error({ err, pythonPath: config.analytics.pythonPath }, 'Failed to spawn Python process');
      reject(new AppError(ERROR_CODES.PYTHON_ENGINE_UNAVAILABLE, {
        detail: `Could not start Python using "${config.analytics.pythonPath}". Install Python 3.9+ and run: pip install -r requirements.txt`,
        pythonPath: config.analytics.pythonPath,
        originalError: err.message,
      }));
    });

    proc.on('close', (code) => {
      clearTimeout(timeout);

      if (stderr.trim()) {
        logger.warn({ stderr: stderr.substring(0, 500) }, 'Python stderr output');
      }

      // First try to parse stdout (even with non-zero exit, error JSON may be there)
      try {
        const result = JSON.parse(stdout);
        if (result.error) {
          reject(new AppError(ERROR_CODES.PROCESSING_FAILED, {
            detail: result.error,
            pythonError: stderr.substring(0, 300) || undefined,
          }));
          return;
        }
        resolve(result);
        return;
      } catch (parseErr) {
        // Not JSON
      }

      // If we got here, stdout wasn't valid JSON
      if (code !== 0) {
        logger.error({ code, stderr: stderr.substring(0, 1000), stdoutLen: stdout.length }, 'Python process failed');
        reject(new AppError(ERROR_CODES.PROCESSING_FAILED, {
          detail: `Analytics engine failed (exit ${code}).`,
          pythonError: stderr.substring(0, 300),
        }));
        return;
      }

      reject(new AppError(ERROR_CODES.PROCESSING_FAILED, {
        detail: 'Analytics engine returned invalid data.',
      }));
    });

    // Send input to Python via stdin, then close
    proc.stdin.write(input);
    proc.stdin.end();
  });
}

module.exports = { invokePython };
