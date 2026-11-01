// 資料庫存取（service role，繞過 RLS）

import { createClient } from "npm:@supabase/supabase-js@2";

export const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  { auth: { persistSession: false } },
);

export type Priority = "urgent" | "important" | "other";

export interface Member {
  user_id: string;
  name: string;
  is_owner: boolean;
  lunch_default: string | null;
}

export interface Todo {
  id: number;
  title: string;
  detail: string;
  priority: Priority;
  status: "open" | "done";
  due: string | null;
  requester_id: string | null;
  requester_name: string;
  awaiting_due: boolean;
  created_at: string;
}

export interface MenuItem {
  id: number;
  kind: "lunch" | "tea";
  round_id: number | null;
  name: string;
  price: number | null;
  grp: string; // 下午茶分組，例如「餅」「飲料」；沒分組是空字串
}

export type NewItem = { name: string; price: number | null; grp?: string };

function check<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw r.error;
  return r.data;
}

export function todayTaipei(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
}

// ---------- 成員 ----------

export async function upsertMember(userId: string, name: string): Promise<Member> {
  const existing = check(await db.from("members").select("*").eq("user_id", userId).maybeSingle());
  if (existing) {
    if (name && existing.name !== name) {
      await db.from("members").update({ name }).eq("user_id", userId);
      existing.name = name;
    }
    return existing as Member;
  }
  return check(
    await db.from("members").insert({ user_id: userId, name }).select().single(),
  ) as Member;
}

export async function getOwner(): Promise<Member | null> {
  return check(
    await db.from("members").select("*").eq("is_owner", true).limit(1).maybeSingle(),
  ) as Member | null;
}

export async function setOwner(userId: string): Promise<void> {
  check(await db.from("members").update({ is_owner: false }).eq("is_owner", true));
  check(await db.from("members").update({ is_owner: true }).eq("user_id", userId));
}

// ---------- 待辦 ----------

export async function createTodo(t: {
  title: string;
  detail: string;
  priority: Priority;
  due: string | null;
  requester: Member;
  source_text: string;
  awaiting_due?: boolean;
}): Promise<Todo> {
  return check(
    await db.from("todos").insert({
      title: t.title,
      detail: t.detail,
      priority: t.priority,
      due: t.due,
      requester_id: t.requester.user_id,
      requester_name: t.requester.name,
      source_text: t.source_text,
      awaiting_due: t.awaiting_due ?? false,
    }).select().single(),
  ) as Todo;
}

export async function openTodos(): Promise<Todo[]> {
  return check(
    await db.from("todos").select("*").eq("status", "open").order("created_at"),
  ) as Todo[];
}

export async function getTodo(id: number): Promise<Todo | null> {
  return check(await db.from("todos").select("*").eq("id", id).maybeSingle()) as Todo | null;
}

export async function completeTodo(id: number): Promise<Todo | null> {
  return check(
    await db.from("todos").update({ status: "done", done_at: new Date().toISOString() })
      .eq("id", id).eq("status", "open").select().maybeSingle(),
  ) as Todo | null;
}

// 這位同事最近一筆還在等他回覆期限的待辦（24 小時內）
export async function awaitingDueTodo(userId: string): Promise<Todo | null> {
  return check(
    await db.from("todos").select("*").eq("requester_id", userId).eq("awaiting_due", true).eq("status", "open")
      .gte("created_at", new Date(Date.now() - 86400_000).toISOString())
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ) as Todo | null;
}

export async function setDue(id: number, due: string | null): Promise<Todo | null> {
  const patch = due === null ? { awaiting_due: false } : { due, awaiting_due: false };
  return check(await db.from("todos").update(patch).eq("id", id).select().maybeSingle()) as Todo | null;
}

// 現在起 3 小時後的台北時間，例如「14:30」
export function threeHoursLater(): string {
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false })
    .format(new Date(Date.now() + 3 * 3600_000));
}

export async function setPriority(id: number, priority: Priority): Promise<Todo | null> {
  return check(
    await db.from("todos").update({ priority }).eq("id", id).select().maybeSingle(),
  ) as Todo | null;
}

// ---------- 菜單與訂單 ----------

export async function lunchClosed(date: string): Promise<boolean> {
  return !!check(await db.from("lunch_closures").select("order_date").eq("order_date", date).maybeSingle());
}

export async function setLunchClosed(date: string, closed: boolean): Promise<void> {
  if (closed) check(await db.from("lunch_closures").upsert({ order_date: date }));
  else check(await db.from("lunch_closures").delete().eq("order_date", date));
}

export async function lunchItems(): Promise<MenuItem[]> {
  return check(
    await db.from("menu_items").select("*").eq("kind", "lunch").eq("active", true).order("sort"),
  ) as MenuItem[];
}

export async function replaceLunchItems(items: NewItem[]) {
  check(await db.from("menu_items").update({ active: false }).eq("kind", "lunch").eq("active", true));
  check(await db.from("menu_items").insert(
    items.map((it, i) => ({ kind: "lunch", name: it.name, price: it.price, sort: i })),
  ));
}

export async function openTeaRound(): Promise<{ id: number; store: string } | null> {
  return check(
    await db.from("tea_rounds").select("*").eq("is_open", true)
      .order("created_at", { ascending: false }).limit(1).maybeSingle(),
  );
}

export async function latestTeaRound(): Promise<{ id: number; store: string; is_open: boolean } | null> {
  return check(
    await db.from("tea_rounds").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
  );
}

export async function startTeaRound(store: string, items: NewItem[]) {
  check(await db.from("tea_rounds").update({ is_open: false }).eq("is_open", true));
  const round = check(await db.from("tea_rounds").insert({ store }).select().single());
  check(await db.from("menu_items").insert(
    items.map((it, i) => ({ kind: "tea", round_id: round.id, name: it.name, price: it.price, grp: it.grp ?? "", sort: i })),
  ));
  return round as { id: number; store: string };
}

export async function closeTeaRound(): Promise<void> {
  check(await db.from("tea_rounds").update({ is_open: false }).eq("is_open", true));
}

export async function teaItems(roundId: number): Promise<MenuItem[]> {
  return check(
    await db.from("menu_items").select("*").eq("round_id", roundId).order("sort"),
  ) as MenuItem[];
}

export async function getMenuItem(id: number): Promise<MenuItem | null> {
  return check(await db.from("menu_items").select("*").eq("id", id).maybeSingle()) as MenuItem | null;
}

export async function placeOrder(o: {
  kind: "lunch" | "tea";
  order_key: string;
  user_id: string;
  item_name: string;
  price: number | null;
  grp?: string;
}): Promise<void> {
  const row = { ...o, grp: o.grp ?? "" };
  const mine = () => db.from("orders").delete().eq("kind", o.kind).eq("order_key", o.order_key).eq("user_id", o.user_id);
  // 下午茶「這次不點」取代所有分組的選擇；選了品項就拿掉「不訂」
  if (o.kind === "tea" && o.item_name === "不訂") check(await mine());
  else if (o.kind === "tea") check(await mine().eq("item_name", "不訂"));
  check(await db.from("orders").upsert(row, { onConflict: "kind,order_key,user_id,grp" }));
  if (o.kind === "lunch" && o.item_name !== "不訂") {
    check(await db.from("members").update({ lunch_default: o.item_name }).eq("user_id", o.user_id));
  }
}

export async function myOrder(kind: "lunch" | "tea", orderKey: string, userId: string) {
  return check(
    await db.from("orders").select("*").eq("kind", kind).eq("order_key", orderKey)
      .eq("user_id", userId).maybeSingle(),
  ) as { item_name: string; price: number | null } | null;
}

// 我這次下午茶各組的選擇：{ 餅: "豬肉餡餅", 飲料: "…" }；選了不點則是 { "": "不訂" }
export async function myTeaOrders(roundId: number, userId: string): Promise<Record<string, string>> {
  const rows = check(
    await db.from("orders").select("grp,item_name").eq("kind", "tea").eq("order_key", String(roundId)).eq("user_id", userId),
  ) as { grp: string; item_name: string }[];
  return Object.fromEntries(rows.map((r) => [r.grp, r.item_name]));
}

export interface SummaryLine {
  name: string;
  item: string;
  price: number | null;
  carried: boolean; // 沒點，沿用上次
}

// 便當：今天有點的照點的；沒點但有「上次的品項」的沿用；選「不訂」的排除
export async function lunchSummary(date: string): Promise<SummaryLine[]> {
  const orders = check(
    await db.from("orders").select("user_id,item_name,price").eq("kind", "lunch").eq("order_key", date),
  ) as { user_id: string; item_name: string; price: number | null }[];
  const members = check(await db.from("members").select("*")) as Member[];
  const items = await lunchItems();
  const priceOf = (n: string) => items.find((i) => i.name === n)?.price ?? null;
  const byUser = new Map(orders.map((o) => [o.user_id, o]));
  const lines: SummaryLine[] = [];
  for (const m of members) {
    const o = byUser.get(m.user_id);
    if (o) {
      if (o.item_name !== "不訂") lines.push({ name: m.name, item: o.item_name, price: o.price, carried: false });
    } else if (m.lunch_default) {
      lines.push({ name: m.name, item: m.lunch_default, price: priceOf(m.lunch_default), carried: true });
    }
  }
  return lines;
}

// 下午茶：每份品項一行（同一人點餅＋飲料就是兩行）
export async function teaSummary(roundId: number): Promise<SummaryLine[]> {
  const orders = check(
    await db.from("orders").select("user_id,item_name,price,grp").eq("kind", "tea").eq("order_key", String(roundId))
      .order("grp"),
  ) as { user_id: string; item_name: string; price: number | null }[];
  const members = check(await db.from("members").select("user_id,name")) as Member[];
  const nameOf = new Map(members.map((m) => [m.user_id, m.name]));
  return orders
    .filter((o) => o.item_name !== "不訂")
    .map((o) => ({ name: nameOf.get(o.user_id) ?? "", item: o.item_name, price: o.price, carried: false }));
}

// 還沒點下午茶的同事（不含秘書本人）
export async function teaMissing(roundId: number): Promise<Member[]> {
  const orders = check(
    await db.from("orders").select("user_id").eq("kind", "tea").eq("order_key", String(roundId)),
  ) as { user_id: string }[];
  const done = new Set(orders.map((o) => o.user_id));
  const members = check(await db.from("members").select("*").eq("is_owner", false)) as Member[];
  return members.filter((m) => !done.has(m.user_id));
}
