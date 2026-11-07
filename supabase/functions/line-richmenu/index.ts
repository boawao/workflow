// 建立「便當選項／下午茶選項／消耗品領用」圖文選單並設為所有人的預設選單
// 由資料庫用 pg_net 呼叫一次（驗證 x-cron-secret）；重跑會先刪掉舊的同名選單

import { createClient } from "npm:@supabase/supabase-js@2";

const LIFF_ID = Deno.env.get("LIFF_ID") ?? "2012305512-yLtyBZVn";
const IMAGE_URL = "https://raw.githubusercontent.com/boawao/workflow/claude/wonderful-hypatia-fvh08b/liff/richmenu.png";
const NAME = "點餐";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

Deno.serve(async (req) => {
  const { data: secret } = await db.rpc("line_bot_cron_secret");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("forbidden", { status: 403 });

  const auth = { Authorization: `Bearer ${Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")}` };
  const steps: Record<string, unknown> = {};

  // 刪掉之前建立的同名選單
  const list = await (await fetch("https://api.line.me/v2/bot/richmenu/list", { headers: auth })).json();
  for (const m of list.richmenus ?? []) {
    if (m.name === NAME) await fetch(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: "DELETE", headers: auth });
  }

  const create = await fetch("https://api.line.me/v2/bot/richmenu", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      size: { width: 2500, height: 843 },
      selected: true,
      name: NAME,
      chatBarText: "點餐",
      areas: [
        { bounds: { x: 0, y: 0, width: 833, height: 843 }, action: { type: "uri", label: "便當選項", uri: `https://liff.line.me/${LIFF_ID}?tab=lunch` } },
        { bounds: { x: 833, y: 0, width: 834, height: 843 }, action: { type: "uri", label: "下午茶選項", uri: `https://liff.line.me/${LIFF_ID}?tab=tea` } },
        { bounds: { x: 1667, y: 0, width: 833, height: 843 }, action: { type: "uri", label: "消耗品領用", uri: `https://liff.line.me/${LIFF_ID}?tab=supply` } },
      ],
    }),
  });
  const created = await create.json();
  steps.create = { status: create.status, body: created };
  if (!create.ok) return Response.json(steps, { status: 502 });
  const id = created.richMenuId;

  const img = await fetch(IMAGE_URL);
  steps.image = { status: img.status };
  if (!img.ok) return Response.json(steps, { status: 502 });

  const upload = await fetch(`https://api-data.line.me/v2/bot/richmenu/${id}/content`, {
    method: "POST",
    headers: { ...auth, "Content-Type": "image/png" },
    body: await img.arrayBuffer(),
  });
  steps.upload = { status: upload.status, body: await upload.text() };
  if (!upload.ok) return Response.json(steps, { status: 502 });

  const setDefault = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${id}`, { method: "POST", headers: auth });
  steps.default = { status: setDefault.status, body: await setDefault.text() };

  return Response.json({ ok: setDefault.ok, richMenuId: id, steps }, { status: setDefault.ok ? 200 : 502 });
});
