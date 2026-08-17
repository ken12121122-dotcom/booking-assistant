import { isKvConfigured, kvCommand } from "./kv.js";

const QUEUE_KEY = "booking-assistant:relay:queue";
const SEQ_KEY = "booking-assistant:relay:seq";
const DEVICES_KEY = "booking-assistant:relay:devices";
const MAX_QUEUE = 200;
const POLL_LIMIT = 50;
const DEVICE_ACTIVE_WINDOW_MS = 10 * 60 * 1000;
const CURSOR_TTL_SECONDS = 60 * 60 * 24 * 30;

export const isRelayConfigured = isKvConfigured;

function cursorKey(deviceId) {
  return `booking-assistant:relay:cursor:${deviceId}`;
}

// Persists every parsed LINE message so any number of polling devices can
// each read the full log at their own pace, surviving cold starts (unlike
// the in-memory globalThis.__bookingAssistantRelay Map it replaces).
export async function publishToRelay(message) {
  if (!isKvConfigured()) return;

  const seq = Number(await kvCommand("incr", SEQ_KEY));
  await kvCommand("zadd", QUEUE_KEY, seq, JSON.stringify({ ...message, seq }));
  await kvCommand("zremrangebyrank", QUEUE_KEY, 0, -(MAX_QUEUE + 1));
}

// Read-only device count for the health-check endpoint — does not register
// a device, only prunes stale ones and reports how many are left.
export async function getActiveDeviceCount() {
  if (!isKvConfigured()) return 0;
  await kvCommand("zremrangebyscore", DEVICES_KEY, "-inf", Date.now() - DEVICE_ACTIVE_WINDOW_MS);
  return Number(await kvCommand("zcard", DEVICES_KEY)) || 0;
}

export async function pollRelay(deviceId) {
  if (!isKvConfigured() || !deviceId) return { messages: [], activeDevices: 0 };

  const now = Date.now();
  await kvCommand("zadd", DEVICES_KEY, now, deviceId);
  await kvCommand("zremrangebyscore", DEVICES_KEY, "-inf", now - DEVICE_ACTIVE_WINDOW_MS);
  const activeDevices = Number(await kvCommand("zcard", DEVICES_KEY)) || 0;

  const rawCursor = await kvCommand("get", cursorKey(deviceId));
  const cursor = rawCursor ? Number(rawCursor) : 0;

  const raw = await kvCommand("zrangebyscore", QUEUE_KEY, `(${cursor}`, "+inf", "LIMIT", "0", String(POLL_LIMIT));
  const messages = (Array.isArray(raw) ? raw : [])
    .map((item) => {
      try {
        return JSON.parse(item);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  if (messages.length) {
    const maxSeq = Math.max(...messages.map((m) => m.seq || 0));
    await kvCommand("set", cursorKey(deviceId), String(maxSeq), "EX", CURSOR_TTL_SECONDS);
  }

  return { messages, activeDevices };
}
