import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function defaultCacheDir() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'PicBrowse', 'cache');
  }
  const base = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(base, 'picbrowse');
}

function argValue(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export function loadConfig() {
  const configPath = path.resolve(
    argValue('--config') || process.env.PICBROWSE_CONFIG || path.join(projectDir, 'config.json'),
  );

  let fileConfig = {};
  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      fail(`Could not read ${configPath}: ${err.message}\n` +
        'Tip: in JSON, write Windows paths with forward slashes ("D:/Photos") or doubled backslashes ("D:\\\\Photos").');
    }
  }

  const cfg = {
    mediaRoot: process.env.PICBROWSE_MEDIA_ROOT || fileConfig.mediaRoot,
    port: Number(process.env.PORT || fileConfig.port || 8080),
    host: fileConfig.host || '0.0.0.0',
    thumbCacheDir: fileConfig.thumbCacheDir || defaultCacheDir(),
    thumbSize: Number(fileConfig.thumbSize || 320),
    previewSize: Number(fileConfig.previewSize || 2560),
    ffmpegPath: fileConfig.ffmpegPath || null,
    ffprobePath: fileConfig.ffprobePath || null,
    configPath,
    projectDir,
  };

  if (!cfg.mediaRoot) {
    fail(`No mediaRoot configured.\nCopy config.example.json to config.json and set "mediaRoot" to your photo folder.\n(Looked for ${configPath})`);
  }

  cfg.mediaRoot = path.resolve(cfg.mediaRoot);
  let stat;
  try {
    stat = fs.statSync(cfg.mediaRoot);
  } catch {
    fail(`mediaRoot does not exist: ${cfg.mediaRoot}`);
  }
  if (!stat.isDirectory()) fail(`mediaRoot is not a folder: ${cfg.mediaRoot}`);

  // Canonical form (resolves symlinks/junctions and drive-letter case) for containment checks.
  cfg.mediaRootReal = fs.realpathSync.native(cfg.mediaRoot);

  fs.mkdirSync(cfg.thumbCacheDir, { recursive: true });
  return cfg;
}

function fail(msg) {
  console.error(`\n[PicBrowse] ${msg}\n`);
  process.exit(1);
}
