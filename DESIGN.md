# PicBrowse — Design

A small web app that runs on a Windows PC on the home network and lets any
browser on that network browse a folder tree of photos and videos.

## Requirements

- One configured root folder (`mediaRoot`). Everything under it, at any depth,
  is browsable.
- Each folder shows its subfolders and media files as a thumbnail grid.
- Clicking a folder drills down one level. Breadcrumbs lead back up.
- Clicking an image shows it full-screen, with next/previous navigation.
- Clicking a video plays it in the browser's own player. If the browser
  can't play the format, offer the file so the OS can open it in its
  default player (VLC, Films & TV, ...).
- Scale: thousands of files.
- Home network only. Never exposed to the Internet. No login.
- The media folder is **read-only** to the app; nothing is written next to
  the photos.

## Technology

| Part | Choice | Why |
|---|---|---|
| Server | Node.js (LTS), built-in `http` module, ES modules | No framework needed for four routes; fewer dependencies to keep updated |
| Image thumbnails | `sharp` | Fast, ships prebuilt for Windows, applies EXIF rotation |
| Video thumbnails & HEIC fallback | `ffmpeg` via `ffmpeg-static` | Bundled binary — no separate install or PATH setup |
| Format scan | `ffprobe` via `ffprobe-static` | Reports container and codecs per video |
| Front end | Plain HTML/CSS/JavaScript, no build step | Small UI; nothing to compile, easy to tweak |
| Storage | None (filesystem + thumbnail cache folder) | Directory reads are fast at this scale |

## Configuration

`config.json` in the project folder (copy from `config.example.json`):

| Key | Default | Meaning |
|---|---|---|
| `mediaRoot` | — (required) | Folder to browse. Forward slashes work on Windows: `D:/Photos` |
| `port` | `8080` | Port to listen on |
| `host` | `0.0.0.0` | Interface to bind (all interfaces, so phones on Wi-Fi can connect) |
| `thumbCacheDir` | `%LOCALAPPDATA%\PicBrowse\cache` | Where thumbnails and previews are stored |
| `thumbSize` | `320` | Longest edge of thumbnails, in pixels |
| `previewSize` | `2560` | Longest edge of converted previews (HEIC/TIFF) |
| `ffmpegPath` / `ffprobePath` | bundled | Override to use a different ffmpeg build |

Environment variables `PICBROWSE_MEDIA_ROOT` and `PORT` override the file.

## Server API

| Route | Purpose |
|---|---|
| `GET /api/browse?path=<rel>` | JSON: breadcrumbs, subfolders (with a cover item), media files (type, size, mtime) |
| `GET /thumb/<rel>` | WebP thumbnail, generated on first request, then served from cache |
| `GET /preview/<rel>` | Full-size JPEG for image formats browsers can't show (HEIC, TIFF) |
| `GET /media/<rel>` | Original file, with HTTP Range support for video seeking. `?download=1` forces a download |
| `GET /browse/...`, `/` | The single-page app |
| `GET /static/...` | Front-end assets |

`<rel>` is a path relative to `mediaRoot`, with forward slashes and each segment
URL-encoded.

### Path safety

Every incoming path is decoded, rejected if it contains `..`, drive letters,
backslashes or NUL, resolved against `mediaRoot`, and then checked again
after resolving symlinks (`realpath`) to make sure it is still inside
`mediaRoot`. Hidden and system entries (`.*`, `$RECYCLE.BIN`,
`System Volume Information`, `Thumbs.db`, `desktop.ini`) are never listed.

### Thumbnail cache

- Cache file name = SHA-1 of `relative path | mtime | size`. Editing or
  replacing a file gives it a new thumbnail automatically; stale ones are
  harmless and can be deleted at any time.
- Generation runs through a small worker pool (CPU count, max 4) so opening a
  big folder for the first time doesn't overload the PC.
- Identical concurrent requests share one generation job.
- Images: `sharp` → auto-rotate → resize → WebP. If sharp can't read the file
  (e.g. HEIC), fall back to ffmpeg.
- Videos: ffmpeg grabs a frame at 1 s (or the first frame for very short
  clips) → sharp → WebP.
- Failures are remembered for the session; the UI shows a placeholder icon.

### Listing cache

Folder listings are kept in memory and re-read when the folder's modified
time changes, or after 60 seconds.

## Front end

- URL mirrors the folder: `/browse/Holidays/2024`. Back/forward and bookmarks
  work.
- Grid: folders first (with a cover thumbnail), then media. Natural sort
  ("IMG_2" before "IMG_10"); sort by name or date.
- Thumbnails use native lazy loading, so only visible tiles are fetched.
- Viewer: full-window overlay that also requests real fullscreen. Arrow keys
  / swipe for previous and next, Esc or Back to close. Neighbouring images are
  preloaded.
- Video: `<video controls autoplay>`. If the browser reports it can't play the
  file, the viewer shows an **Open in video player** button that downloads the
  file so Windows opens it in the default player.

## Video formats

Browsers play MP4/M4V/MOV with H.264 (and usually H.265 on Windows Edge/Chrome
with hardware support) and WebM. AVI, MKV, WMV, MPG etc. usually won't play.

`npm run scan` walks the library and reports counts per extension and, for
videos, per container/codec, marking which will play in the browser. The
result decides whether on-the-fly transcoding is worth adding.

## Build plan

1. Server skeleton: config, safe path handling, browse API, Range streaming ✅
2. Thumbnails and cache, `npm run scan` ✅
3. Browsing UI: grid, breadcrumbs, routing, lazy loading ✅
4. Viewers: fullscreen image lightbox, video player with fallback ✅
5. Polish: keyboard shortcuts, mobile layout, slideshow, loading states
6. Windows service (NSSM), firewall rule, `npm run warm-cache`
7. Optional: transcoding for unplayable videos (depends on scan results),
   search
