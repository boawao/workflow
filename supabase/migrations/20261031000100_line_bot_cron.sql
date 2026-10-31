-- 週一到週五 09:00、11:00、13:00、15:00、17:00（台北時間）推播待辦提醒
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'line-bot-todo-reminder',
  '0 1,3,5,7,9 * * 1-5',   -- UTC，等於台北 9/11/13/15/17 點
  $$
  select net.http_post(
    url := 'https://onzqllxxfzwaghbewphi.supabase.co/functions/v1/line-bot/reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'line_bot_cron_secret')
    ),
    body := '{}'::jsonb
  )
  $$
);
