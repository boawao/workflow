-- 下午茶品項分組（例如「餅」「飲料」），每組各選一項
alter table public.menu_items add column grp text not null default '';
alter table public.orders add column grp text not null default '';
alter table public.orders drop constraint orders_kind_order_key_user_id_key;
alter table public.orders add constraint orders_kind_order_key_user_id_grp_key unique (kind, order_key, user_id, grp);
