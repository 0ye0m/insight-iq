'use strict';

/**
 * Compare service — original vs cleaned version or two different datasets.
 * Uses the deterministic comparison engine; compatibility of columns is
 * checked by name AND semantic type.
 */

const { ERROR_CODES, AppError } = require('../utils/errorCodes');
const { invokePython } = require('../workers/pythonWorker');
const { registry } = require('./fileProcessing.service');

async function compare({ fileIdA, versionA, fileIdB, versionB }) {
  for (const fid of [fileIdA, fileIdB]) {
    if (!fid || !registry.get(fid)) {
      throw new AppError(ERROR_CODES.FILE_NOT_FOUND, { detail: fid ? `Dataset ${fid} not found` : 'Missing dataset reference' });
    }
  }
  const metaA = require('../storage/manager').getDatasetMeta(fileIdA);
  const metaB = require('../storage/manager').getDatasetMeta(fileIdB);
  const res = await invokePython('compare', {
    fileIdA,
    versionA: versionA !== undefined ? parseInt(versionA, 10) : undefined,
    fileIdB,
    versionB: versionB !== undefined ? parseInt(versionB, 10) : undefined,
    labelA: `${metaA && metaA.fileName ? metaA.fileName : fileIdA.slice(0, 8)}`,
    labelB: `${metaB && metaB.fileName ? metaB.fileName : fileIdB.slice(0, 8)}`,
  });
  return res.data;
}

module.exports = { compare };
