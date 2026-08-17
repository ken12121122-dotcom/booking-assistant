import { isKvConfigured, kvCommand } from "./kv.js";

const SESSION_TTL_SECONDS = 600;
const MAX_TURNS = 12;

export const isSessionStoreConfigured = isKvConfigured;

function sessionKey(userId) {
  return `booking-assistant:session:${userId}`;
}

export async function loadConversation(userId) {
  if (!isKvConfigured() || !userId) return [];

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
  if (!isKvConfigured() || !userId) return;

  const trimmed = turns.slice(-MAX_TURNS);
  await kvCommand("set", sessionKey(userId), JSON.stringify(trimmed), "EX", SESSION_TTL_SECONDS);
}

export async function clearConversation(userId) {
  if (!isKvConfigured() || !userId) return;
  await kvCommand("del", sessionKey(userId));
}
