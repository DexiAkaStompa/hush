create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- The cleanup key is provisioned separately in Vault and Edge secrets.
-- Retry hourly on January 1; each authorized function continues in bounded batches.
select cron.schedule(
  'hush-annual-drive-cleanup',
  '23 * 1 1 *',
  $$
  select net.http_post(
    url := 'https://zvzyzuzlqbuvvffxyquk.supabase.co/functions/v1/shared-media-cleanup',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-hush-cleanup-key', (select decrypted_secret from vault.decrypted_secrets where name = 'hush_drive_cleanup_secret')
    ),
    body := '{"dryRun":false,"automatic":true}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
