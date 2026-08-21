# Shared music and the Windows bridge

Hush synchronizes room playback state through Supabase Realtime. The Windows
music bridge provides the media plane: it keeps Lavalink credentials off the
client, searches Lavalink, resolves Spotify metadata to a YouTube match, and
uses `yt-dlp` plus FFmpeg to expose a short-lived HTTPS audio stream.

```text
client A -- commands/position --> Supabase Realtime <-- commands/position -- client B
    |                                                                    |
    +-- Supabase-authenticated stream ticket --> Windows music bridge <--+
                                                |
                                  Lavalink search/resolve + yt-dlp/FFmpeg
```

## What the bridge does

- searches YouTube or Spotify through Lavalink v4;
- resolves Spotify results to a matching YouTube source;
- issues short-lived stream tickets after validating the Supabase access token;
- converts the resolved source to an MP3 stream with FFmpeg;
- synchronizes `load`, `play`, `pause`, `seek`, and `stop` room commands over
  authenticated WebSocket connections.

The bridge does not store messages, E2EE keys, or Supabase music state. Realtime
remains the source of truth for room state.

## Windows deployment

Follow [`services/music-bridge/README.md`](../services/music-bridge/README.md).
The server needs Node.js 20+, `yt-dlp.exe`, `ffmpeg.exe`, and `ffprobe.exe`.
Run the supplied PowerShell task installer to start the bridge at Windows
boot. Keep Node bound to localhost and put a TLS reverse proxy in front of it.
Set `VITE_MUSIC_BRIDGE_URL` in the Hush client to the public HTTPS URL.

For the current server address, a temporary test value is:

```env
BRIDGE_PUBLIC_URL=http://217.217.243.62:8787
```

Do not use plain HTTP for real Supabase sessions. Use a domain with HTTPS (or
another TLS tunnel) before inviting friends.

## Why Lavalink is still used

Lavalink's REST API returns encoded track data intended for a Lavalink player;
it is not a browser audio CDN. Therefore Lavalink remains the search/metadata
layer, while the Windows bridge performs the final media extraction. This is
why a Lavalink-only implementation cannot solve browser playback by itself.

## Privacy and legal boundary

The bridge sees the requested source URL and the requesting IP address. It
does not see message plaintext or E2EE keys. Use it only for content you are
authorized to access and redistribute, and review the terms of each source
provider before enabling playback for other users.
