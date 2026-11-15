# Hush desktop in Rust

Hush has a Windows Tauri 2 desktop preview with a Rust native host. The React
application, styles, Supabase APIs, message formats and E2EE remain shared.
Android stays on Capacitor. The preview uses the separate product name
`Hush Rust Preview` and application ID `app.hush.rust.preview`; it does not
replace the existing Electron installation or reuse its Chromium profile.

Automatic account handoff, signed-update support and a Windows background
memory policy are implemented. Real Windows verification has covered account
migration, encrypted history, custom sounds, Rust/Electron call interoperability
and window capture with system audio. The scope and remaining checks are below;
these results do not establish complete parity on every platform or device.

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
native tests, shared frontend tests and a real packaged WebView2 smoke test.
It builds a signed NSIS installer, updater signature and `rust-latest.json` as
Actions artifacts. An explicit workflow-dispatch option can publish the separate
Rust prerelease channel after the matching Electron bridge release exists.
Ordinary verification runs do not publish an update.

## Existing accounts: install the Electron bridge first

An existing Electron installation must first receive the bridge-capable
Electron update. An unmodified v0.5.65 executable cannot perform the handoff.
Keep that executable installed at its recorded path and preserve its original
profile; a profile directory alone is not a working migration source.

On the first eligible Rust launch, the native host starts the retained Electron
client and establishes an authenticated current-user Windows pipe. The two
renderers transfer the login, approved preferences and both custom sound files
through an expiring encrypted exchange. The old device answers the new device's
existing encrypted key-envelope requests. Rust creates a distinct non-extractable
device identity and verifies every transferred conversation keyring before
opening the normal application. Neither the old private identity nor plaintext
room keys are exported through the pipe or written to a snapshot file.

Active or ringing calls prevent handoff. The old client pauses session refresh,
saves the target's authenticated session checkpoint and exits after success.
Its original identity, settings and sound files remain in place. A completed
marker prevents a subsequent Rust restart or intentional logout from silently
importing the old account again. A failed or interrupted attempt keeps the source
profile and requires recovery before the destination opens a partially migrated
chat. An existing ordinary Rust login is not automatically replaced.

The live Windows test used the packaged Electron bridge and the real debug
Rust/WebView2 host with development assets, fresh owned profiles and disposable
backend users. It verified password-free login, preference equality, hashes of
both custom sounds, a distinct non-extractable Rust identity, readable encrypted
history, a new Rust message, and persistence across a Rust restart without
relaunching Electron. Reopening the retained Electron profile preserved its
original identity and decrypted that new message. All created test resources
were removed. This was not an installed-release upgrade test.

See [the handoff protocol and verification instructions](DESKTOP_MIGRATION.md).
Preserving the old profile supports rollback; a much later rollback may still
require signing in again if its saved refresh token has become obsolete.

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
  Its exact Tauri origins are allowed by the shared-media service. The legacy
  Drive path has also passed an authenticated encrypted roundtrip with a real
  historical-format file and a denied request from an unrelated conversation.
- The Windows WebView2 memory target drops to Low when the window is unfocused
  or minimized and no call is active, and returns to Normal for an active call
  or a focused restored window. It does not suspend the renderer or its network
  connection. Older unsupported WebView2 versions retain normal behavior.
- IPC permissions are explicitly assigned only to the local main window.
  External navigation and popup creation are denied; there is no general
  filesystem, command execution or authenticated HTTP proxy exposed to React.

The release build excludes test-only browser arguments and data-directory
overrides. Native file paths come from the operating system's save dialog, not
renderer input. Incomplete files are removed on ordinary errors and shutdown;
an operating-system kill or crash can leave a `.hush-*.part` temporary file.

## Signed updates

Release builds check the separate `rust-preview/rust-latest.json` GitHub release
channel after initial startup and periodically afterward. Debug builds report
updates disabled. Downloads use a restricted GitHub origin and bounded temporary
file, and the updater verifies both the package signature and signed version
before accepting an installer. The application contains the public verification
key; the private signing key belongs only in the build secrets. Electron's
`latest.yml` is a separate, incompatible channel.

The workflow includes verification of a genuine signed installer plus rejection
of corrupted bytes and a substituted version. Publishing artifacts is separate
from exercising a complete installed N-to-N+1 update. Installation, interruption
during calls and rollback still require that end-to-end acceptance check before
the preview can replace the stable desktop client.

## Windows evidence and remaining parity checks

`scripts/verify-rust.mjs` has passed against the actual packaged
`https://tauri.localhost` origin: sign-in rendering, native controls, close,
restricted navigation, non-extractable IndexedDB identity persistence across
reload, authenticated-encryption roundtrip and tamper rejection.

Rust/Electron interoperability has also passed using real native hosts and the
production signaling/TURN service, with development assets and synthetic
microphone/camera sources. Bidirectional audio/video, forced TURN TLS over
TCP/443, real test-window capture with Windows system audio and reconnection
were verified. These checks did not exercise physical headsets or the release
installer's packaged origin. Capture automation selected a uniquely titled test
window through debug-only flags; it did not verify the product source-picker UI.

| Area | Remaining evidence before replacing Electron |
| --- | --- |
| Existing accounts and encrypted history | Verify the distributed bridge-to-Rust installer sequence with a retained real installation and rollback. The isolated Windows account handoff has passed; never delete or overwrite the source profile. |
| Calls | Physical microphones/cameras/headsets, RNNoise, output device selection, direct connectivity and the installed packaged release. The verified synthetic-media forced-TURN test does not cover these. |
| Screen sharing | User-controlled monitor/window selection, the product chooser UI and full Hush picker parity. The verified window/system-audio capture does not establish those interactions. |
| Attachments | Broader media/file combinations, save-dialog interaction and interrupted-download behavior in the installed app. One verified legacy encrypted roundtrip does not cover every historical attachment. |
| Music | Real YouTube/Spotify playback and synchronized playback, including embedded-player origin/referrer behavior. |
| Notifications | Installed-app activation, focus and conversation routing with DND/mute and custom sounds. Preserving the sound files during migration does not prove notification delivery or Action Center activation. |
| Themes and interaction | Compare actual views, popovers, dragging, resizing, maximization, shortcuts and glass on target systems. |
| Updates and installer migration | A published signed channel, an actual installed upgrade, interruption during calls and rollback. Keep the retained Electron bridge installed until migration has succeeded. |
| Other platforms | Validate macOS/Linux independently. They use WebKit rather than Windows WebView2, so WebRTC, screen/audio capture and optical effects can differ. Android stays on Capacitor. |

The preview deliberately does not register itself as the operating-system handler
for the stable app's `hush://` links. That remains a separate installer decision.

## Measured performance and limits

The initial Windows release-build comparison used the same fresh unauthenticated
Liquid Glass sign-in screen at 1440x900, ten samples per runtime after settling,
and complete owned process trees. Median summed working set was about 387.5 MiB
for Rust and 389.0 MiB for Electron: essentially unchanged. Median private committed
memory was about 275.5 MiB versus 322.5 MiB. This was not a signed-in workload,
active-call test or cold-start benchmark, and predates the latest optimizations.

A separate five-samples-per-phase test measured the new background policy in
the debug Rust host with the actual sign-in UI served by Vite. For the same
minimized process tree, private resident memory fell from 153.0 to 35.3 MiB
(76.9%) when moving from Normal to Low. Summed working set fell from 446.1 to
109.2 MiB; private committed memory fell from 311.6 to 297.6 MiB (4.5%). Timers
and all 46 WebSocket echo messages continued, and the restored UI responded.
A synthetic native call-active guard restored Normal while hidden; this did not
measure the memory of an actual call. The result demonstrates reclaiming
background resident pages, not an equivalent reduction in committed memory or
foreground usage.

Measure release builds with identical accounts, messages, themes, window size
and media state. Include the complete process tree: the Rust process **and**
all its WebView2 browser, renderer, utility and GPU processes, just as all
Electron processes must be counted. Record private bytes, working set, CPU,
startup and UI responsiveness separately for idle, chat, call and screen share.
Do not compare just the small Rust host with the whole Electron application,
or present installer size as proof of lower runtime RAM.

Private resident memory counts private physical pages; private committed memory
need not be resident. Summed working set can count shared pages more than once.
`scripts/verify-rust-memory.mjs` reproduces the isolated background-policy check.
No wall-clock startup improvement, general foreground RAM reduction or all-device
speedup has been established. Passing unit tests alone does not establish full
functional parity.

## Primary references

- [Tauri architecture](https://v2.tauri.app/concept/architecture/)
- [WebView engines](https://v2.tauri.app/reference/webview-versions/)
- [Capability boundaries](https://v2.tauri.app/security/capabilities/)
- [Signed updater requirements](https://v2.tauri.app/plugin/updater/)
