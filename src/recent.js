import fs from 'node:fs/promises';
import path from 'node:path';
import { isHidden } from './media.js';
import { isInside } from './paths.js';

const TTL_MS = 60_000;
const MAX_DEPTH = 32;

let cached = null;  // { at, list }
let pending = null; // in-flight scan, shared by concurrent requests

/**
 * Walk the folder tree looking for folders created within the cutoff. Only
 * directories are stat'ed, so this stays cheap even with thousands of files.
 * A recent folder is not descended into: its subfolders are reached through it.
 */
async function walk(absDir, rel, ctx, depth) {
  let dirents;
  try {
    dirents = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return; // unreadable folder
  }
  await Promise.all(dirents.map(async (d) => {
    if (isHidden(d.name)) return;
    const full = path.join(absDir, d.name);
    let st;
    try {
      if (d.isSymbolicLink()) {
        // Follow links/junctions only inside the media folder, and only once (no loops).
        const real = await fs.realpath(full);
        if (!isInside(ctx.rootReal, real) || ctx.seen.has(real)) return;
        ctx.seen.add(real);
      } else if (!d.isDirectory()) {
        return;
      }
      st = await fs.stat(full);
    } catch {
      return;
    }
    if (!st.isDirectory()) return;

    const childRel = rel ? `${rel}/${d.name}` : d.name;
    // Creation time is when the folder arrived here (copying sets it to "now").
    // Filesystems without one report 0; fall back to the modified time.
    const added = Math.round(st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs);
    if (added >= ctx.cutoff) {
      ctx.found.push({ name: d.name, path: childRel, added });
      return;
    }
    if (depth < MAX_DEPTH) await walk(full, childRel, ctx, depth + 1);
  }));
}

/**
 * Folders at any depth that were added in the last `cfg.recentDays` days,
 * newest first: [{ name, path, added }]. Cached for TTL_MS.
 */
export async function recentFolders(cfg) {
  if (!(cfg.recentDays > 0)) return [];
  if (cached && Date.now() - cached.at < TTL_MS) return cached.list;
  pending ??= (async () => {
    try {
      const ctx = {
        rootReal: cfg.mediaRootReal,
        cutoff: Date.now() - cfg.recentDays * 86_400_000,
        seen: new Set(),
        found: [],
      };
      await walk(cfg.mediaRootReal, '', ctx, 0);
      ctx.found.sort((a, b) => b.added - a.added || a.path.localeCompare(b.path));
      cached = { at: Date.now(), list: ctx.found };
      return ctx.found;
    } finally {
      pending = null;
    }
  })();
  return pending;
}
