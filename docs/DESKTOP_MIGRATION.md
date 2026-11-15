# Electron to Rust account handoff

The handoff reuses the existing encrypted device-envelope protocol. It does not
export the old non-extractable identity, copy Chromium databases into WebView2,
or put a plaintext account snapshot or room key on disk.

## Runtime sequence

1. The Rust renderer creates a fresh ephemeral ECDH P-256 recipient key and a
   five-minute handshake. The native host opens a current-user Windows pipe and
   starts the retained, bridge-capable Electron executable. A random pipe token
   authenticates the connection; native process/pipe ownership checks belong to
   the Rust host.
2. The old trusted main renderer reads its existing identity without creating or
   upgrading that database. It verifies the signed-in account with Supabase,
   refreshes a session with less than six minutes remaining, and pauses its
   automatic refresh. Active calls and incoming ringing calls block the handoff.
3. Source and target derive separate directional AES-GCM keys through ECDH and
   HKDF-SHA256. Transfer ID, random challenge, expiry, direction and sequence are
   authenticated. Replay, reordered frames, tampering and expired exchanges fail.
4. The old renderer sends the session and approved settings in encrypted frames.
   Custom notification and ringtone files are sent in 256 KiB encrypted chunks;
   each chunk requires an encrypted acknowledgement before the next is sent.
5. The destination verifies the account before importing anything, pauses refresh,
   registers its own non-extractable device identity, and proves that registered
   device belongs to the same account. Origin-specific audio device IDs are
   mapped using hardware labels; unavailable devices fall back to the default.
   Label enumeration is best effort: hidden documents skip it and visible
   documents have a 750 ms limit. It never opens the microphone for migration.
6. The old renderer loads every accessible conversation keyring for its original
   identity and calls the existing encrypted envelope-sharing API. The destination
   loads every listed keyring before acknowledging completion. Raw room keys
   never travel through the local pipe or a plaintext server API.
7. The target sends current session checkpoints inside encrypted `target-ready`
   and `commit` frames. The source verifies their account, saves the current
   session through its normal auth store, and remains paused. This preserves a
   rollback login if the session token changed during the exchange.
8. The source sends encrypted `finished`, then its native pipe handler flushes a
   `complete` control line before closing and asking the old process to quit.
   The target marks success only after verification, resumes its refresh, and
   renders the normal app. Native EOF after `complete` is not an abort.

## Data inventory

The allowlist contains theme, microphone/camera/output settings, per-user audio
settings, status, muted conversations, recent emoji, room-music volume, active
space/conversation and per-account workspace preferences. It excludes arbitrary
storage, raw Supabase storage entries, Drive credentials and identity/key stores.

The two custom audio IndexedDB stores are preserved: notification sound (up to
10 MiB) and incoming-call ringtone (up to 15 MiB). Bundled sound-pack assets do
not need migration. Native IPC carries at most 2 MiB per JSON line; encrypted
plaintext frames are limited to 1 MiB. The steady-state application does not
retain the migration buffers.

## Failure and rollout

The original profile is retained. Source refresh resumes on an interrupted
handoff. The destination keeps only a non-sensitive pending marker for retry
and must show recovery before rendering a partially migrated chat. An existing
destination login is not automatically replaced. A completed marker prevents
the old account from being silently restored after an intentional logout.

On retry, the target records the expected account ID before importing auth.
Before creating Supabase, it discards only its own uncommitted copied session
for that exact project; blocked storage falls back to a read gate until a fresh
verified handoff is written. This prevents an obsolete copied refresh token
from revoking the retained source session through token-reuse detection. It
does not call server sign-out or alter an ordinary completed Rust account.

The currently installed Electron version must support this bridge. An unmodified
v0.5.65 executable cannot service these pipe arguments; an intermediate Electron
update or a verified retained migration utility is required before a Rust-only
upgrade can be seamless. Never launch a different Chromium engine directly over
the original profile just to bypass that rollout requirement.

The native pipe protects against other OS users and remote/browser callers. A
compromised process running as the same OS user can already access the app's
authenticated endpoint; this handoff does not claim to protect that endpoint.

## Actual Windows verification

`scripts/verify-desktop-migration.mjs` exercises the packaged Electron bridge and
the real Rust/WebView2 host, using fresh profiles and disposable backend users.
It requires the debug Rust binary, `release/win-unpacked/Hush.exe`, an authenticated
Supabase CLI and the dedicated Vite server on `127.0.0.1:5173`. Debug marker/profile
overrides are absent from release builds.

Run with `HUSH_RUN_LIVE_MIGRATION_TEST=1`. It creates a real encrypted message,
both custom sound files and settings in the Electron profile, closes that client,
and verifies automatic Rust handoff without a password. It compares both sound
hashes, checks the distinct non-extractable identity and readable history, sends a
new Rust message, restarts Rust without reopening Electron, and reopens the retained
original profile to confirm it still decrypts the new message. The successful run
also exercised legacy 12-character opaque refresh tokens.

The report goes to ignored `release-rust-check/desktop-migration-report.json`.
Created accounts, conversations and owned temporary profiles are removed in the
finalizer. No real user profile is opened or copied by this verification script.
