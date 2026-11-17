// Entry point: load config, find ffmpeg, start listening. Routing lives in app.js.
import os from 'node:os';
import { createServer } from './app.js';
import { loadConfig } from './config.js';
import { recentFolders } from './recent.js';
import { findFfmpeg, toolWorks } from './tools.js';

const cfg = loadConfig();
const ffmpeg = await findFfmpeg(cfg);
const ffmpegOk = await toolWorks(ffmpeg);
const server = createServer(cfg, { ffmpeg, ffmpegOk });

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`\n[PicBrowse] Port ${cfg.port} is already in use. Set a different "port" in config.json.\n`);
  else console.error(err);
  process.exit(1);
});

server.listen(cfg.port, cfg.host, () => {
  const addrs = Object.values(os.networkInterfaces()).flat()
    .filter((a) => a && a.family === 'IPv4' && !a.internal)
    .map((a) => `http://${a.address}:${cfg.port}/`);
  console.log('\nPicBrowse is running');
  console.log(`  Media folder : ${cfg.mediaRoot}`);
  console.log(`  Cache folder : ${cfg.thumbCacheDir}`);
  console.log(`  ffmpeg       : ${ffmpegOk ? ffmpeg : 'NOT FOUND - video thumbnails disabled'}`);
  console.log(`  This PC      : http://localhost:${cfg.port}/`);
  for (const a of addrs) console.log(`  Other devices: ${a}`);
  console.log('\nPress Ctrl+C to stop.\n');
  recentFolders(cfg).catch(() => {}); // warm the "Recently added" scan so the first visit is quick
});
