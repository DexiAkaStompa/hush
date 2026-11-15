# Hush desktop in Rust

Hush has an isolated Tauri 2 desktop preview. The existing React application,
styles, Supabase APIs, message formats, E2EE and Android runtime remain shared.
Rust replaces the native desktop shell; this is not a rewrite of the interface.
The stable release still uses Electron. Do not publish the preview as its
replacement before the parity requirements below have been verified.

## Run and build

Install the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/),
including Rust 1.100 or later and Windows C++ build tools. Windows WebView2 must
be available; the preview installer bootstraps it when needed.

```sh
npm ci
npm run rust:dev
npm run rust:test
npm run rust:build
```

The first native compile downloads and compiles Rust dependencies. `Cargo.lock`
and the exact npm Tauri versions are committed. CI runs formatting, Clippy,
native tests, all shared frontend tests and a real packaged WebView2 smoke test.
Its installer is an Actions artifact, not a public release or an automatic
update for existing users. It uses the separate product name `Hush Rust Preview`
and application ID `app.hush.rust.preview`.

## Native operations

- Existing `window.hushWindow` contract is installed before React renders.
- Minimize, maximize, close, native dragging and double-click maximization.
- Native clipboard, Windows acrylic and silent notifications with activation.
- Native YouTube search with the existing Lavalink fallback, fixed HTTPS hosts,
  bounded response bodies and timeouts.
- Attachment save dialog, ordered raw binary IPC blocks of at most 8 MiB,
  bounded working memory, atomic replacement and cleanup on error/close.
- Relay credentials requested in Rust from the fixed Hush broker. JWT,
  membership, voice permission and rate-limit checks stay on the server.
  Permanent relay secrets never enter the app. Temporary credentials retain
  the shared client's validation and memory-only cache.
- Shared Drive storage remains authenticated and encrypted by the same client.
  Its exact Tauri origins are allowed by the shared-media service.
- IPC permissions are explicitly assigned only to the local main window.
  External navigation and popup creation are denied; there is no general
  filesystem, command execution or authenticated HTTP proxy exposed to React.

The release build excludes test-only browser arguments and data-directory
overrides. Native file paths come from the operating system's save dialog, not
renderer input. Incomplete files are removed on ordinary errors and shutdown;
an operating-system kill or crash can leave a `.hush-*.part` temporary file.

## Requirements before replacing Electron

| Area | Required evidence |
| --- | --- |
| Existing accounts and encrypted history | Safe migration of preferences/session and room keyrings. Electron's non-extractable identity CryptoKey cannot simply be exported to a different WebView profile. Never delete or overwrite the original profile. |
| Calls | Actual two-device, bidirectional audio/video, RNNoise, output device selection, reconnect, direct and forced TLS/443 TURN tests. API presence alone is insufficient. |
| Screen sharing | Preserve the Hush source picker, monitor/window selection and Windows system audio. The WebView's native chooser is not automatically equivalent to Electron's picker. |
| Existing attachments | Verify both current shared Drive files and historical legacy attachments. Never bundle the owner's Google credentials. |
| Music | Real YouTube/Spotify playback and synchronized playback, including embedded-player origin/referrer behavior. |
| Notifications | Verify installed-app activation, focus and conversation routing with DND/mute and custom sounds. Windows notification activation from the Action Center has platform-specific limits. |
| Themes and interaction | Compare actual views, popovers, dragging, resizing, maximization, shortcuts and glass on target systems. |
| Updates and installer migration | Separate signed Tauri update manifest and keys, interruption during calls, rollback and a verified upgrade path from Electron's installer. Electron's latest.yml is incompatible. |
| Other platforms | Validate macOS/Linux independently. They use WebKit rather than Windows WebView2, so WebRTC, screen/audio capture and optical effects can differ. Android stays on Capacitor. |

During preview testing, sign in as a **new device** and keep the existing client
open when testing historical messages so its existing encrypted key-sharing
mechanism can answer requests. This is not a completed automatic migration.
The preview deliberately does not register itself as the handler for the stable
app's `hush://` links, and automatic updates report disabled with an explanation
instead of claiming a nonexistent update channel is working.

## Performance comparison

Measure release builds with identical accounts, messages, themes, window size
and media state. Include the complete process tree: the Rust process **and**
all its WebView2 browser, renderer, utility and GPU processes, just as all
Electron processes must be counted. Record private bytes, working set, CPU,
startup and UI responsiveness separately for idle, chat, call and screen share.
Do not compare just the small Rust host with the whole Electron application,
or present installer size as proof of lower runtime RAM.

No guaranteed RAM reduction or speedup is claimed merely because Rust is used.
Release artifacts and runtime measurements are acceptance evidence; passing
unit tests alone does not establish full functional parity.

## Primary references

- [Tauri architecture](https://v2.tauri.app/concept/architecture/)
- [WebView engines](https://v2.tauri.app/reference/webview-versions/)
- [Capability boundaries](https://v2.tauri.app/security/capabilities/)
- [Signed updater requirements](https://v2.tauri.app/plugin/updater/)
