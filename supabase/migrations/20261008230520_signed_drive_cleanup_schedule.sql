-- Hosted Supabase owns pg_net and retains PUBLIC table grants. Never put the
-- persistent maintenance key in its request queue; queue a short-lived HMAC.
select cron.schedule(
  'hush-annual-drive-cleanup',
  '23 * 1 1 *',
  $job$
  with payload as (
    select '{"dryRun":false,"automatic":true}'::jsonb as body,
      floor(extract(epoch from now()))::bigint::text as timestamp,
      (select decrypted_secret from vault.decrypted_secrets where name='hush_drive_cleanup_secret') as signing_key
  )
  select net.http_post(
    url := 'https://zvzyzuzlqbuvvffxyquk.supabase.co/functions/v1/shared-media-cleanup',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'x-hush-cleanup-timestamp',timestamp,
      'x-hush-cleanup-signature',encode(extensions.hmac('hush-drive-cleanup:' || timestamp || ':' || body::text,signing_key,'sha256'),'hex')
    ),
    body := body,
    timeout_milliseconds := 120000
  ) from payload;
  $job$
);
