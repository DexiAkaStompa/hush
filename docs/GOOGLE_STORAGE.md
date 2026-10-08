# Private shared media storage

`supabase/functions/shared-media` is the server boundary for the shared Google
Drive media pool. Clients must upload the AES-GCM ciphertext, never plaintext.
The function authenticates the Supabase bearer token, checks that the caller is
an active member of the requested conversation, and only then calls Google
Drive with the owner OAuth grant.

## Production configuration

Create a production Supabase Edge Function secret for each of these values:

- `GDRIVE_CLIENT_ID`
- `GDRIVE_CLIENT_SECRET`
- `GDRIVE_REFRESH_TOKEN`
- `GDRIVE_FOLDER_ID` (the existing `Hush-Media` folder)
- `SHARED_MEDIA_ALLOWED_ORIGINS` (comma-separated; production desktop is
  `hush://app`, while local Vite uses `http://127.0.0.1:5173`)

The function also uses Supabase's injected `SUPABASE_URL` and the public/anon
key (`SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`) to verify the caller
and read the RLS-protected `conversation_members` relation. The function does
not use a service-role key.

The current endpoint contract is:

- `POST ?conversationId=<UUID>&attachmentId=<UUID>` with
  `Content-Type: application/octet-stream` and at most 16 MiB plus the 16-byte
  GCM tag **per request**, rather than per attachment. It returns `{ "fileId": "..." }`.
  Large files use `&chunkIndex=<index>` with independently authenticated 8 MiB
  chunks, followed by a small encrypted manifest without `chunkIndex`.
  Retrying the same chunk reuses its file after checking the encrypted checksum.
- `GET ?conversationId=<UUID>&fileId=<Drive file ID>` returns private
  `application/octet-stream` bytes after checking the Drive parent folder and
  `appProperties.conversationId`.
  For a chunked attachment, add `&chunkIndex=<index>` and use the manifest file ID.
  The selected chunk must also match the manifest's attachment ID and uploader.
- `GET ?status=1` returns `{ "configured": boolean }` after Supabase auth and
  does not contact Google.

The Drive file stores `conversationId` and `attachmentId` in private
`appProperties`. The function never creates an `anyone` permission or returns a
Drive URL. Do not expose the OAuth values through an installer, renderer,
setup code, CI artifact, or client environment. Credential packaging, CI injection, and setup-code export/import have been disabled.
The legacy Electron upload/download path remains for compatibility with existing
local installations; the shared endpoint takes precedence when configured.

## Client rollout

The production function is deployed at
`https://zvzyzuzlqbuvvffxyquk.supabase.co/functions/v1/shared-media`.
The repository variable `VITE_SHARED_MEDIA_URL` enables it in desktop releases
starting with v0.5.31. Owner OAuth credentials are stored only as server secrets.
Deployment verification passed an authenticated AES-GCM upload/download,
decryption, and a denied request for a conversation the caller did not belong to.
The temporary verification account, space, and Drive file were removed afterward.

Add `VITE_SHARED_MEDIA_URL` to the production client environment, pointing to
the deployed function URL, The media client already calls this endpoint
for both desktop and browser clients when configured. Existing attachment records remain
readable through the old path during a staged rollout; no data migration is
included here. New uploads should switch only after the function has passed an
authenticated integration test against the existing folder.

The owner refresh token is long-lived but not permanent: Google can revoke or
expire it. Production operations must retain a reauthorization runbook and
monitor `invalid_grant`, Drive quota, 403, 429, and 5xx responses. This function
has an isolate-local concurrency guard; durable per-user rate limits, quota
accounting and resuming interrupted uploads across app restarts remain deployment work.

## Large attachments and annual retention

Release v0.5.32 removes the application's 16 MiB attachment cap when shared
Drive is configured. Encryption and uploads run sequentially in 8 MiB blocks;
the encrypted manifest is published last. Progress, cancellation, and transient
network retries are supported. A cancelled upload's partial blocks are covered
by annual retention. Legacy storage configurations retain their original cap.

Large attachments and generic files download only on request. Desktop clients
write authenticated plaintext blocks to a temporary disk file, then rename it
after completion; cancelling removes the temporary file. Browsers with the File
System Access API also write incrementally to disk. Other browsers use Blob
parts and may need memory proportional to file size. Users must update to
v0.5.32 to read chunked attachments. Drive capacity, API quotas and device free
disk space still apply.

`hush-annual-drive-cleanup` runs in Supabase pg_cron on **January 1**, with hourly
retries throughout that day (`23 * 1 1 *`, UTC). It invokes the authenticated
`shared-media-cleanup` function, which continues in bounded batches and rescans
after deletion so changing Drive pagination cannot silently skip files.
This scheduler does not depend on repository activity or an open client app.

The policy permanently removes only Hush-managed binary files in `Hush-Media`
whose creation time is strictly more than twelve calendar months old. This
includes attached files, manifests, chunks, and old incomplete uploads. It
keeps newer files, folders, unrelated files, and everything outside that folder.
Each file's scope and creation time are checked again immediately before deletion.
The policy is annual cleanup, rather than deletion on each file's anniversary:
files can remain longer than twelve months until the next annual run. Messages
remain in chat; their deleted attachments show an unavailable/expired error.

The maintenance key is held in Edge secrets (`SHARED_MEDIA_CLEANUP_SECRET`) and
Vault (`hush_drive_cleanup_secret`). Ordinary app users cannot read the Vault or
invoke cleanup. The manual GitHub workflow `Hush Drive cleanup maintenance`
defaults to a dry run and uses only a separate maintenance key; Google owner
credentials are never provided to GitHub. It is available for previews or recovery.
Check Edge Function logs and `cron.job_run_details` after annual runs; if an
upstream outage lasts the entire scheduled day, rerun the maintenance workflow.

Production verification passed a 20 MiB attachment roundtrip through the real
client chunk encoder/decoder and deployed service, with at most 8 MiB + 28 bytes
per chunk request. A cleanup fixture confirmed permanent deletion of an expired
managed file while preserving a recent file and an unrelated old file. The
pg_net/Vault scheduler invocation returned HTTP 200 in dry-run mode. All
verification files and temporary user data were removed.

Publish the existing Google OAuth consent screen for production and keep the
existing client ID to retain drive.file access to the existing folder. A new
OAuth client requires granting access to that folder again.
Testing-mode external OAuth grants can expire after seven days. See Google's
[OAuth guidance](https://developers.google.com/identity/protocols/oauth2),
[Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
and [Drive quota limits](https://developers.google.com/workspace/drive/api/guides/limits).
