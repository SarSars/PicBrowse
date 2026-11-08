import path from 'node:path';

// Image formats every modern browser can display directly.
const WEB_IMAGES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.jfif': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
};

// Image formats browsers generally can't show: converted to JPEG via /preview.
const OTHER_IMAGES = {
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

const VIDEOS = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.wmv': 'video/x-ms-wmv',
  '.mpg': 'video/mpeg',
  '.mpeg': 'video/mpeg',
  '.3gp': 'video/3gpp',
  '.mts': 'video/mp2t',
  '.m2ts': 'video/mp2t',
  '.flv': 'video/x-flv',
};

// Containers that browsers commonly play (codec permitting).
const WEB_VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov', '.webm']);

const HIDDEN_NAMES = new Set([
  '$recycle.bin',
  'system volume information',
  'thumbs.db',
  'desktop.ini',
  '@eadir', // Synology thumbnail folders
]);

export function isHidden(name) {
  return name.startsWith('.') || name.startsWith('~$') || HIDDEN_NAMES.has(name.toLowerCase());
}

/** @returns {{type:'image'|'video', mime:string, web:boolean} | null} */
export function mediaInfo(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (WEB_IMAGES[ext]) return { type: 'image', mime: WEB_IMAGES[ext], web: true };
  if (OTHER_IMAGES[ext]) return { type: 'image', mime: OTHER_IMAGES[ext], web: false };
  if (VIDEOS[ext]) return { type: 'video', mime: VIDEOS[ext], web: WEB_VIDEO_EXT.has(ext) };
  return null;
}

export const STATIC_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
};
