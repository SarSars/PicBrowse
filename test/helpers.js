import fs from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Create a temp folder and fill it from a tree description:
 * { 'a.jpg': 'contents', 'Sub': { 'b.png': Buffer } }
 * Strings and Buffers become files; objects become folders.
 * Returns the absolute (real) path of the folder.
 */
export async function makeTree(tree = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'picbrowse-test-'));
  await writeTree(root, tree);
  return realpathSync.native(root);
}

export async function writeTree(dir, tree) {
  for (const [name, value] of Object.entries(tree)) {
    const full = path.join(dir, name);
    if (typeof value === 'string' || Buffer.isBuffer(value)) {
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, value);
    } else {
      await fs.mkdir(full, { recursive: true });
      await writeTree(full, value);
    }
  }
}

export async function removeTree(dir) {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** A config object like loadConfig() returns, pointing at `mediaRoot`. */
export function makeCfg(mediaRoot, overrides = {}) {
  return {
    mediaRoot,
    mediaRootReal: realpathSync.native(mediaRoot),
    port: 0,
    host: '127.0.0.1',
    thumbCacheDir: path.join(mediaRoot, '.cache'), // hidden name, so never listed or served
    thumbSize: 64,
    previewSize: 256,
    recentDays: 60,
    ffmpegPath: null,
    ffprobePath: null,
    configPath: null,
    projectDir,
    ...overrides,
  };
}

/**
 * Link `linkPath` to the folder `target`. Uses a junction on Windows (no admin
 * rights needed). Returns false if links can't be made here.
 */
export async function linkDir(target, linkPath) {
  try {
    await fs.symlink(target, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
    return true;
  } catch {
    return false;
  }
}
