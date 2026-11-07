// LIFF 點餐頁面的 API
//
// GET  /line-bot/api/menu   今天的便當選項、本週下午茶選項、我目前的選擇
// POST /line-bot/api/order  { kind, choice: { item } | "same" | "skip" }
//
// 驗證：LIFF 的 ID token 放在 Authorization: Bearer，向 LINE 驗證後取得 userId

import * as db from "./db.ts";
import { todoCard } from "./flex.ts";
import * as line from "./line.ts";
import { finishAndNotify } from "./done.ts";
import { type Choice, submitOrder } from "./order.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: CORS });
}

async function verifyIdToken(req: Request): Promise<{ userId: string; name: string } | null> {
  const idToken = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const clientId = Deno.env.get("LIFF_CHANNEL_ID") ?? "2012305512"; // LINE Login channel（LIFF 所在）
  if (!idToken || !clientId) return null;
  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
  });
  if (!res.ok) return null;
  const p = await res.json();
  return p.sub ? { userId: p.sub, name: p.name ?? "" } : null;
}

export async function handleApi(req: Request, path: string): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const who = await verifyIdToken(req);
  if (!who) return json({ error: "請從 LINE 開啟這個頁面。" }, 401);
  const member = await db.upsertMember(who.userId, who.name);

  if (path === "menu" && req.method === "GET") {
    const date = db.todayTaipei();
    const round = await db.openTeaRound();
    const [supply, lunchClosed, lunchItems, lunchMine, teaItems, teaMine] = await Promise.all([
      db.supplyItems(),
      db.lunchClosed(date),
      db.lunchItems(),
      db.myOrder("lunch", date, member.user_id),
      round ? db.teaItems(round.id) : Promise.resolve([]),
      round ? db.myTeaOrders(round.id, member.user_id) : Promise.resolve({}),
    ]);
    return json({
      name: member.name,
      supply,
      lunch: {
        key: date,
        items: lunchItems.map(({ id, name, price }) => ({ id, name, price })),
        current: lunchMine?.item_name ?? null,
        last: member.lunch_default,
        closed: lunchClosed,
      },
      tea: round
        ? {
          key: String(round.id),
          store: round.store,
          items: teaItems.map(({ id, name, price, grp }) => ({ id, name, price, grp })),
          current: teaMine,
        }
        : null,
    });
  }

  // 管理後台：只有行政主帳號能看
  if (path === "admin" && req.method === "GET") {
    if (!member.is_owner) return json({ error: "只有行政主帳號可以查看管理後台。" }, 403);
    const date = db.todayTaipei();
    const round = await db.latestTeaRound();
    const [supply, lunchClosed, todos, lunch, tea, teaMissing] = await Promise.all([
      db.recentSupplyRequests(),
      db.lunchClosed(date),
      db.openTodos(),
      db.lunchSummary(date),
      round ? db.teaSummary(round.id) : Promise.resolve([]),
      round ? db.teaMissing(round.id) : Promise.resolve([]),
    ]);
    return json({
      todos: todos.map(({ id, title, detail, priority, due, requester_name, awaiting_due, created_at }) => ({
        id, title, detail, priority, due, requester_name, awaiting_due, created_at,
      })),
      lunch: { date, closed: lunchClosed, lines: lunch },
      supply,
      tea: round
        ? { store: round.store, is_open: round.is_open, lines: tea, missing: teaMissing.map((m) => m.name) }
        : null,
    });
  }

  // 消耗品領用：建立行政待辦並推播給行政
  if (path === "supply" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    const catalog = new Map((await db.supplyItems()).map((it) => [it.id, it]));
    const picked = (Array.isArray(body?.items) ? body.items : [])
      .filter((x: { id: number; qty: number }) => catalog.has(x?.id) && Number.isInteger(x?.qty) && x.qty > 0 && x.qty <= 20)
      .map((x: { id: number; qty: number }) => ({ ...catalog.get(x.id)!, qty: x.qty }));
    if (!picked.length) return json({ ok: false, message: "請至少選一項消耗品。" }, 400);
    const note = String(body?.note ?? "").trim().slice(0, 200);
    const list = picked.map((p: { name: string; unit: string; qty: number }) => `${p.name}×${p.qty}${p.unit}`).join("、");
    const todo = await db.createTodo({
      title: `消耗品領用：${member.name}`,
      detail: list + (note ? `\n備註：${note}` : ""),
      priority: "other",
      due: null,
      requester: member,
      source_text: list,
    });
    await db.addSupplyRequest({
      user_id: member.user_id,
      items: picked.map(({ name, unit, qty }: { name: string; unit: string; qty: number }) => ({ name, unit, qty })),
      note,
      todo_id: todo.id,
    });
    // 一律推播給行政（就算是行政自己送的），卡片上有「完成」按鈕
    const owner = await db.getOwner();
    if (owner) await line.push(owner.user_id, [todoCard(todo, `${member.name} 的消耗品領用`)]);
    return json({ ok: true, message: `已送出：${list}\n行政準備好後會通知你。` });
  }

  // 管理後台按「完成」：只有行政主帳號可以
  if (path === "done" && req.method === "POST") {
    if (!member.is_owner) return json({ ok: false, message: "只有行政主帳號可以完成待辦。" }, 403);
    const body = await req.json().catch(() => null);
    const id = Number(body?.id);
    if (!Number.isInteger(id)) return json({ ok: false, message: "待辦編號錯誤。" }, 400);
    const todo = await finishAndNotify(id, member.user_id);
    return todo
      ? json({ ok: true, message: `已完成 #${id}「${todo.title}」` })
      : json({ ok: false, message: `#${id} 不存在或已經完成。` }, 409);
  }

  if (path === "order" && req.method === "POST") {
    const body = await req.json().catch(() => null);
    const kind = body?.kind;
    if (kind !== "lunch" && kind !== "tea") return json({ error: "kind 錯誤" }, 400);
    const raw = body.choice;
    const choice: Choice | null = raw === "same" || raw === "skip"
      ? raw
      : Number.isInteger(raw?.item) ? { item: raw.item } : null;
    if (!choice) return json({ error: "choice 錯誤" }, 400);
    const key = kind === "lunch" ? db.todayTaipei() : String((await db.openTeaRound())?.id ?? "");
    const result = await submitOrder(member, kind, key, choice);
    return json(result, result.ok ? 200 : 409);
  }

  return json({ error: "not found" }, 404);
}
