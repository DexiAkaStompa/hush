# Server, group and channel identity

Open a server's title and choose **Personalizza server**, or open **Gestisci
server → Identità e aspetto**. For a group or channel, select the settings
button next to its name in the conversation header.

The editor includes a live preview, an 80-character name, a 500-character
description, a custom icon and cover, six accent presets and a custom color.
Images accept PNG, JPG and WebP up to 8 MiB. They are cropped centrally and
encoded as compact WebP artwork (128×128 icons and 960×320 covers), with
strict stored payload bounds. Icons and covers can be removed independently.
Uncommitted edits stay in the editor until saved; closing a changed editor
through Escape, the backdrop or its close button offers a discard choice.

Owners and administrators manage server/channel identity. Every active member
can edit a group DM's shared identity. The RPC verifies these permissions on
the server; display-only controls do not grant write access. Identity metadata
is visible to members under the existing RLS policies and is not message E2EE
ciphertext. Changes propagate through RLS-protected Realtime subscriptions.

The migration `20261017232100_community_identity.sql` must be applied before
deploying the client that selects the new columns. Existing client versions
continue to read their original fields. A newly customized two-person group
uses its shared name instead of replacing it with the recipient's profile name.

Additional interface fixes in this release include collapsible channel
categories, permission-aware channel creation controls, themed confirmations
for deletion/leaving, and a user context menu rendered outside the app's
clipping boundaries. Nested dialogs isolate the top layer, trap focus and
close only that layer on Escape, then return focus to the opener.

Verified with the local test suite, a temporary real owner/member/outsider
scenario, image encoding, all six themes and a 390px mobile viewport. Temporary
test users, server and group are removed after integration checks. This does
not add custom role definitions or per-channel permission overrides beyond
the existing owner/admin/member and read-only channel controls.
