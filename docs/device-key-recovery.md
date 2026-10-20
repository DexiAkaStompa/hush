# Device key synchronization

Device identities are independent, non-extractable ECDH private keys in IndexedDB.
Signing into the same account on another device does not copy that identity.

Conversation initialization now uses `initialize_conversation_key_envelopes`:
the creator must be a current member, the whole batch must target that conversation
at slot zero, and a transaction advisory lock prevents concurrent initialization.
Existing envelopes prevent initialization, even if the calling device has none.
The client always reads its persisted envelope before using a key.

Earlier clients could create a second room key for a creator's newly registered
device while the other devices retained their original slot-zero key. Recovery
preserves both keys and every original ciphertext. Each available room key gets
an additional immutable envelope slot, identified by the first 48 SHA-256 bits
plus one. This is a recovery slot identifier, **not a new message epoch**; existing
message and attachment authenticated contexts remain unchanged.

Current members exchange each recovered key with other current, non-revoked
devices through the existing ECDH/HKDF/AES-GCM envelope protocol. The missing-slot
RPC returns only recipient IDs and slot numbers. It never returns another
device's encrypted envelopes or any plaintext key. Completed slots require no
repeated wrapping. Unchanged envelopes reuse locally decoded keys in memory.

The smallest available recovery slot selects the sending key deterministically.
All recovered keys can decrypt historical text, edits, snippets and attachments;
AES-GCM still rejects an incorrect conversation or attachment context.
The active conversation checks for missing keys every five seconds and reloads
its messages when its key set changes. A new device waits instead of inventing
a replacement key. The original slot zero remains for older clients; update
all clients to prevent them from creating further splits.

For an existing split, open the affected conversation on the updated devices
while both are online. Each branch must still have at least one device able to
unwrap its old key. Do not erase application data to resolve a key error.
No server-side process can recover a key if all its device identities have been
lost; this follows from the end-to-end encryption model.

Verification includes database authorization and initialization tests, historical
text/binary recovery tests, and a live integration check with isolated IndexedDB
partitions, two devices for one account, another member and an unrelated account.
