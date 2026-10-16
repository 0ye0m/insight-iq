'use strict';

/**
 * Public URL ingestion — honest about what is accessible.
 * - YouTube: official oEmbed metadata (title, author, thumbnail). Full video
 *   processing requires the file; we never bypass platform restrictions/DRM.
 * - Direct media URLs (image/video): downloaded within strict limits and run
 *   through the same media pipelines as uploads.
 * - Web pages: readable text extracted locally → document-style evidence.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../../config');
const { ERROR_CODES, AppError } = require('../../utils/errorCodes');
const logger = require('../../utils/logger');

const UA = 'Mozilla/5.0 (X11; Linux x86_64) InsightIQ/2.0 (+analytics; respects robots.txt)';

function classifyUrl(url) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new AppError(ERROR_CODES.INVALID_FILE, { detail: 'Invalid URL.' }); }
  if (!/^https?:$/.test(parsed.protocol)) throw new AppError(ERROR_CODES.UNSUPPORTED_FORMAT, { detail: 'Only http(s) URLs are supported.' });
  const host = parsed.hostname.replace(/^www\./, '');
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    const videoId = host === 'youtu.be' ? parsed.pathname.slice(1) : (parsed.searchParams.get('v') || (parsed.pathname.match(/\/(shorts|embed)\/([\w-]+)/) || [])[2]);
    if (videoId) return { kind: 'youtube', videoId };
  }
  if (/\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(parsed.pathname)) return { kind: 'image' };
  if (/\.(mp4|webm|mov|mkv|avi)(\?|$)/i.test(parsed.pathname)) return { kind: 'video' };
  return { kind: 'page' };
}

async function analyzeUrl(rawUrl) {
  const { kind, videoId } = classifyUrl(rawUrl);

  if (kind === 'youtube') {
    return youtubeMetadata(rawUrl, videoId);
  }
  if (kind === 'image') {
    const dl = await downloadTo(rawUrl, config.paths.tmp, 20 * 1024 * 1024);
    return { kind: 'image', downloaded: dl };
  }
  if (kind === 'video') {
    const dl = await downloadTo(rawUrl, config.paths.tmp, config.media.maxVideoBytes);
    return { kind: 'video', downloaded: dl };
  }
  return readPage(rawUrl);
}

async function youtubeMetadata(url, videoId) {
  const meta = { kind: 'youtube', url, videoId, accessible: true };
  try {
    const res = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': UA },
    });
    if (res.ok) {
      const data = await res.json();
      meta.title = data.title;
      meta.author = data.author_name;
      meta.thumbnail = data.thumbnail_url;
      meta.embedAvailable = Boolean(data.html);
    } else if (res.status === 401 || res.status === 403) {
      meta.accessible = false;
      meta.reason = 'Video is private, embedding disabled, or unavailable.';
    } else if (res.status === 404) {
      meta.accessible = false;
      meta.reason = 'Video not found (removed or invalid id).';
    }
  } catch (e) {
    meta.accessible = false;
    meta.reason = `Could not reach YouTube metadata: ${String(e.message).slice(0, 120)}`;
  }
  meta.processingNote = 'Only public metadata (title/author/thumbnail) was fetched. The full video was NOT processed — platform video streams are not downloaded. Upload the video file (or its transcript) to analyze its actual content.';
  return meta;
}

async function downloadTo(url, dir, maxBytes) {
  fs.mkdirSync(dir, { recursive: true });
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60000), redirect: 'follow' });
  if (!res.ok) throw new AppError(ERROR_CODES.INVALID_FILE, { detail: `Download failed with HTTP ${res.status}.` });
  const len = parseInt(res.headers.get('content-length') || '0', 10);
  if (len && len > maxBytes) throw new AppError(ERROR_CODES.FILE_TOO_LARGE, { detail: `Remote file is ${Math.round(len / 1048576)}MB; limit is ${Math.round(maxBytes / 1048576)}MB.` });
  const ctype = res.headers.get('content-type') || '';
  const extFromType = ctype.includes('png') ? '.png' : ctype.includes('jpeg') ? '.jpg' : ctype.includes('webp') ? '.webp' : ctype.includes('gif') ? '.gif' : ctype.includes('mp4') ? '.mp4' : ctype.includes('webm') ? '.webm' : null;
  const urlPath = new URL(url).pathname;
  const ext = extFromType || (path.extname(urlPath) || '.bin').toLowerCase();
  const tmpPath = path.join(dir, `url_${crypto.randomUUID()}${ext}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new AppError(ERROR_CODES.FILE_TOO_LARGE, { detail: `Downloaded file exceeds limit (${Math.round(maxBytes / 1048576)}MB).` });
  fs.writeFileSync(tmpPath, buf);
  logger.info({ url, bytes: buf.length }, 'URL media downloaded');
  return { path: tmpPath, bytes: buf.length, contentType: ctype, extension: ext };
}

async function readPage(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new AppError(ERROR_CODES.INVALID_FILE, { detail: `Page fetch failed with HTTP ${res.status}.` });
  const html = await res.text();
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  // strip scripts/styles/tags locally (no external dependency)
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200000);
  return {
    kind: 'page',
    url,
    title: titleMatch ? titleMatch[1].trim() : url,
    textLength: text.length,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    text,
    note: 'Readable text extracted locally from the page HTML.',
  };
}

module.exports = { analyzeUrl, classifyUrl, downloadTo };
