// LIFF 點餐頁面的 API
//
// GET  /line-bot/api/menu   今天的便當選項、本週下午茶選項、我目前的選擇
// POST /line-bot/api/order  { kind, choice: { item } | "same" | "skip" }
//
// 驗證：LIFF 的 ID token 放在 Authorization: Bearer，向 LINE 驗證後取得 userId

import * as db from "./db.ts";
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
  const clientId = Deno.env.get("LIFF_CHANNEL_ID");
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
    const [lunchItems, lunchMine, teaItems, teaMine] = await Promise.all([
      db.lunchItems(),
      db.myOrder("lunch", date, member.user_id),
      round ? db.teaItems(round.id) : Promise.resolve([]),
      round ? db.myOrder("tea", String(round.id), member.user_id) : Promise.resolve(null),
    ]);
    return json({
      name: member.name,
      lunch: {
        key: date,
        items: lunchItems.map(({ id, name, price }) => ({ id, name, price })),
        current: lunchMine?.item_name ?? null,
        last: member.lunch_default,
      },
      tea: round
        ? {
          key: String(round.id),
          store: round.store,
          items: teaItems.map(({ id, name, price }) => ({ id, name, price })),
          current: teaMine?.item_name ?? null,
        }
        : null,
    });
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
