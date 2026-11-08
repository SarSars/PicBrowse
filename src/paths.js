import fs from 'node:fs/promises';
import path from 'node:path';
import { isHidden } from './media.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** True if `child` is `parent` or inside it. Case-insensitive on Windows (path.relative handles that). */
export function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Turn a client-supplied relative path ("Holidays/2024/IMG_1.jpg", segments
 * already URL-decoded) into an absolute path guaranteed to be inside mediaRoot.
 * Returns { abs, rel, stat }. Throws HttpError(400/403/404).
 */
export async function resolveSafe(cfg, relInput) {
  const raw = relInput ?? '';
  if (raw.includes('\0')) throw new HttpError(400, 'Bad path');

  const segments = raw.split('/').filter((s) => s !== '' && s !== '.');
  for (const seg of segments) {
    // Reject parent refs, Windows separators/drive letters, and other characters
    // that can't legitimately appear in a Windows file name.
    if (seg === '..' || /[\\:*?"<>|]/.test(seg)) throw new HttpError(400, 'Bad path');
    if (isHidden(seg)) throw new HttpError(404, 'Not found'); // hidden/system entries are never served
  }

  const abs = path.resolve(cfg.mediaRoot, ...segments);
  if (!isInside(cfg.mediaRoot, abs)) throw new HttpError(403, 'Outside media folder');

  let real;
  try {
    real = await fs.realpath(abs);
  } catch {
    throw new HttpError(404, 'Not found');
  }
  // Symlinks / junctions must not lead outside the media folder.
  if (!isInside(cfg.mediaRootReal, real)) throw new HttpError(403, 'Outside media folder');

  const stat = await fs.stat(real);
  return { abs: real, rel: segments.join('/'), stat };
}

/** "/thumb/Holidays/My%20Trip/a.jpg" with prefix "/thumb/" → "Holidays/My Trip/a.jpg" */
export function relFromUrlPath(urlPath, prefix) {
  const rest = urlPath.slice(prefix.length);
  try {
    return rest.split('/').map(decodeURIComponent).join('/');
  } catch {
    throw new HttpError(400, 'Bad URL encoding');
  }
}
