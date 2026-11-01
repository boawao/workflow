-- 便當收單：有這一天的紀錄就代表當天已截止
create table public.lunch_closures (
  order_date date primary key,
  closed_at  timestamptz not null default now()
);
alter table public.lunch_closures enable row level security;
