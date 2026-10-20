# Call relay and network recovery

Hush tries a direct WebRTC connection first. Cloudflare TURN provides UDP, TCP
and TLS/443 alternatives when a VPN, firewall or NAT prevents that connection.
TURN forwards encrypted WebRTC traffic; it does not terminate the media encryption.
This improves connectivity but cannot bypass a network that blocks the relay itself.

## Deployed configuration

- Worker: `hush-turn-credentials`, configured in `infra/turn/wrangler.jsonc`.
- Endpoint: `https://hush-turn-credentials.mattiapalermo317.workers.dev/credentials`.
- Public build variable: `VITE_TURN_URL`, configured in GitHub Actions and local `.env.local`.
- Worker secrets: `TURN_KEY_ID`, `TURN_KEY_API_TOKEN`, `SUPABASE_PUBLISHABLE_KEY`.
  Never place the permanent TURN API token in any `VITE_` variable or client bundle.
- Database migration: `20261020202154_turn_credential_limits.sql`.

The broker validates the caller's Supabase session, conversation membership and
`connect` permission before issuing one-hour credentials. An atomic database gate
allows 20 requests per account per ten minutes. Credentials remain in client
memory, are refreshed before expiry during long calls and are never persisted.
The broker accepts only the configured app origins and returns no-store responses.

Cloudflare's published TURN allowance at setup is 1,000 GB per month, followed by
$0.05/GB. Traffic and billing are managed in the owning Cloudflare account.
Revoke or rotate the TURN key there if access must be terminated. After rotation,
replace both Worker secrets; do not publish the permanent key to GitHub.

## Deployment

Apply the database migration, configure the three Worker secrets with Wrangler,
then run `npx wrangler deploy --config infra/turn/wrangler.jsonc`. Regenerate
binding types after changing the configuration:

```
npx wrangler types infra/turn/env.d.ts --config infra/turn/wrangler.jsonc --env-interface TurnEnv --include-runtime false --strict-vars false
```

Add any future web app origin explicitly to `ALLOWED_ORIGINS`. The current list
covers the desktop protocol, Android's HTTPS localhost and Vite development.
If the broker is unavailable, direct calls remain available; connection details
report whether a relay is available and which path the current call uses.

## Regression checks

Unit tests cover authorization, rate limiting, credential validation, simultaneous
offers, queued track changes, early ICE and bounded reconnect attempts.
The October 2026 desktop integration check used two disposable authenticated users,
real nonzero generated audio and the actual app in two Electron instances. Both
peers were forced to `iceTransportPolicy: relay` with only Cloudflare TLS/443 URLs.
Selected candidates were relay/relay with TLS and inbound audio energy plus active
HTML audio playback were verified on both sides, including a transient disconnect.

Receiver streams are preserved during transient disconnections. ICE restarts are
bounded and retry again after an online event. The widget reports transport state
separately from signaling state, so a connected signaling channel alone does not
show a successful audio connection.
