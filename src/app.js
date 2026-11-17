import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { browse } from './browse.js';
import { mediaInfo, STATIC_TYPES } from './media.js';
import { HttpError, isInside, relFromUrlPath, resolveSafe } from './paths.js';
import { sendFile } from './stream.js';
import { getPreview, getThumb } from './thumbs.js';

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-cache',
  });
  res.end(data);
}

/**
 * Build the PicBrowse HTTP server without starting it. `ffmpeg` is the ffmpeg
 * command to use, and `ffmpegOk` says whether it runs (no video thumbnails if not).
 */
export function createServer(cfg, { ffmpeg = 'ffmpeg', ffmpegOk = false } = {}) {
  const publicDir = path.join(cfg.projectDir, 'public');

  async function mediaFile(rel) {
    const safe = await resolveSafe(cfg, rel);
    if (!safe.stat.isFile()) throw new HttpError(404, 'Not a file');
    const info = mediaInfo(safe.abs);
    if (!info) throw new HttpError(404, 'Not a media file');
    return { safe, info };
  }

  async function serveStatic(req, res, rel) {
    const abs = path.resolve(publicDir, rel);
    if (!isInside(publicDir, abs)) throw new HttpError(403, 'Forbidden');
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      throw new HttpError(404, 'Not found');
    }
    if (!stat.isFile()) throw new HttpError(404, 'Not found');
    const mime = STATIC_TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    return sendFile(req, res, abs, stat, mime, { maxAge: 0 });
  }

  async function handle(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method not allowed');
    const url = new URL(req.url, 'http://localhost');
    const p = url.pathname;

    if (p === '/api/browse') {
      const safe = await resolveSafe(cfg, url.searchParams.get('path') || '');
      return sendJson(res, 200, await browse(cfg, safe));
    }

    if (p.startsWith('/media/')) {
      const { safe, info } = await mediaFile(relFromUrlPath(p, '/media/'));
      const download = url.searchParams.has('download');
      return sendFile(req, res, safe.abs, safe.stat, download ? 'application/octet-stream' : info.mime, { download });
    }

    if (p.startsWith('/thumb/')) {
      const { safe, info } = await mediaFile(relFromUrlPath(p, '/thumb/'));
      if (info.type === 'video' && !ffmpegOk) throw new HttpError(404, 'ffmpeg not available');
      let file;
      try {
        file = await getThumb(cfg, ffmpeg, safe, info.type);
      } catch (err) {
        console.warn(`[thumb] ${safe.rel}: ${err.message}`);
        throw new HttpError(404, 'No thumbnail');
      }
      // Thumbnail URLs carry ?v=<mtime-size>, so they can be cached for a long time.
      return sendFile(req, res, file, await fs.stat(file), 'image/webp', { maxAge: 31_536_000 });
    }

    if (p.startsWith('/preview/')) {
      const { safe, info } = await mediaFile(relFromUrlPath(p, '/preview/'));
      if (info.type !== 'image') throw new HttpError(400, 'Not an image');
      let file;
      try {
        file = await getPreview(cfg, ffmpeg, safe);
      } catch (err) {
        console.warn(`[preview] ${safe.rel}: ${err.message}`);
        throw new HttpError(415, 'Cannot convert this image');
      }
      return sendFile(req, res, file, await fs.stat(file), 'image/jpeg', { maxAge: 31_536_000 });
    }

    if (p.startsWith('/static/')) return serveStatic(req, res, relFromUrlPath(p, '/static/'));
    if (p === '/favicon.ico' || p === '/favicon.svg') return serveStatic(req, res, 'favicon.svg');

    // Single-page app: "/" and "/browse/..." all load index.html.
    if (p === '/' || p === '/browse' || p.startsWith('/browse/')) return serveStatic(req, res, 'index.html');

    throw new HttpError(404, 'Not found');
  }

  return http.createServer(async (req, res) => {
    try {
      await handle(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      if (status === 500) console.error(`[error] ${req.url}`, err);
      if (!res.headersSent) sendJson(res, status, { error: err.message });
      else res.destroy();
    }
  });
}
