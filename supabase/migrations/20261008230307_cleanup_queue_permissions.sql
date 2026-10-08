-- pg_net's queue contains authorization headers until requests are processed.
-- Cron runs as postgres; ordinary client roles must not inspect or modify it.
revoke all on table net.http_request_queue from public, anon, authenticated;
