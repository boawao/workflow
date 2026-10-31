# workflow

行政秘書工作流程梳理與 AI 跟進規劃。

- [`docs/admin-workflow.md`](docs/admin-workflow.md)：主文件（GitHub 上可直接看到 Mermaid 流程圖）
  - 工作全景圖、日 / 週 / 月節奏
  - 每項工作的現況流程圖（公文收發、會議記錄、便當、下午茶、快遞、崔sir辦公室、紅白皮書…）
  - 痛點、改善後流程圖、導入路線圖
  - AI 跟進任務總表（觸發 → 動作 → 通知對象）
  - 文件之間不一致、待確認的事項
- `docs/admin-workflow.html`：同內容的網頁版，由 `python3 tools/build_html.py` 產生（需 `pip install markdown`）

修改時請改 `.md`，再重新產生 `.html`。原始資料中的帳號密碼刻意不收錄。

## LINE 官方帳號機器人

- [`docs/line-bot-setup.md`](docs/line-bot-setup.md)：設定步驟與使用說明
- `supabase/functions/line-bot/`：Webhook 與定時提醒（Supabase Edge Function）
- `supabase/migrations/`：資料表與排程
