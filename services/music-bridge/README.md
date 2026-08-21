# Hush Music Bridge

The bridge is a separate Windows service for shared music. It keeps Supabase
credentials out of the browser, uses Lavalink v4 for search and metadata, and
uses `yt-dlp` plus FFmpeg to provide an audio stream that Chromium can play.
Spotify searches are resolved to the matching YouTube source; the bridge does
not download or stream Spotify-protected audio.

## Windows setup

Install Node.js 20 or newer, then download the Windows binaries `yt-dlp.exe`,
`ffmpeg.exe`, and `ffprobe.exe`. Put them in a directory on `PATH`, or set
absolute paths in `.env`. The yt-dlp project documents the Windows setup and
FFmpeg requirement.

```powershell
cd services/music-bridge
npm ci --omit=dev
Copy-Item .env.example .env
notepad .env
npm start
```

Set at least these values in `.env`:

```env
BRIDGE_HOST=127.0.0.1
BRIDGE_PORT=8787
BRIDGE_PUBLIC_URL=https://music.example.com
BRIDGE_SHARED_SECRET=generate-a-long-random-secret
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

To run it automatically at Windows startup, open **PowerShell as
Administrator** and run:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\install-windows-task.ps1
```

The task writes logs to `logs/bridge.log`. To remove it:

```powershell
.\scripts\remove-windows-task.ps1
```

## HTTPS and firewall

Do not expose port `8787` directly to the Internet: Supabase access tokens
cross the bridge and must be protected by TLS. Put Caddy, IIS, or another TLS
reverse proxy in front of the bridge and set `BRIDGE_PUBLIC_URL` to the HTTPS
URL. Keep the Node process bound to `127.0.0.1`; only the reverse proxy needs
to be public.

For a temporary LAN test, use `BRIDGE_HOST=0.0.0.0` and the server's local
address, but do not use that configuration for real accounts.

## API

Health (no authentication):

```text
GET /health
```

Search and resolve require `Authorization: Bearer <Supabase access token>`:

```text
GET /v1/search?q=daft%20punk&source=youtube
GET /v1/resolve?identifier=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D...
GET /v1/stream-ticket?source=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3D...
```

The ticket is short-lived and can be used once as the audio URL returned by
the bridge. Room commands are available through:

```text
WSS /v1/rooms/<conversation-id>?token=<Supabase access token>
```

The bridge does not touch Hush message ciphertext or Supabase music state.
The client continues to synchronize room state through Supabase Realtime.

## Docker

Docker is still supported for non-Windows hosts:

```powershell
docker build -t hush-music-bridge .
docker run --env-file .env -p 8787:8787 hush-music-bridge
```

The Docker image must also contain compatible `yt-dlp` and FFmpeg binaries if
audio streaming is enabled.

Use the bridge only for content you are authorized to access and redistribute.
