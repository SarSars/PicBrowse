// Locate ffmpeg / ffprobe: config override → bundled npm package → PATH.
import { spawn } from 'node:child_process';
import fs from 'node:fs';

async function tryImport(name) {
  try {
    return await import(name);
  } catch {
    return null;
  }
}

export async function findFfmpeg(cfg) {
  if (cfg.ffmpegPath) return cfg.ffmpegPath;
  const mod = await tryImport('ffmpeg-static');
  const p = mod?.default;
  if (typeof p === 'string' && fs.existsSync(p)) return p;
  return 'ffmpeg';
}

export async function findFfprobe(cfg) {
  if (cfg.ffprobePath) return cfg.ffprobePath;
  const mod = await tryImport('ffprobe-static');
  const p = mod?.default?.path ?? mod?.path;
  if (typeof p === 'string' && fs.existsSync(p)) return p;
  return 'ffprobe';
}

/** Run a command, collect stdout as a Buffer. Rejects on non-zero exit or timeout. */
export function run(cmd, args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    const out = [];
    let err = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} timed out`));
    }, timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => {
      if (err.length < 4000) err += d;
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${cmd} exited with ${code}: ${err.trim().split('\n').pop()}`));
    });
  });
}

/** Check a tool can actually be started. */
export async function toolWorks(cmd) {
  try {
    await run(cmd, ['-version'], { timeoutMs: 10_000 });
    return true;
  } catch {
    return false;
  }
}
