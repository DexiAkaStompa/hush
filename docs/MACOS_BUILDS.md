# macOS builds

Every version tag now builds Windows, Linux and macOS before publishing a GitHub
release. The macOS job runs on Apple's ARM64 hardware via GitHub's `macos-15`
runner and builds both Intel (`x64`) and Apple Silicon (`arm64`) packages.

Each architecture produces `Hush-VERSION-mac-ARCH.dmg` and `.zip`. The ZIPs and
shared `latest-mac.yml` are retained for Electron's updater metadata. CI checks
both bundle signatures, permission descriptions, archive presence and updater
checksums, then launches the native ARM64 package and verifies the sign-in screen
and preload bridge. Intel voice/video and device permissions still need testing
on an actual Intel Mac; the startup check does not exercise calls or screen sharing.

These builds use an **ad hoc signature**, not an Apple Developer ID certificate,
and are **not notarized**. Gatekeeper may block or warn about downloaded builds.
An ad hoc signature does not establish a trusted publisher. Automatic updates on
macOS should not be considered validated until Developer ID signing and
notarization are configured and tested.

No Apple account, certificates or extra CI secrets are required for these builds.
To build locally on a Mac: run `npm ci`, `npm run icons:build`, `npm run build`,
then `npm run desktop:mac -- --publish never`.

For normal public distribution, replace the ad hoc identity with Developer ID
signing, enable hardened runtime and notarization, and store the signing material
as GitHub Actions secrets. Never commit certificates or Apple credentials.
