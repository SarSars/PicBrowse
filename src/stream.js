import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';

/**
 * Send a file, honouring a single HTTP Range ("bytes=start-end") so video
 * players can seek. Handles HEAD and If-Modified-Since.
 */
export async function sendFile(req, res, absPath, stat, mime, { download = false, maxAge = 3600 } = {}) {
  const size = stat.size;
  const lastModified = new Date(stat.mtimeMs).toUTCString();
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Last-Modified': lastModified,
    'Cache-Control': `private, max-age=${maxAge}`,
  };
  if (download) {
    const name = path.basename(absPath);
    const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
    headers['Content-Disposition'] = `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  }

  const ims = req.headers['if-modified-since'];
  if (ims && !req.headers.range && Math.floor(stat.mtimeMs / 1000) <= Math.floor(Date.parse(ims) / 1000)) {
    res.writeHead(304, headers);
    return res.end();
  }

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = req.headers.range;

  if (range && size > 0) {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
    if (!m || (m[1] === '' && m[2] === '')) return rangeNotSatisfiable(res, size);
    if (m[1] === '') {
      // Suffix range: last N bytes.
      start = Math.max(0, size - Number(m[2]));
    } else {
      start = Number(m[1]);
      if (m[2] !== '') end = Math.min(Number(m[2]), size - 1);
    }
    if (start > end || start >= size) return rangeNotSatisfiable(res, size);
    status = 206;
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  }

  headers['Content-Length'] = size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || size === 0) return res.end();

  try {
    await pipeline(fs.createReadStream(absPath, { start, end }), res);
  } catch (err) {
    // Client closing the connection mid-stream (normal when seeking) is not an error.
    if (err.code !== 'ERR_STREAM_PREMATURE_CLOSE' && err.code !== 'ECONNRESET') {
      console.warn(`[stream] ${absPath}: ${err.message}`);
    }
  }
}

function rangeNotSatisfiable(res, size) {
  res.writeHead(416, { 'Content-Range': `bytes */${size}` });
  res.end();
}
