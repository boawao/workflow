// LINE Flex Message 卡片

import type { MenuItem, Priority, SummaryLine, Todo } from "./db.ts";
import type { Message } from "./line.ts";

export const PRIORITY: Record<Priority, { label: string; color: string }> = {
  urgent: { label: "緊急", color: "#D93025" },
  important: { label: "重要", color: "#E8710A" },
  other: { label: "其他", color: "#5F6B7A" },
};
const ORDER: Priority[] = ["urgent", "important", "other"];

function postback(label: string, data: Record<string, string | number>, displayText?: string) {
  return {
    type: "postback",
    label,
    data: new URLSearchParams(Object.entries(data).map(([k, v]) => [k, String(v)])).toString(),
    ...(displayText ? { displayText } : {}),
  };
}

function pill(p: Priority) {
  return {
    type: "box",
    layout: "vertical",
    backgroundColor: PRIORITY[p].color,
    cornerRadius: "4px",
    paddingAll: "4px",
    flex: 0,
    contents: [{ type: "text", text: PRIORITY[p].label, size: "xs", color: "#FFFFFF", weight: "bold" }],
  };
}

// 新待辦卡片：給秘書，含完成與改優先順序按鈕
export function todoCard(t: Todo, heading: string): Message {
  const body: Message[] = [
    {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [pill(t.priority), { type: "text", text: heading, size: "xs", color: "#8A94A3", gravity: "center" }],
    },
    { type: "text", text: t.title, weight: "bold", size: "md", wrap: true },
  ];
  if (t.detail) body.push({ type: "text", text: t.detail, size: "sm", color: "#3C4652", wrap: true });
  const meta = [`#${t.id}`, t.requester_name && `來自 ${t.requester_name}`, t.due && `期限 ${t.due}`]
    .filter(Boolean).join("　");
  body.push({ type: "text", text: meta, size: "xs", color: "#8A94A3", wrap: true });

  return {
    type: "flex",
    altText: `[${PRIORITY[t.priority].label}] ${t.title}`,
    contents: {
      type: "bubble",
      body: { type: "box", layout: "vertical", spacing: "md", contents: body },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "button", style: "primary", height: "sm", color: "#1F7A6D", action: postback("完成", { a: "done", id: t.id }, `完成 #${t.id}`) },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: ORDER.filter((p) => p !== t.priority).map((p) => ({
              type: "button",
              style: "secondary",
              height: "sm",
              action: postback(`改成${PRIORITY[p].label}`, { a: "prio", id: t.id, p }),
            })),
          },
        ],
      },
    },
  };
}

// 待辦清單：依 緊急 / 重要 / 其他 各一張卡
export function todoList(todos: Todo[], heading: string): Message {
  const bubbles = ORDER.map((p) => {
    const items = todos.filter((t) => t.priority === p);
    if (!items.length) return null;
    const shown = items.slice(0, 12);
    return {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "horizontal",
        backgroundColor: PRIORITY[p].color,
        paddingAll: "12px",
        contents: [
          { type: "text", text: PRIORITY[p].label, color: "#FFFFFF", weight: "bold", size: "lg" },
          { type: "text", text: `${items.length} 件`, color: "#FFFFFF", align: "end", gravity: "center", size: "sm" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          ...shown.map((t) => ({
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "box",
                layout: "vertical",
                flex: 5,
                contents: [
                  { type: "text", text: t.title, size: "sm", wrap: true, weight: "bold" },
                  {
                    type: "text",
                    size: "xxs",
                    color: "#8A94A3",
                    wrap: true,
                    text: [`#${t.id}`, t.requester_name, t.due].filter(Boolean).join("・"),
                  },
                ],
              },
              {
                type: "button",
                flex: 2,
                height: "sm",
                style: "link",
                color: "#1F7A6D",
                gravity: "center",
                action: postback("完成", { a: "done", id: t.id }, `完成 #${t.id}`),
              },
            ],
          })),
          ...(items.length > shown.length
            ? [{ type: "text", text: `還有 ${items.length - shown.length} 件未顯示`, size: "xs", color: "#8A94A3" }]
            : []),
        ],
      },
    };
  }).filter(Boolean);

  return {
    type: "flex",
    altText: `${heading}：${todos.length} 件待辦`,
    contents: { type: "carousel", contents: bubbles },
  };
}

// 點餐卡片：每個品項一個按鈕
export function orderCard(opts: {
  kind: "lunch" | "tea";
  title: string;
  subtitle: string;
  items: MenuItem[];
  orderKey: string;
  current: string | null;
  lastLunch?: string | null;
}): Message {
  const buttons: Message[] = opts.items.slice(0, 10).map((it) => ({
    type: "button",
    style: opts.current === it.name ? "primary" : "secondary",
    color: opts.current === it.name ? "#1F7A6D" : undefined,
    height: "sm",
    action: postback(
      `${it.name}${it.price != null ? ` $${it.price}` : ""}`.slice(0, 20),
      { a: "order", k: opts.kind, item: it.id, key: opts.orderKey },
      `我要 ${it.name}`,
    ),
  }));
  if (opts.kind === "lunch" && opts.lastLunch) {
    buttons.unshift({
      type: "button",
      style: "primary",
      color: "#3A5A8C",
      height: "sm",
      action: postback(`照舊：${opts.lastLunch}`.slice(0, 20), { a: "same", key: opts.orderKey }, `照舊 ${opts.lastLunch}`),
    });
  }
  buttons.push({
    type: "button",
    style: "link",
    height: "sm",
    action: postback(opts.kind === "lunch" ? "今天不訂" : "這次不點", { a: "skip", k: opts.kind, key: opts.orderKey }),
  });

  return {
    type: "flex",
    altText: opts.title,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          { type: "text", text: opts.title, weight: "bold", size: "lg" },
          { type: "text", text: opts.subtitle, size: "xs", color: "#8A94A3", wrap: true },
          ...(opts.current
            ? [{ type: "text", text: `目前選擇：${opts.current}`, size: "sm", color: "#1F7A6D", wrap: true }]
            : []),
        ],
      },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: buttons },
    },
  };
}

// 開啟 LIFF 點餐頁的卡片
export function liffButton(liffId: string, tab: "lunch" | "tea", title: string, subtitle: string): Message {
  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        backgroundColor: "#0F2A44",
        contents: [
          { type: "text", text: title, weight: "bold", size: "lg", color: "#FFFFFF" },
          { type: "text", text: subtitle, size: "xs", color: "#9FD8D1", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#0F2A44",
        contents: [{
          type: "button",
          style: "primary",
          color: "#1FA393",
          height: "sm",
          action: { type: "uri", label: "開啟選單", uri: `https://liff.line.me/${liffId}?tab=${tab}` },
        }],
      },
    },
  };
}

// 管理後台連結（只給行政主帳號）
export function adminButton(liffId: string): Message {
  return {
    type: "flex",
    altText: "管理後台",
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        backgroundColor: "#0F2A44",
        contents: [
          { type: "text", text: "管理後台", weight: "bold", size: "lg", color: "#FFFFFF" },
          { type: "text", text: "待辦事項、今日便當、本週下午茶", size: "xs", color: "#9FD8D1", wrap: true },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#0F2A44",
        contents: [{
          type: "button",
          style: "primary",
          color: "#1FA393",
          height: "sm",
          action: { type: "uri", label: "開啟管理後台", uri: `https://liff.line.me/${liffId}/admin.html` },
        }],
      },
    },
  };
}

// 訂餐統計文字
export function summaryText(title: string, lines: SummaryLine[]): string {
  if (!lines.length) return `${title}\n目前沒有人點。`;
  const counts = new Map<string, number>();
  let total = 0;
  for (const l of lines) {
    counts.set(l.item, (counts.get(l.item) ?? 0) + 1);
    total += l.price ?? 0;
  }
  const byItem = [...counts].map(([k, v]) => `・${k} × ${v}`).join("\n");
  const byPerson = lines.map((l) => `${l.name || "（未命名）"}：${l.item}${l.carried ? "（照舊）" : ""}`).join("\n");
  return `${title}\n共 ${lines.length} 份${total ? `，合計 $${total}` : ""}\n\n${byItem}\n\n${byPerson}`;
}
