// LINE Messaging API：簽章驗證、回覆、推播、取得使用者名稱

const API = "https://api.line.me/v2/bot";

function token(): string {
  const t = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  if (!t) throw new Error("LINE_CHANNEL_ACCESS_TOKEN is not set");
  return t;
}

export async function verifySignature(rawBody: string, signature: string | null): Promise<boolean> {
  const secret = Deno.env.get("LINE_CHANNEL_SECRET");
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

// deno-lint-ignore no-explicit-any
export type Message = Record<string, any>;

async function call(path: string, body: unknown): Promise<void> {
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) console.error(`LINE ${path} failed: ${res.status} ${await res.text()}`);
}

export function reply(replyToken: string, messages: Message[]): Promise<void> {
  return call("/message/reply", { replyToken, messages: messages.slice(0, 5) });
}

export function push(to: string, messages: Message[]): Promise<void> {
  return call("/message/push", { to, messages: messages.slice(0, 5) });
}

export async function displayName(userId: string): Promise<string> {
  const res = await fetch(`${API}/profile/${userId}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) return "";
  const p = await res.json();
  return p.displayName ?? "";
}

export function text(t: string, quickReply?: string[]): Message {
  const m: Message = { type: "text", text: t };
  if (quickReply?.length) {
    m.quickReply = {
      items: quickReply.map((label) => ({
        type: "action",
        action: { type: "message", label, text: label },
      })),
    };
  }
  return m;
}
