// LINE 官方帳號 webhook + 待辦提醒排程
//
// POST /line-bot           LINE webhook（驗證 X-Line-Signature）
// POST /line-bot/reminder  pg_cron 每 2 小時呼叫（驗證 x-cron-secret）
// /line-bot/api/*          LIFF 點餐頁面（驗證 LIFF ID token，見 api.ts）

import { analyzeMessage } from "./ai.ts";
import { handleApi } from "./api.ts";
import * as db from "./db.ts";
import { liffButton, orderCard, PRIORITY, summaryText, todoCard, todoList } from "./flex.ts";
import * as line from "./line.ts";
import { submitOrder } from "./order.ts";

const LIFF_ID = Deno.env.get("LIFF_ID") ?? "2012305512-yLtyBZVn";

const OWNER_MENU = ["待辦", "便當統計", "下午茶統計", "說明"];
const MEMBER_MENU = ["便當選項", "下午茶選項", "說明"];

const OWNER_HELP = `【行政專用指令】
待辦：看所有未完成待辦（依 緊急／重要／其他）
新增 內容：建立待辦，AI 自動判斷優先順序
　例：新增 緊急 下午三點前寄掛號給國土署
完成 12：把 #12 標成完成
便當統計／下午茶統計：看點餐彙總
設定便當 雞腿飯 90／排骨飯 85／素食 80
設定下午茶 店名｜珍奶 60／紅茶拿鐵 55
截止下午茶：關閉本週下午茶並給彙總
催下午茶：提醒還沒點的同事

同事傳來的訊息若是要你處理的事，會自動整理成待辦並通知你。
週一到週五 9、11、13、15、17 點會推播未完成待辦。`;

const MEMBER_HELP = `【可以這樣用】
便當選項：選今天的便當，沒改就照上次
下午茶選項：選本週下午茶
有事要找行政：直接打字說明，例如
「明天上午幫我叫快遞寄報告書到建築師事務所」
系統會整理後轉給行政，處理完會通知你。`;

// deno-lint-ignore no-explicit-any
type LineEvent = Record<string, any>;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const api = url.pathname.match(/\/api\/(\w+)$/);
  if (api) return handleApi(req, api[1]);
  if (req.method !== "POST") return new Response("ok");

  if (url.pathname.endsWith("/reminder")) {
    const { data: secret } = await db.db.rpc("line_bot_cron_secret");
    if (!secret || req.headers.get("x-cron-secret") !== secret) {
      return new Response("forbidden", { status: 403 });
    }
    const result = await sendReminder();
    return Response.json(result);
  }

  const raw = await req.text();
  if (!(await line.verifySignature(raw, req.headers.get("x-line-signature")))) {
    return new Response("bad signature", { status: 401 });
  }
  const events: LineEvent[] = JSON.parse(raw).events ?? [];
  // 先回 200 給 LINE，再在背景處理（AI 呼叫需要幾秒）
  const work = Promise.all(events.map((e) => handleEvent(e).catch((err) => console.error("event failed", err))));
  // deno-lint-ignore no-explicit-any
  const runtime = (globalThis as any).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
  else await work;
  return new Response("ok");
});

// ---------- 定時提醒 ----------

async function sendReminder() {
  const owner = await db.getOwner();
  if (!owner) return { sent: false, reason: "no owner bound" };
  const todos = await db.openTodos();
  if (!todos.length) return { sent: false, reason: "no open todos" };
  const urgent = todos.filter((t) => t.priority === "urgent").length;
  const hour = new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour: "numeric", hour12: false })
    .format(new Date());
  await line.push(owner.user_id, [
    line.text(`${hour} 待辦提醒：還有 ${todos.length} 件未完成${urgent ? `，其中緊急 ${urgent} 件` : ""}。`),
    todoList(todos, "待辦提醒"),
  ]);
  return { sent: true, count: todos.length };
}

// ---------- 事件處理 ----------

async function handleEvent(e: LineEvent) {
  const userId: string | undefined = e.source?.userId;
  if (!userId || e.source?.type !== "user") return; // 只處理一對一聊天
  const member = await db.upsertMember(userId, await line.displayName(userId));
  const owner = await db.getOwner();
  const isOwner = owner?.user_id === userId;

  if (e.type === "follow") {
    await line.reply(e.replyToken, [line.text(`${member.name} 你好！\n${MEMBER_HELP}`, MEMBER_MENU)]);
    return;
  }
  if (e.type === "postback") {
    await handlePostback(e, member, isOwner);
    return;
  }
  if (e.type === "message" && e.message?.type === "text") {
    await handleText(e.replyToken, (e.message.text as string).trim(), member, isOwner, owner);
  }
}

async function handleText(
  replyToken: string,
  text: string,
  member: db.Member,
  isOwner: boolean,
  owner: db.Member | null,
) {
  const menu = isOwner ? OWNER_MENU : MEMBER_MENU;

  // 綁定行政主帳號
  const bind = text.match(/^綁定\s+(\S+)$/);
  if (bind) {
    const code = Deno.env.get("OWNER_BIND_CODE");
    if (code && bind[1] === code) {
      await db.setOwner(member.user_id);
      await line.reply(replyToken, [line.text(`已綁定 ${member.name} 為行政主帳號。\n\n${OWNER_HELP}`, OWNER_MENU)]);
    } else {
      await line.reply(replyToken, [line.text("綁定碼不正確。")]);
    }
    return;
  }

  if (text === "說明" || text === "選單") {
    await line.reply(replyToken, [line.text(isOwner ? OWNER_HELP : MEMBER_HELP, menu)]);
    return;
  }
  if (text === "便當選項" || text === "訂便當") return replyLunchCard(replyToken, member);
  if (text === "下午茶選項" || text === "點下午茶") return replyTeaCard(replyToken, member);

  if (isOwner) {
    if (await handleOwnerCommand(replyToken, text, member)) return;
  }

  // 其他文字：交給 AI 判斷是不是要行政處理的事
  const forced = isOwner ? text.match(/^(?:新增|\+)\s*(緊急|重要|其他)?\s*(.+)$/s) : null;
  const content = forced ? forced[2] : text;
  const analysis = await analyzeMessage(content, member.name, db.todayTaipei());

  if (!analysis) {
    await line.reply(replyToken, [line.text("系統暫時無法判讀這則訊息，請稍後再試，或直接聯絡行政。", menu)]);
    return;
  }
  if (!analysis.is_task && !forced) {
    await line.reply(replyToken, [line.text(isOwner ? "這則看起來不是待辦。要建立待辦請用「新增 內容」。" : MEMBER_HELP, menu)]);
    return;
  }

  const priorityByWord = { 緊急: "urgent", 重要: "important", 其他: "other" } as const;
  const todo = await db.createTodo({
    title: analysis.title || content.slice(0, 30),
    detail: analysis.detail,
    priority: forced?.[1] ? priorityByWord[forced[1] as keyof typeof priorityByWord] : analysis.priority,
    due: analysis.due,
    requester: member,
    source_text: text,
  });

  if (isOwner) {
    await line.reply(replyToken, [todoCard(todo, "已建立待辦")]);
    return;
  }
  await line.reply(replyToken, [
    line.text(`已整理並轉給行政：\n「${todo.title}」\n優先順序：${PRIORITY[todo.priority].label}\n處理完會通知你。`, menu),
  ]);
  if (owner) await line.push(owner.user_id, [todoCard(todo, `${member.name} 的新需求`)]);
}

async function handleOwnerCommand(replyToken: string, text: string, member: db.Member): Promise<boolean> {
  if (text === "待辦") {
    const todos = await db.openTodos();
    await line.reply(replyToken, todos.length
      ? [todoList(todos, "待辦清單")]
      : [line.text("目前沒有未完成的待辦 🎉", OWNER_MENU)]);
    return true;
  }

  const done = text.match(/^完成\s*#?(\d+)$/);
  if (done) {
    await finishTodo(replyToken, Number(done[1]), member);
    return true;
  }

  if (text === "便當統計") {
    const date = db.todayTaipei();
    await line.reply(replyToken, [line.text(summaryText(`${date} 便當`, await db.lunchSummary(date)), OWNER_MENU)]);
    return true;
  }

  if (text === "下午茶統計" || text === "截止下午茶") {
    const round = await db.latestTeaRound();
    if (!round) {
      await line.reply(replyToken, [line.text("還沒有設定下午茶。請用「設定下午茶 店名｜品項 價格／品項 價格」。")]);
      return true;
    }
    if (text === "截止下午茶") await db.closeTeaRound();
    const missing = await db.teaMissing(round.id);
    const summary = summaryText(`下午茶：${round.store}${text === "截止下午茶" ? "（已截止）" : ""}`, await db.teaSummary(round.id));
    const missingText = missing.length ? `\n\n還沒點：${missing.map((m) => m.name).join("、")}` : "";
    await line.reply(replyToken, [line.text(summary + missingText, OWNER_MENU)]);
    return true;
  }

  if (text === "催下午茶") {
    const round = await db.openTeaRound();
    if (!round) {
      await line.reply(replyToken, [line.text("目前沒有開放中的下午茶。")]);
      return true;
    }
    const missing = await db.teaMissing(round.id);
    for (const m of missing) {
      await line.push(m.user_id, [line.text(`提醒：本週下午茶（${round.store}）你還沒點喔！`, ["下午茶選項"])]);
    }
    await line.reply(replyToken, [line.text(missing.length ? `已提醒 ${missing.length} 位：${missing.map((m) => m.name).join("、")}` : "大家都點了！")]);
    return true;
  }

  const setLunch = text.match(/^設定便當\s+(.+)$/s);
  if (setLunch) {
    const items = parseItems(setLunch[1]);
    await db.replaceLunchItems(items);
    await line.reply(replyToken, [line.text(`便當選項已更新：\n${items.map((i) => `・${i.name}${i.price != null ? ` $${i.price}` : ""}`).join("\n")}`, OWNER_MENU)]);
    return true;
  }

  const setTea = text.match(/^設定下午茶\s+(.+?)\s*[｜|]\s*(.+)$/s);
  if (setTea) {
    const items = parseItems(setTea[2]);
    const round = await db.startTeaRound(setTea[1], items);
    await line.reply(replyToken, [
      line.text(`下午茶已開放：${round.store}\n${items.map((i) => `・${i.name}${i.price != null ? ` $${i.price}` : ""}`).join("\n")}\n\n同事按「下午茶選項」就能選。可用「催下午茶」提醒還沒點的人。`, OWNER_MENU),
    ]);
    return true;
  }

  return false;
}

// 「雞腿飯 90／排骨飯 85、素食」→ [{name, price}]
function parseItems(s: string): { name: string; price: number | null }[] {
  return s.split(/[／/、,，\n]+/).map((x) => x.trim()).filter(Boolean).map((x) => {
    const m = x.match(/^(.*?)\s*\$?(\d+)\s*元?$/);
    return m && m[1] ? { name: m[1].trim(), price: Number(m[2]) } : { name: x, price: null };
  });
}

async function finishTodo(replyToken: string, id: number, member: db.Member) {
  const todo = await db.completeTodo(id);
  if (!todo) {
    await line.reply(replyToken, [line.text(`#${id} 不存在或已經完成。`, OWNER_MENU)]);
    return;
  }
  const remaining = (await db.openTodos()).length;
  await line.reply(replyToken, [line.text(`✅ 已完成 #${id}「${todo.title}」\n剩下 ${remaining} 件待辦。`, OWNER_MENU)]);
  if (todo.requester_id && todo.requester_id !== member.user_id) {
    await line.push(todo.requester_id, [line.text(`行政已處理完成：「${todo.title}」`)]);
  }
}

// ---------- 訂餐卡片 ----------

async function replyLunchCard(replyToken: string, member: db.Member) {
  const liffId = LIFF_ID;
  if (liffId) {
    await line.reply(replyToken, [liffButton(liffId, "lunch", "便當選項", "選今天的便當，沒改就照上次。")]);
    return;
  }
  const items = await db.lunchItems();
  if (!items.length) {
    await line.reply(replyToken, [line.text("行政還沒設定便當選項。")]);
    return;
  }
  const date = db.todayTaipei();
  const mine = await db.myOrder("lunch", date, member.user_id);
  await line.reply(replyToken, [orderCard({
    kind: "lunch",
    title: `${date} 便當`,
    subtitle: "請在 10:15 前選好。沒有選的話，會照你上次點的品項訂。",
    items,
    orderKey: date,
    current: mine?.item_name ?? null,
    lastLunch: mine ? null : member.lunch_default,
  })]);
}

async function replyTeaCard(replyToken: string, member: db.Member) {
  const liffId = LIFF_ID;
  if (liffId) {
    await line.reply(replyToken, [liffButton(liffId, "tea", "下午茶選項", "選本週的下午茶。")]);
    return;
  }
  const round = await db.openTeaRound();
  if (!round) {
    await line.reply(replyToken, [line.text("本週下午茶還沒開放，或已經截止了。")]);
    return;
  }
  const mine = await db.myOrder("tea", String(round.id), member.user_id);
  await line.reply(replyToken, [orderCard({
    kind: "tea",
    title: `下午茶：${round.store}`,
    subtitle: "選好後可以再按一次改選。",
    items: await db.teaItems(round.id),
    orderKey: String(round.id),
    current: mine?.item_name ?? null,
  })]);
}

// ---------- 按鈕（postback） ----------

async function handlePostback(e: LineEvent, member: db.Member, isOwner: boolean) {
  const p = new URLSearchParams(e.postback.data);
  const a = p.get("a");
  const menu = isOwner ? OWNER_MENU : MEMBER_MENU;

  if (a === "done" || a === "prio") {
    if (!isOwner) return line.reply(e.replyToken, [line.text("只有行政可以操作待辦。")]);
    const id = Number(p.get("id"));
    if (a === "done") return finishTodo(e.replyToken, id, member);
    const prio = p.get("p") as db.Priority;
    const todo = await db.setPriority(id, prio);
    return line.reply(e.replyToken, todo ? [todoCard(todo, "已更新優先順序")] : [line.text(`找不到 #${id}`)]);
  }

  if (a === "order" || a === "same" || a === "skip") {
    const kind = (a === "same" ? "lunch" : p.get("k")) as "lunch" | "tea";
    const choice = a === "order" ? { item: Number(p.get("item")) } : a;
    const result = await submitOrder(member, kind, p.get("key")!, choice);
    return line.reply(e.replyToken, [line.text(result.message, menu)]);
  }
}
