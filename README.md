# Hush

![Hush logo](public/favicon.svg)

A private space for small groups: servers, channels, DMs, calls, and screen
sharing, with encryption made visible and verifiable in the interface.

## Local development

```bash
npm install
npm run dev
```

The client starts at `http://127.0.0.1:5173`. Without Supabase credentials,
it shows an empty local workspace; when Supabase is configured, it shows the
username/password registration and login screens.

The workspace contains no demo servers, channels, users, or messages. After
login, it reads only the profiles, spaces, and conversations permitted by the
Supabase project's RLS policies. An empty database produces an empty workspace.

## Connect Supabase

1. Create a Supabase project in the region closest to your group.
2. From the **Connect** panel, copy the Project URL and Publishable key into
   `.env`:

   ```env
   VITE_SUPABASE_URL=https://project-ref.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   VITE_MUSIC_BRIDGE_URL=https://music.example.com
   ```

3. Follow the [complete Supabase setup guide](docs/SUPABASE_SETUP.md) and run
   the migrations in order: the initial migration, the username/password
   migration, and `20260821203000_functional_mvp.sql`.
4. In **Realtime Settings**, disable **Allow public access**. Hush uses only
   private channels authorized through RLS.
5. In **Authentication → Providers → Email**, keep the provider enabled,
   enable **Allow new users to sign up**, and disable **Confirm Email**. Hush
   uses technical, non-deliverable identifiers instead of user email
   addresses.
6. In **Authentication → Password Security**, set a minimum password length
   of 12 characters and, if your plan supports it, enable compromised-password
   protection.
7. Restart `npm run dev`, choose **Create account**, and register with a
   username and password.

Never put `service_role`, a database password, or the JWT secret in a
`VITE_*` variable: every value with that prefix is exposed in the browser
bundle.

## Commands

```bash
npm run test
npm run build
```

## Windows desktop app

To run Hush as an Electron app during development:

```bash
npm run desktop:dev
```

To create the Windows x64 installer:

```bash
npm run desktop:build
```

The installer is written to `release/Hush-Setup-<version>.exe`. The desktop
build uses the local `hush://` protocol, context isolation, and sandboxing;
external links, unauthorized navigations, and media permissions from origins
other than Hush are blocked. On Windows, screen sharing opens an internal
picker so the user can explicitly choose a window or display.

`VITE_*` variables are embedded into the client at build time. Configure `.env`
before creating the installer and use only the Supabase Project URL and
Publishable key. The local installer is not digitally signed, so Windows
SmartScreen may show a warning. Distributing it without that warning requires
a code-signing certificate.

## Automatic updates

Packaged desktop builds use `electron-updater` with GitHub Releases. A
packaged app checks for updates at startup and every four hours, downloads a
new release in the background, and asks whether to restart. Updates are
configured for the Windows NSIS installer and Linux `deb`/AppImage packages.

Releases are built by [`.github/workflows/release.yml`](.github/workflows/release.yml)
when a tag matching `v*` is pushed. The tag must match the version in
`package.json`; for example:

```bash
npm version patch --no-git-tag-version
git add package.json package-lock.json
git commit -m "Release v0.3.13"
git tag v0.3.13
git push origin main --follow-tags
```

Before the first release, add the `VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_MUSIC_BRIDGE_URL` repository secrets
in GitHub if the distributed desktop build should connect to Supabase and the
Windows bridge by default. Never add a service role key or database
credentials. To disable update checks in a packaged diagnostic build, set
`HUSH_DISABLE_AUTO_UPDATE=1` before launching it.

Open **Settings → Updates** to see the installed version, download progress,
retry a failed check, or restart to install a downloaded version. The feed is
`https://github.com/DexiAkaStompa/hush/releases`. Keep the installer, blockmap,
and `latest*.yml` assets together when publishing a release. A source-only
release cannot update installed clients.

## Profile and voice settings

Apply `supabase/migrations/20260904230343_profile_media.sql` once before using
profile customization. It adds avatar/banner paths, a 190-character bio, and
the private `profile-media` Storage bucket. Authenticated Hush users can read
profile images; only the owner can upload or delete files in their folder.
Profile images are not end-to-end encrypted. Uploads preserve PNG, JPEG, GIF,
and WebP bytes, including animation, up to 8 MiB. The client also checks a
maximum size of 4096 × 4096 pixels. Replaced images are deleted after saving.
Existing installations can still load profiles before this migration is applied.

**Settings → Voice and video** selects the microphone, call output device,
camera, input/output volume, echo cancellation, and automatic gain control.
Microphone and call output settings apply to an active call; camera selection
applies on the next activation. A disconnected input must be replaced with an
available device or the system default. Music and interface sounds keep their
own volume/output behavior. Microphone testing is local and stops when leaving
the voice settings. Rerouting call output requires `HTMLMediaElement.setSinkId`.

Noise suppression defaults to **RNNoise**, a free local WebAssembly filter
running in an AudioWorklet at 48 kHz. Its worklet and both WASM variants are
bundled with the app, with no account, service, or model download at runtime.
Standard browser suppression and unfiltered audio are also available. RNNoise
does not stack with browser noise suppression. If the device or filter fails,
the client displays an error; select another input or the standard filter.
Third-party licenses are included in [docs/licenses](docs/licenses) and the
desktop package. Krisp is not used.

Invites use the native clipboard in Electron, with a selectable link and a
retry button if copying fails in the browser. Recipients paste the link into
**Server → Use invite**; automatic OS handling of invite links is not configured.

The interface uses patterns adapted from the collections listed in the brief:
messaging/sidebar and accessible controls from Untitled UI, dot patterns and
animated lists from Magic UI, and encrypted text and focused glow from
Aceternity UI. All code is local; the app does not load third-party images,
fonts, or analytics.

Supabase Auth manages sessions and passwords. Each username is locally mapped
to a technical identifier such as `username@users.hush.invalid`, which is
never shown to users. Supabase stores only the corresponding bcrypt hash with
a random salt. Postgres stores ciphertext and minimal metadata; Realtime
Broadcast distributes new records on conversation-scoped topics.

Without an email address or phone number, there is no automatic password
recovery. An administrator can assign a new password through Supabase Auth
Admin (`auth.admin.updateUserById`), executed only from a server-side
environment with the Secret key. Do not store passwords or alternate hashes
in `public` tables and do not edit `auth.users` directly.

Read the [E2EE architecture](docs/ARCHITECTURE.md) before connecting real
users. The [client-only music player](docs/MUSIC_BRIDGE.md) synchronizes
commands and playback position through Supabase without requiring an audio
server. It supports direct HTTPS sources; a public Lavalink node cannot be
used directly as a browser audio stream.

## License

Hush is distributed under the **Hush Source-Available Reciprocity License
(HSRL) 1.0**, available in [LICENSE](LICENSE). Non-commercial use is allowed.
Commercial use or distribution, including offering a modified version as a
service, requires making the Corresponding Source for that same version freely
available under the same license. (so basically you can use this to make a paid version but 
you're gonna have to public the whole source of the app or i WILL sue your ass) 

HSRL is a custom source-available license and is not an OSI-approved Open
Source license. For commercial distribution, have the terms reviewed by a
qualified legal professional.
