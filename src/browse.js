import fs from 'node:fs/promises';
import path from 'node:path';
import { isHidden, mediaInfo } from './media.js';
import { HttpError, isInside } from './paths.js';

const TTL_MS = 60_000;
const cache = new Map(); // absDir -> { dirMtime, at, entries }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Read one directory (not recursive). Cached in memory; re-read when the
 * directory's mtime changes or the entry is older than TTL_MS.
 */
async function readDirCached(absDir, rootReal) {
  const dirStat = await fs.stat(absDir);
  const hit = cache.get(absDir);
  if (hit && hit.dirMtime === dirStat.mtimeMs && Date.now() - hit.at < TTL_MS) return hit.entries;

  const dirents = await fs.readdir(absDir, { withFileTypes: true });
  const folders = [];
  const files = [];

  await Promise.all(dirents.map(async (d) => {
    if (isHidden(d.name)) return;
    const full = path.join(absDir, d.name);
    let isDir = d.isDirectory();
    let isFile = d.isFile();
    let st;
    if (d.isSymbolicLink()) {
      // Follow links/junctions only if they stay inside the media folder.
      try {
        if (!isInside(rootReal, await fs.realpath(full))) return;
        st = await fs.stat(full);
        isDir = st.isDirectory();
        isFile = st.isFile();
      } catch {
        return;
      }
    }
    if (isDir) {
      folders.push({ name: d.name });
    } else if (isFile) {
      const info = mediaInfo(d.name);
      if (!info) return;
      try {
        st ??= await fs.stat(full);
      } catch {
        return; // vanished or unreadable
      }
      files.push({ name: d.name, type: info.type, web: info.web, size: st.size, mtime: Math.round(st.mtimeMs) });
    }
  }));

  folders.sort((a, b) => collator.compare(a.name, b.name));
  files.sort((a, b) => collator.compare(a.name, b.name));

  const entries = { folders, files };
  cache.set(absDir, { dirMtime: dirStat.mtimeMs, at: Date.now(), entries });
  if (cache.size > 2000) cache.delete(cache.keys().next().value); // simple size cap
  return entries;
}

const joinRel = (rel, name) => (rel ? `${rel}/${name}` : name);

/** Find a representative media file for a folder's tile: its first media file, or one level down. */
async function findCover(absDir, rel, rootReal, depth = 0) {
  let entries;
  try {
    entries = await readDirCached(absDir, rootReal);
  } catch {
    return null;
  }
  const pick = entries.files.find((f) => f.type === 'image') || entries.files[0];
  if (pick) return { path: joinRel(rel, pick.name), type: pick.type, mtime: pick.mtime, size: pick.size };
  if (depth >= 1) return null;
  for (const sub of entries.folders.slice(0, 5)) {
    const c = await findCover(path.join(absDir, sub.name), joinRel(rel, sub.name), rootReal, depth + 1);
    if (c) return c;
  }
  return null;
}

export async function browse(cfg, safe) {
  if (!safe.stat.isDirectory()) throw new HttpError(400, 'Not a folder');
  const { folders, files } = await readDirCached(safe.abs, cfg.mediaRootReal);

  const folderItems = await Promise.all(folders.map(async (f) => {
    const abs = path.join(safe.abs, f.name);
    const rel = joinRel(safe.rel, f.name);
    let counts = null;
    try {
      const e = await readDirCached(abs, cfg.mediaRootReal);
      counts = { folders: e.folders.length, files: e.files.length };
    } catch { /* unreadable folder: still list it */ }
    return { name: f.name, path: rel, counts, cover: await findCover(abs, rel, cfg.mediaRootReal) };
  }));

  const parts = safe.rel ? safe.rel.split('/') : [];
  const breadcrumbs = [{ name: path.basename(cfg.mediaRoot) || cfg.mediaRoot, path: '' }];
  parts.forEach((p, i) => breadcrumbs.push({ name: p, path: parts.slice(0, i + 1).join('/') }));

  return {
    path: safe.rel,
    name: breadcrumbs[breadcrumbs.length - 1].name,
    breadcrumbs,
    folders: folderItems,
    files: files.map((f) => ({ ...f, path: joinRel(safe.rel, f.name) })),
  };
}
