// 點餐：聊天卡片按鈕與 LIFF 頁面共用的規則

import * as db from "./db.ts";

export type Choice = { item: number } | "same" | "skip";

export async function submitOrder(
  member: db.Member,
  kind: "lunch" | "tea",
  key: string,
  choice: Choice,
): Promise<{ ok: boolean; message: string; item?: string }> {
  if (kind === "lunch" && key !== db.todayTaipei()) {
    return { ok: false, message: "這張是之前的便當單，請重新開啟今天的選單。" };
  }
  if (kind === "tea") {
    const round = await db.openTeaRound();
    if (!round || String(round.id) !== key) return { ok: false, message: "這次下午茶已經截止了。" };
  }

  let itemName: string;
  let price: number | null = null;
  if (choice === "skip") {
    itemName = "不訂";
  } else if (choice === "same") {
    if (kind !== "lunch" || !member.lunch_default) return { ok: false, message: "沒有上次的紀錄，請直接選品項。" };
    itemName = member.lunch_default;
    price = (await db.lunchItems()).find((i) => i.name === itemName)?.price ?? null;
  } else {
    const item = await db.getMenuItem(choice.item);
    const valid = item && item.kind === kind &&
      (kind === "tea" ? String(item.round_id) === key : (await db.lunchItems()).some((i) => i.id === item.id));
    if (!item || !valid) return { ok: false, message: "找不到這個品項，請重新開啟選單。" };
    itemName = item.name;
    price = item.price;
  }

  await db.placeOrder({ kind, order_key: key, user_id: member.user_id, item_name: itemName, price });
  const label = kind === "lunch" ? "便當" : "下午茶";
  return {
    ok: true,
    item: itemName,
    message: itemName === "不訂"
      ? `好的，這次${label}不幫你訂。`
      : `已登記${label}：${itemName}${price != null ? ` $${price}` : ""}`,
  };
}
