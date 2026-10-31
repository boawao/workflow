-- 同事沒寫期限時，先預設 3 小時並反問對方；回覆前 awaiting_due = true
alter table public.todos add column awaiting_due boolean not null default false;

-- 提醒改為週一到週五 08:00、11:00、15:00（台北時間）
select cron.alter_job(
  (select jobid from cron.job where jobname = 'line-bot-todo-reminder'),
  schedule := '0 0,3,7 * * 1-5'
);
