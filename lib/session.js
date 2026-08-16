const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const SESSION_TTL_SECONDS = 600;
const MAX_TURNS = 12;

export function isSessionStoreConfigured() {
  return Boolean(KV_URL && KV_TOKEN);
}

async function kvCommand(...args) {
  const path = args.map((part) => encodeURIComponent(String(part))).join("/");
  const result = await fetch(`${KV_URL}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });

  if (!result.ok) {
    const detail = await result.text().catch(() => "");
    throw new Error(`KV request failed: ${result.status} ${detail}`);
  }

  const data = await result.json();
  return data.result;
}

function sessionKey(userId) {
  return `booking-assistant:session:${userId}`;
}

export async function loadConversation(userId) {
  if (!isSessionStoreConfigured() || !userId) return [];

  const raw = await kvCommand("get", sessionKey(userId));
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function saveConversation(userId, turns) {
  if (!isSessionStoreConfigured() || !userId) return;

  const trimmed = turns.slice(-MAX_TURNS);
  await kvCommand("set", sessionKey(userId), JSON.stringify(trimmed), "EX", SESSION_TTL_SECONDS);
}

export async function clearConversation(userId) {
  if (!isSessionStoreConfigured() || !userId) return;
  await kvCommand("del", sessionKey(userId));
}
