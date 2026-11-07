// 完成待辦並通知提出的同事（聊天卡片按鈕、「完成 12」指令、管理後台共用）

import * as db from "./db.ts";
import * as line from "./line.ts";

export async function finishAndNotify(id: number, byUserId: string): Promise<db.Todo | null> {
  const todo = await db.completeTodo(id);
  if (todo?.requester_id && todo.requester_id !== byUserId) {
    const notice = todo.title.startsWith("消耗品領用")
      ? `你領用的消耗品已經準備好了，請到行政處拿取：\n${todo.detail}`
      : `行政已處理完成：「${todo.title}」`;
    await line.push(todo.requester_id, [line.text(notice)]);
  }
  return todo;
}
