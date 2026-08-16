import crypto from "node:crypto";

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
const RELAY_TTL_MS = 10 * 60 * 1000;
const RELAY_MAX_QUEUE = 50;

const relay = globalThis.__bookingAssistantRelay || {
  devices: new Map()
};
globalThis.__bookingAssistantRelay = relay;

function cleanupRelay() {
  const now = Date.now();
  for (const [id, device] of relay.devices.entries()) {
    if (now - device.lastSeen > RELAY_TTL_MS) relay.devices.delete(id);
  }
}

function gatewayAuthorized(req, channelSecret) {
  const header = String(req.headers.authorization || "");
  if (!channelSecret || !header.startsWith("Bearer ")) return false;
  const supplied = header.slice(7);
  const a = Buffer.from(channelSecret);
  const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function pollGateway(req, res, channelSecret) {
  if (!gatewayAuthorized(req, channelSecret)) {
    return res.status(401).json({ ok: false, error: "gateway_unauthorized" });
  }
  const deviceId = String(req.query.device_id || "").trim();
  if (!deviceId) return res.status(400).json({ ok: false, error: "device_id_required" });

  cleanupRelay();
  const current = relay.devices.get(deviceId) || { lastSeen: Date.now(), queue: [] };
  const messages = current.queue.splice(0, RELAY_MAX_QUEUE);
  current.lastSeen = Date.now();
  relay.devices.set(deviceId, current);

  return res.status(200).json({
    ok: true,
    mode: "experimental-memory-relay",
    deviceId,
    messages,
    activeDevices: relay.devices.size,
    serverTime: new Date().toISOString()
  });
}

function enqueueForActiveDevices(message) {
  cleanupRelay();
  for (const device of relay.devices.values()) {
    device.queue.push(message);
    if (device.queue.length > RELAY_MAX_QUEUE) {
      device.queue.splice(0, device.queue.length - RELAY_MAX_QUEUE);
    }
  }
}

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const expected = crypto.createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function replyMessage(replyToken, text, accessToken) {
  const result = await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text }] })
  });
  if (!result.ok) {
    const detail = await result.text().catch(() => "");
    throw new Error(`LINE reply failed: ${result.status} ${detail}`);
  }
}

const bookingCommandSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          action: { type: "string", enum: ["search_schedule", "create_booking", "reschedule_booking", "cancel_booking", "record_checkin", "find_customer", "unknown"] },
          customer_name: { type: ["string", "null"] },
          date_text: { type: ["string", "null"] },
          time_text: { type: ["string", "null"] },
          new_date_text: { type: ["string", "null"] },
          new_time_text: { type: ["string", "null"] },
          details: { type: "string" }
        },
        required: ["action", "customer_name", "date_text", "time_text", "new_date_text", "new_time_text", "details"]
      }
    },
    unresolved_gaps: { type: "array", items: { type: "string" } },
    requires_confirmation: { type: "boolean" }
  },
  required: ["summary", "actions", "unresolved_gaps", "requires_confirmation"]
};

async function parseCommandWithGemini(userText, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;
  const prompt = [
    "你是排課與簽到系統的自然語言指令解析器。",
    "目前只能分析，不得直接修改資料。",
    "允許 action：search_schedule、create_booking、reschedule_booking、cancel_booking、record_checkin、find_customer、unknown。",
    "缺少姓名、日期或時間時放到 unresolved_gaps，不得自行補造。",
    `現在時間：${new Date().toISOString()}`,
    `使用者指令：${userText}`
  ].join("\n");

  const result = await fetch(endpoint, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: bookingCommandSchema, temperature: 0.1 }
    })
  });
  if (!result.ok) {
    const detail = await result.text().catch(() => "");
    throw new Error(`Gemini request failed: ${result.status} ${detail}`);
  }
  const responseJson = await result.json();
  const text = responseJson?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") || "";
  if (!text) throw new Error("Gemini returned no text output");
  return JSON.parse(text);
}

function formatPlanForLine(plan) {
  const lines = ["🧠 指令解析（尚未執行）", plan.summary || "已解析你的指令。"];
  for (const [index, item] of (plan.actions || []).entries()) {
    const parts = [`${index + 1}. ${item.action}`];
    if (item.customer_name) parts.push(`客戶：${item.customer_name}`);
    if (item.date_text) parts.push(`日期：${item.date_text}`);
    if (item.time_text) parts.push(`時間：${item.time_text}`);
    if (item.new_date_text) parts.push(`新日期：${item.new_date_text}`);
    if (item.new_time_text) parts.push(`新時間：${item.new_time_text}`);
    if (item.details) parts.push(item.details);
    lines.push(parts.join("｜"));
  }
  if (plan.unresolved_gaps?.length) lines.push(`⚠️ 待補資料：${plan.unresolved_gaps.join("、")}`);
  lines.push("\n目前為 dry-run，不會修改課表或簽到資料。");
  return lines.join("\n").slice(0, 4900);
}

function describeGeminiError(error) {
  const message = String(error?.message || error || "未知錯誤");
  const status = message.match(/Gemini request failed:\s*(\d{3})/)?.[1];
  if (status === "400") return `Gemini 回覆 400：${message.slice(0, 500)}`;
  if (status === "401" || status === "403") return "Gemini 回覆權限錯誤。";
  if (status === "404") return `Gemini 回覆 404：模型 ${GEMINI_MODEL} 可能不可用。`;
  if (status === "429") return "Gemini 回覆 429：已達額度或速率限制。";
  return `Gemini 解析錯誤：${message.slice(0, 500)}`;
}

export default async function handler(req, res) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (req.method === "GET" && req.query.mode === "poll") {
    return pollGateway(req, res, channelSecret);
  }

  if (req.method === "GET") {
    cleanupRelay();
    return res.status(200).json({
      ok: true,
      service: "LINE webhook",
      webhook: "/api/line/webhook",
      channelSecretConfigured: Boolean(channelSecret),
      accessTokenConfigured: Boolean(accessToken),
      geminiConfigured: Boolean(geminiKey),
      model: GEMINI_MODEL,
      mode: "v0.4-experimental-phone-relay",
      activeDevices: relay.devices.size
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).send("Method Not Allowed");
  }
  if (!channelSecret) return res.status(503).send("LINE_CHANNEL_SECRET is not configured");

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-line-signature"] || "";
  if (!verifyLineSignature(rawBody, signature, channelSecret)) return res.status(401).send("Invalid signature");

  let payload;
  try { payload = JSON.parse(rawBody.toString("utf8")); }
  catch { return res.status(400).send("Invalid JSON"); }

  if (!Array.isArray(payload.events) || payload.events.length === 0) return res.status(200).send("OK");

  for (const event of payload.events) {
    if (event?.type !== "message" || event?.message?.type !== "text" || !event?.replyToken) continue;

    const originalText = event.message.text;
    let plan = null;
    let replyText = "LINE 訊息已收到。";

    if (!geminiKey) {
      replyText = "⚠️ GEMINI_API_KEY 尚未設定。LINE 通道正常。";
    } else {
      try {
        plan = await parseCommandWithGemini(originalText, geminiKey);
        replyText = formatPlanForLine(plan);
      } catch (error) {
        console.error(error);
        replyText = `⚠️ AI 解析失敗。\n${describeGeminiError(error)}\nLINE Webhook 本身正常。`;
      }
    }

    enqueueForActiveDevices({
      id: event.webhookEventId || crypto.randomUUID(),
      receivedAt: new Date().toISOString(),
      sourceType: event.source?.type || "unknown",
      sourceUserId: event.source?.userId || "",
      text: originalText,
      plan
    });

    if (accessToken) {
      try { await replyMessage(event.replyToken, replyText, accessToken); }
      catch (error) { console.error(error); }
    }
  }

  return res.status(200).send("OK");
}
