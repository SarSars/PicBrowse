// npm run scan — survey the media library: which formats are present and which
// videos will play in a browser. Reads only; changes nothing.
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from '../src/config.js';
import { isHidden, mediaInfo } from '../src/media.js';
import { findFfprobe, run, toolWorks } from '../src/tools.js';

const cfg = loadConfig();
const ffprobe = await findFfprobe(cfg);
const canProbe = await toolWorks(ffprobe);

const BROWSER_CONTAINERS = new Set(['.mp4', '.m4v', '.mov', '.webm']);
const GOOD_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1']);
const MAYBE_VIDEO = new Set(['hevc']); // Edge/Chrome on Windows with hardware support; not Firefox
const GOOD_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

const extCounts = new Map();   // ext -> {count, bytes, kind}
const videos = [];             // abs paths
let folders = 0;
let unreadable = 0;

async function walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    unreadable++;
    return;
  }
  folders++;
  for (const d of entries) {
    if (isHidden(d.name)) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) {
      await walk(full);
    } else if (d.isFile()) {
      const ext = path.extname(d.name).toLowerCase() || '(none)';
      const info = mediaInfo(d.name);
      let size = 0;
      try { size = (await fs.stat(full)).size; } catch { /* ignore */ }
      const e = extCounts.get(ext) || { count: 0, bytes: 0, kind: info ? info.type : 'other' };
      e.count++;
      e.bytes += size;
      extCounts.set(ext, e);
      if (info?.type === 'video') videos.push(full);
    }
  }
  if (folders % 200 === 0) process.stdout.write(`\r  scanned ${folders} folders…`);
}

async function probe(file) {
  const out = await run(ffprobe, [
    '-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file,
  ], { timeoutMs: 30_000 });
  const streams = JSON.parse(out.toString()).streams || [];
  return {
    video: streams.find((s) => s.codec_type === 'video')?.codec_name || 'none',
    audio: streams.find((s) => s.codec_type === 'audio')?.codec_name || 'none',
  };
}

function verdict(ext, v, a) {
  const audioOk = a === 'none' || GOOD_AUDIO.has(a);
  if (BROWSER_CONTAINERS.has(ext) && GOOD_VIDEO.has(v)) return audioOk ? 'plays' : 'maybe';
  if (BROWSER_CONTAINERS.has(ext) && MAYBE_VIDEO.has(v)) return 'maybe';
  if (ext === '.mkv' && GOOD_VIDEO.has(v) && audioOk) return 'maybe'; // Chrome/Edge often play these
  return 'no';
}

const fmtBytes = (b) => {
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (b >= 1024 && i < u.length - 1) { b /= 1024; i++; }
  return `${b.toFixed(i ? 1 : 0)} ${u[i]}`;
};
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log(`\nScanning ${cfg.mediaRoot}`);
const t0 = Date.now();
await walk(cfg.mediaRoot);
process.stdout.write('\r' + ' '.repeat(40) + '\r');

const byKind = (k) => [...extCounts.entries()].filter(([, e]) => e.kind === k).sort((a, b) => b[1].count - a[1].count);
const total = (list) => list.reduce((n, [, e]) => n + e.count, 0);

console.log(`\n${folders} folders${unreadable ? ` (${unreadable} could not be read)` : ''}\n`);
for (const [label, kind] of [['Images', 'image'], ['Videos', 'video'], ['Other files (not shown in PicBrowse)', 'other']]) {
  const list = byKind(kind);
  if (!list.length) continue;
  console.log(`${label}: ${total(list)}`);
  for (const [ext, e] of list.slice(0, kind === 'other' ? 12 : 99)) {
    console.log(`  ${pad(ext, 10)}${padL(e.count, 8)}  ${padL(fmtBytes(e.bytes), 10)}`);
  }
  if (kind === 'other' && list.length > 12) console.log(`  … and ${list.length - 12} more types`);
  console.log('');
}

const heic = (extCounts.get('.heic')?.count || 0) + (extCounts.get('.heif')?.count || 0);
if (heic) console.log(`Note: ${heic} HEIC/HEIF photos. Browsers can't show these directly; PicBrowse converts them, which needs a working ffmpeg HEIC decoder.\n`);

if (videos.length) {
  if (!canProbe) {
    console.log('ffprobe not found — run "npm install" first to check video codecs.\n');
  } else {
    console.log(`Checking codecs of ${videos.length} videos…`);
    const combos = new Map(); // key -> {count, verdict, example}
    const verdicts = { plays: 0, maybe: 0, no: 0, error: 0 };
    let done = 0;
    const queue = [...videos];
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const file = queue.shift();
        const ext = path.extname(file).toLowerCase();
        let key;
        let v;
        try {
          const c = await probe(file);
          v = verdict(ext, c.video, c.audio);
          key = `${ext} ${c.video}/${c.audio}`;
        } catch {
          v = 'error';
          key = `${ext} (unreadable)`;
        }
        verdicts[v]++;
        const e = combos.get(key) || { count: 0, verdict: v, example: path.relative(cfg.mediaRoot, file) };
        e.count++;
        combos.set(key, e);
        if (++done % 25 === 0) process.stdout.write(`\r  ${done}/${videos.length}`);
      }
    }));
    process.stdout.write('\r' + ' '.repeat(40) + '\r');

    const label = { plays: 'plays in browser', maybe: 'depends on browser', no: 'needs video player', error: 'could not read' };
    console.log(`\n${pad('Container / video / audio', 34)}${padL('Count', 7)}  ${pad('Result', 20)}Example`);
    for (const [k, e] of [...combos.entries()].sort((a, b) => b[1].count - a[1].count)) {
      console.log(`${pad(k, 34)}${padL(e.count, 7)}  ${pad(label[e.verdict], 20)}${e.example}`);
    }
    console.log(`\nSummary: ${verdicts.plays} play in the browser, ${verdicts.maybe} depend on the browser, ` +
      `${verdicts.no} need a video player${verdicts.error ? `, ${verdicts.error} unreadable` : ''}.\n`);
  }
}

console.log(`Done in ${((Date.now() - t0) / 1000).toFixed(1)} s.\n`);
