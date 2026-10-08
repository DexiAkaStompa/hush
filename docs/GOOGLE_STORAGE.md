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
  GCM tag. It returns `{ "fileId": "..." }`.
- `GET ?conversationId=<UUID>&fileId=<Drive file ID>` returns private
  `application/octet-stream` bytes after checking the Drive parent folder and
  `appProperties.conversationId`.
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
accounting, orphan cleanup, and resumable uploads remain deployment work.

Publish the existing Google OAuth consent screen for production and keep the
existing client ID to retain drive.file access to the existing folder. A new
OAuth client requires granting access to that folder again.
Testing-mode external OAuth grants can expire after seven days. See Google's
[OAuth guidance](https://developers.google.com/identity/protocols/oauth2),
[Drive scope guidance](https://developers.google.com/workspace/drive/api/guides/api-specific-auth),
and [Drive quota limits](https://developers.google.com/workspace/drive/api/guides/limits).
