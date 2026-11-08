import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { run } from './tools.js';

sharp.cache(false); // we keep our own disk cache; avoid holding decoded images in memory

const POOL_SIZE = Math.max(1, Math.min(4, os.cpus().length));
let active = 0;
const queue = [];

/** Run `fn` when a worker slot is free (limits CPU use when a big folder is opened). */
function limit(fn) {
  return new Promise((resolve, reject) => {
    const task = async () => {
      active++;
      try {
        resolve(await fn());
      } catch (e) {
        reject(e);
      } finally {
        active--;
        queue.shift()?.();
      }
    };
    if (active < POOL_SIZE) task();
    else queue.push(task);
  });
}

const inflight = new Map(); // cacheFile -> Promise
const failed = new Set();   // cacheFiles that failed this session

function cacheFile(cfg, kind, safe, ext) {
  const key = crypto.createHash('sha1')
    .update(`${kind}|${safe.rel}|${Math.round(safe.stat.mtimeMs)}|${safe.stat.size}`)
    .digest('hex');
  return path.join(cfg.thumbCacheDir, kind, key.slice(0, 2), `${key}${ext}`);
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function writeAtomic(file, buf) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, buf);
  await fs.rename(tmp, file);
}

/** Decode the first frame of anything ffmpeg understands into a PNG buffer. */
async function ffmpegFrame(ffmpeg, abs, { seek = null, maxEdge = null } = {}) {
  const args = ['-hide_banner', '-loglevel', 'error'];
  if (seek != null) args.push('-ss', String(seek));
  args.push('-i', abs, '-frames:v', '1');
  if (maxEdge) args.push('-vf', `scale=w=${maxEdge}:h=${maxEdge}:force_original_aspect_ratio=decrease`);
  args.push('-c:v', 'png', '-f', 'image2pipe', 'pipe:1');
  const buf = await run(ffmpeg, args, { timeoutMs: 60_000 });
  if (!buf.length) throw new Error('ffmpeg produced no frame');
  return buf;
}

async function videoFrame(ffmpeg, abs, maxEdge) {
  try {
    return await ffmpegFrame(ffmpeg, abs, { seek: 1, maxEdge });
  } catch {
    // Clip shorter than 1 s, or seeking unsupported: take the very first frame.
    return ffmpegFrame(ffmpeg, abs, { maxEdge });
  }
}

/** Load an image with sharp, falling back to ffmpeg for formats sharp can't read (e.g. HEIC). */
async function imageInput(ffmpeg, abs) {
  try {
    const img = sharp(abs, { failOn: 'none' });
    await img.metadata(); // throws if format unsupported
    return img;
  } catch {
    return sharp(await ffmpegFrame(ffmpeg, abs));
  }
}

async function cached(file, make) {
  if (failed.has(file)) throw new Error('previously failed');
  if (await exists(file)) return file;
  if (inflight.has(file)) return inflight.get(file);
  const p = limit(async () => {
    if (await exists(file)) return file;
    await writeAtomic(file, await make());
    return file;
  }).catch((err) => {
    failed.add(file);
    throw err;
  }).finally(() => inflight.delete(file));
  inflight.set(file, p);
  return p;
}

/** Return the path of a cached WebP thumbnail, generating it if needed. */
export function getThumb(cfg, ffmpeg, safe, type) {
  const file = cacheFile(cfg, 'thumbs', safe, '.webp');
  return cached(file, async () => {
    const size = cfg.thumbSize;
    const img = type === 'video'
      ? sharp(await videoFrame(ffmpeg, safe.abs, size * 2))
      : await imageInput(ffmpeg, safe.abs);
    return img
      .rotate() // apply EXIF orientation
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
  });
}

/** Full-size JPEG for image formats the browser can't display (HEIC, TIFF). */
export function getPreview(cfg, ffmpeg, safe) {
  const file = cacheFile(cfg, 'previews', safe, '.jpg');
  return cached(file, async () => {
    const img = await imageInput(ffmpeg, safe.abs);
    return img
      .rotate()
      .resize(cfg.previewSize, cfg.previewSize, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
  });
}
