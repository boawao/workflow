-- LINE 官方帳號：待辦事項、訂餐、AI 轉交

create table public.members (
  user_id      text primary key,            -- LINE userId
  name         text not null default '',
  is_owner     boolean not null default false,
  lunch_default text,                       -- 上次的便當品項，沒改就沿用
  created_at   timestamptz not null default now()
);

create table public.todos (
  id             bigint generated always as identity primary key,
  title          text not null,
  detail         text not null default '',
  priority       text not null default 'other' check (priority in ('urgent', 'important', 'other')),
  status         text not null default 'open' check (status in ('open', 'done')),
  due            text,                      -- AI 判斷的期限，原文字串，例如「今天下午三點前」
  requester_id   text references public.members(user_id),
  requester_name text not null default '',
  source_text    text not null default '',
  created_at     timestamptz not null default now(),
  done_at        timestamptz
);
create index todos_open_idx on public.todos (status, priority, created_at);

create table public.tea_rounds (
  id         bigint generated always as identity primary key,
  store      text not null,
  is_open    boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.menu_items (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('lunch', 'tea')),
  round_id   bigint references public.tea_rounds(id),  -- 下午茶才有
  name       text not null,
  price      integer,
  sort       integer not null default 0,
  active     boolean not null default true
);

create table public.orders (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('lunch', 'tea')),
  order_key  text not null,                -- 便當：YYYY-MM-DD；下午茶：round id
  user_id    text not null references public.members(user_id),
  item_name  text not null,                -- 「不訂」代表今天不吃
  price      integer,
  created_at timestamptz not null default now(),
  unique (kind, order_key, user_id)
);

-- 只讓 Edge Function（service role）讀寫
alter table public.members    enable row level security;
alter table public.todos      enable row level security;
alter table public.tea_rounds enable row level security;
alter table public.menu_items enable row level security;
alter table public.orders     enable row level security;

-- 排程呼叫 Edge Function 用的密鑰：在資料庫內隨機產生並存進 Vault，不經過任何人手上
select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'line_bot_cron_secret');

create function public.line_bot_cron_secret()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'line_bot_cron_secret'
$$;
revoke all on function public.line_bot_cron_secret() from public, anon, authenticated;
grant execute on function public.line_bot_cron_secret() to service_role;
