-- 消耗品領用：品項清單與領用紀錄（每次領用也會建立一筆行政待辦）
create table public.supply_items (
  id     bigint generated always as identity primary key,
  name   text not null,
  unit   text not null default '',
  sort   integer not null default 0,
  active boolean not null default true
);
create table public.supply_requests (
  id         bigint generated always as identity primary key,
  user_id    text not null references public.members(user_id),
  items      jsonb not null,               -- [{ name, unit, qty }]
  note       text not null default '',
  todo_id    bigint references public.todos(id),
  created_at timestamptz not null default now()
);
alter table public.supply_items    enable row level security;
alter table public.supply_requests enable row level security;

insert into public.supply_items (name, unit, sort) values
  ('A4 影印紙', '包', 0), ('A3 影印紙', '包', 1), ('原子筆（藍）', '支', 2), ('原子筆（黑）', '支', 3),
  ('原子筆（紅）', '支', 4), ('螢光筆', '支', 5), ('立可帶', '個', 6), ('便利貼', '本', 7),
  ('資料夾', '個', 8), ('L 夾', '個', 9), ('迴紋針', '盒', 10), ('釘書針', '盒', 11),
  ('膠帶', '捲', 12), ('黑色書背膠', '捲', 13), ('電池（3 號）', '顆', 14), ('電池（4 號）', '顆', 15);
