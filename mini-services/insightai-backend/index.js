"use strict";

/**
 * InsightIQ backend entry (Express mini-service, port 3030).
 * The Next.js frontend reaches it through the gateway: /api/*?XTransformPort=3030
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const config = require("./src/config");
const logger = require("./src/utils/logger");
const { rehydrateRegistry } = require("./src/services/fileProcessing.service");
const app = require("./src/app");

function checkPythonEngine() {
  const pyPath = config.analytics.pythonPath;
  const scriptPath = config.analytics.scriptPath;
  let ver;
  try {
    ver = execFileSync(pyPath, ["--version"], {
      stdio: "pipe",
      timeout: 5000,
      windowsHide: true,
    })
      .toString()
      .trim();
  } catch (err) {
    logger.warn(
      { pythonPath: pyPath, error: err.message },
      "Python analytics engine NOT available — upload works but analysis will fail",
    );
    return;
  }
  if (!fs.existsSync(scriptPath)) {
    logger.warn({ scriptPath }, "Python found but analytics script missing");
    return;
  }
  logger.info(
    { pythonPath: pyPath, version: ver },
    "Python analytics engine ready",
  );
}

function checkFfmpeg() {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "pipe", timeout: 5000 });
    logger.info("ffmpeg available for media processing");
  } catch {
    logger.warn("ffmpeg not found — video analysis disabled");
  }
}

if (require.main === module) {
  checkPythonEngine();
  checkFfmpeg();
  rehydrateRegistry();

  const server = app.listen(config.port, () => {
    const aiKeys =
      config.providers.gemini.keys.length + config.providers.groq.keys.length;
    logger.info(
      {
        port: config.port,
        env: config.env,
        python: config.analytics.pythonPath,
        aiKeysConfigured: aiKeys,
      },
      "InsightIQ backend started",
    );
  });

  function shutdown(signal) {
    logger.info({ signal }, "Shutting down...");
    server.close(() => process.exit(0));
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

module.exports = app;
