# PicBrowse

Browse a folder of photos and videos from any browser on your home network.
Folders open as a thumbnail grid, photos open full-screen, and videos play in
the browser (or open in your video player if the browser can't play them).

See [DESIGN.md](DESIGN.md) for how it works.

## Setup (Windows)

1. **Install Node.js LTS** from <https://nodejs.org> or in PowerShell:

   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```

2. **Install dependencies** (downloads sharp and a bundled ffmpeg/ffprobe):

   ```powershell
   cd C:\Git\PicBrowse
   npm install
   ```

3. **Configure:** copy `config.example.json` to `config.json` and set `mediaRoot`:

   ```json
   { "mediaRoot": "D:/Photos", "port": 8080 }
   ```

   Use forward slashes (`D:/Photos`) or doubled backslashes (`D:\\Photos`).

4. **Check your library** (optional, read-only):

   ```powershell
   npm run scan
   ```

   It lists the image and video formats it finds and which videos will play in
   a browser.

5. **Start it:**

   ```powershell
   npm start
   ```

   Open the "This PC" address it prints. Phones and other computers use the
   "Other devices" address.

## Letting other devices connect

The first time it starts, Windows may ask whether to allow Node.js through the
firewall. Allow it on **Private networks only**. Or add the rule yourself in
an **administrator** PowerShell:

```powershell
New-NetFirewallRule -DisplayName "PicBrowse" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

Your home Wi-Fi/Ethernet connection must be set to **Private** in Windows
Settings → Network & internet. Don't set up port forwarding on your router;
PicBrowse has no login and is meant for your home network only.

## Using it

| Action | How |
|---|---|
| Open a folder | Click it. Use the path at the top to go back up |
| View a photo | Click it. ← / → or swipe for previous/next, Esc or Back to close, F for fullscreen |
| Play a video | Click it. If the browser can't play it, click **Open in video player** |
| Download the original | ⬇ button in the viewer |
| Sort | Name / Newest / Oldest menu, top right (remembered per browser) |

## Notes

- PicBrowse never changes anything in your media folder. Thumbnails are
  stored in `%LOCALAPPDATA%\PicBrowse\cache`. You can delete that folder at
  any time; thumbnails are regenerated as needed.
- The first visit to a large folder takes a few seconds while thumbnails are
  made. After that it's instant.
- Hidden and system files (`.something`, `Thumbs.db`, `$RECYCLE.BIN`, ...) are
  not shown.
- HEIC and TIFF photos are converted to JPEG for viewing.

## Troubleshooting

| Problem | Fix |
|---|---|
| `No mediaRoot configured` | Create `config.json` (step 3) |
| `Port 8080 is already in use` | Change `port` in `config.json` |
| Video thumbnails missing, startup says `ffmpeg NOT FOUND` | Run `npm install` again, or set `ffmpegPath` in `config.json` to an installed `ffmpeg.exe` |
| Phone can't connect | Check the firewall rule and that the network is Private; use the "Other devices" address |
