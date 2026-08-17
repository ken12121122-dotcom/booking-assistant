import crypto from "node:crypto";
import { isSessionStoreConfigured, loadConversation, saveConversation, clearConversation } from "../../lib/session.js";
import { isRelayConfigured, publishToRelay, pollRelay, getActiveDeviceCount } from "../../lib/relay.js";

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function verifyLineSignature(rawBody, signature, channelSecret) {
  if (!signature || !channelSecret) return false;
  const expected = crypto
    .createHmac("sha256", channelSecret)
    .update(rawBody)
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Same contract as the APK's pollLineGateway(): it sends the LINE channel
// secret as a bearer token, not the x-line-signature HMAC used for webhook
// deliveries, since it's a device polling for its own queued messages.
function gatewayAuthorized(req, channelSecret) {
  const header = String(req.headers.authorization || "");
  if (!channelSecret || !header.startsWith("Bearer ")) return false;
  const supplied = header.slice(7);
  const a = Buffer.from(channelSecret);
  const b = Buffer.from(supplied);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function replyMessage(replyToken, text, accessToken) {
  const result = await fetch(LINE_REPLY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }],
    }),
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
          action: {
            type: "string",
            enum: [
              "search_schedule",
              "create_booking",
              "reschedule_booking",
              "cancel_booking",
              "swap_booking",
              "record_checkin",
              "find_customer",
              "add_student",
              "unknown"
            ]
          },
          customer_name: { type: ["string", "null"] },
          phone: { type: ["string", "null"] },
          date_text: { type: ["string", "null"] },
          time_text: { type: ["string", "null"] },
          start_at: { type: ["string", "null"] },
          new_date_text: { type: ["string", "null"] },
          new_time_text: { type: ["string", "null"] },
          new_start_at: { type: ["string", "null"] },
          counterpart_customer_name: { type: ["string", "null"] },
          counterpart_date_text: { type: ["string", "null"] },
          counterpart_time_text: { type: ["string", "null"] },
          counterpart_start_at: { type: ["string", "null"] },
          details: { type: "string" }
        },
        required: [
          "action",
          "customer_name",
          "phone",
          "date_text",
          "time_text",
          "start_at",
          "new_date_text",
          "new_time_text",
          "new_start_at",
          "counterpart_customer_name",
          "counterpart_date_text",
          "counterpart_time_text",
          "counterpart_start_at",
          "details"
        ]
      }
    },
    unresolved_gaps: {
      type: "array",
      items: { type: "string" }
    },
    requires_confirmation: { type: "boolean" },
    needs_clarification: { type: "boolean" },
    clarifying_question: { type: ["string", "null"] }
  },
  required: [
    "summary",
    "actions",
    "unresolved_gaps",
    "requires_confirmation",
    "needs_clarification",
    "clarifying_question"
  ]
};

const SYSTEM_INSTRUCTION = [
  "你是一個排課與簽到系統的自然語言指令解析器。",
  "你只負責把使用者的中文指令拆解成結構化的 action，不擁有最終寫入權——實際的資料驗證、時段衝突判斷與寫入，一律由手機 App 端的本機 SQLite 執行。",
  "允許的 action 只有：search_schedule、create_booking、reschedule_booking、cancel_booking、swap_booking、record_checkin、find_customer、add_student、unknown。",
  "customer_name 請保留使用者原文中的姓名或稱呼。",
  "",
  "時間解析規則：",
  "- date_text / time_text 保留使用者原文（例如「明天」「下午三點」），不要自己改寫。",
  "- start_at 是你根據現在的台灣時間，把 date_text + time_text 換算成的正式時間，格式必須是 ISO 8601 並帶 +08:00 時區（例如 2026-08-18T15:00:00+08:00）。算不出來就填 null，不要亂猜。",
  "- reschedule_booking 或有新時間時，同樣邏輯套用在 new_date_text/new_time_text → new_start_at。",
  "",
  "swap_booking（真互換兩堂課）規則：",
  "- 一個 swap_booking 動作代表「這位使用者指定的兩堂課互換」。",
  "- customer_name/date_text/time_text/start_at 描述第一堂課，counterpart_customer_name/counterpart_date_text/counterpart_time_text/counterpart_start_at 描述要交換的另一堂課。",
  "",
  "add_student（新增學員）規則：",
  "- customer_name 填學員姓名，若使用者有講電話請填 phone，沒有就 null。",
  "",
  "這是一段多輪對話。如果你在前面已經反問過問題，而使用者這則新訊息是在回答，請結合完整對話歷史補完資訊，不要重複問已經回答過的問題。",
  "若日期、時間、姓名等關鍵資訊仍不足以確定要執行的動作：",
  "- needs_clarification 設為 true",
  "- clarifying_question 用一句簡短口語化的中文，一次只問「一件」最關鍵缺少的資訊，不要一次問一堆",
  "- actions 可以留空或只放已經確定的部分，unresolved_gaps 列出仍缺的項目",
  "若資訊已經足夠執行：",
  "- needs_clarification 設為 false，clarifying_question 為 null",
  "- 正常輸出完整的 actions"
].join("\n");

// Taiwan has no DST, so a fixed +08:00 offset is always correct.
function nowInTaipeiIso() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(new Date());

  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+08:00`;
}

async function parseCommandWithGemini(history, userText, apiKey) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

  const contents = [
    ...history,
    { role: "user", parts: [{ text: `現在台灣時間：${nowInTaipeiIso()}\n使用者訊息：${userText}` }] }
  ];

  const result = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: bookingCommandSchema,
        temperature: 0.1
      }
    })
  });

  if (!result.ok) {
    const detail = await result.text().catch(() => "");
    throw new Error(`Gemini request failed: ${result.status} ${detail}`);
  }

  const responseJson = await result.json();
  const text = responseJson?.candidates?.[0]?.content?.parts?.map((p) => p?.text || "").join("") || "";
  if (!text) throw new Error("Gemini returned no text output");
  return { plan: JSON.parse(text), rawText: text };
}

function formatPlanForLine(plan) {
  const lines = [];
  lines.push("🧠 指令解析（尚未執行）");
  lines.push(plan.summary || "已解析你的指令。");

  if (Array.isArray(plan.actions) && plan.actions.length) {
    plan.actions.forEach((item, index) => {
      const parts = [`${index + 1}. ${item.action}`];
      if (item.customer_name) parts.push(`客戶：${item.customer_name}`);
      if (item.date_text) parts.push(`日期：${item.date_text}`);
      if (item.time_text) parts.push(`時間：${item.time_text}`);
      if (item.new_date_text) parts.push(`新日期：${item.new_date_text}`);
      if (item.new_time_text) parts.push(`新時間：${item.new_time_text}`);
      if (item.counterpart_customer_name) parts.push(`對調對象：${item.counterpart_customer_name}`);
      if (item.details) parts.push(item.details);
      lines.push(parts.join("｜"));
    });
  }

  if (Array.isArray(plan.unresolved_gaps) && plan.unresolved_gaps.length) {
    lines.push(`⚠️ 待補資料：${plan.unresolved_gaps.join("、")}`);
  }

  lines.push("\n目前為 dry-run，實際驗證與寫入由手機 App 執行。");
  return lines.join("\n").slice(0, 4900);
}

function formatClarifyingQuestion(plan) {
  const lines = [];
  lines.push(`🤔 ${plan.clarifying_question || "可以再說明一下嗎？"}`);

  if (Array.isArray(plan.unresolved_gaps) && plan.unresolved_gaps.length) {
    lines.push(`（缺：${plan.unresolved_gaps.join("、")}）`);
  }

  return lines.join("\n").slice(0, 4900);
}

function describeGeminiError(error) {
  const message = String(error?.message || error || "未知錯誤");
  const statusMatch = message.match(/Gemini request failed:\s*(\d{3})/);
  const status = statusMatch?.[1];

  if (status === "400") return `Gemini 回覆 400：${message.slice(0, 500)}`;
  if (status === "401" || status === "403") return "Gemini 回覆權限錯誤：請確認 GEMINI_API_KEY 是否有效且可使用 Gemini API。";
  if (status === "404") return `Gemini 回覆 404：模型 ${GEMINI_MODEL} 可能不可用。`;
  if (status === "429") return "Gemini 回覆 429：已達免費額度或速率限制，稍後再試。";
  return `Gemini 解析錯誤：${message.slice(0, 500)}`;
}

async function pollGatewayHandler(req, res, channelSecret) {
  if (!gatewayAuthorized(req, channelSecret)) {
    return res.status(401).json({ ok: false, error: "gateway_unauthorized" });
  }

  const deviceId = String(req.query.device_id || "").trim();
  if (!deviceId) return res.status(400).json({ ok: false, error: "device_id_required" });

  const { messages, activeDevices } = await pollRelay(deviceId);

  return res.status(200).json({
    ok: true,
    mode: "kv-relay",
    deviceId,
    messages,
    activeDevices,
    serverTime: new Date().toISOString()
  });
}

export default async function handler(req, res) {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (req.method === "GET" && req.query?.mode === "poll") {
    return pollGatewayHandler(req, res, channelSecret);
  }

  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "LINE webhook",
      webhook: "/api/line/webhook",
      channelSecretConfigured: Boolean(channelSecret),
      accessTokenConfigured: Boolean(accessToken),
      geminiConfigured: Boolean(geminiKey),
      model: GEMINI_MODEL,
      sessionStoreConfigured: isSessionStoreConfigured(),
      relayConfigured: isRelayConfigured(),
      activeDevices: await getActiveDeviceCount(),
      mode: "dry-run-command-parser"
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).send("Method Not Allowed");
  }

  if (!channelSecret) return res.status(503).send("LINE_CHANNEL_SECRET is not configured");

  const rawBody = await readRawBody(req);
  const signature = req.headers["x-line-signature"] || "";

  if (!verifyLineSignature(rawBody, signature, channelSecret)) {
    return res.status(401).send("Invalid signature");
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).send("Invalid JSON");
  }

  if (!Array.isArray(payload.events) || payload.events.length === 0) {
    return res.status(200).send("OK");
  }

  for (const event of payload.events) {
    if (
      event?.type === "message" &&
      event?.message?.type === "text" &&
      event?.replyToken
    ) {
      const originalText = event.message.text;
      const userId = event.source?.userId;
      let replyText;
      let planForRelay = null;

      if (!geminiKey) {
        replyText = "⚠️ GEMINI_API_KEY 尚未設定。LINE 通道正常，但 AI 解析尚未啟用。";
      } else {
        let history = [];
        try {
          history = await loadConversation(userId);
        } catch (error) {
          console.error("loadConversation failed", error);
        }

        try {
          const { plan, rawText } = await parseCommandWithGemini(history, originalText, geminiKey);
          planForRelay = plan;

          if (plan.needs_clarification) {
            replyText = formatClarifyingQuestion(plan);
            const nextHistory = [
              ...history,
              { role: "user", parts: [{ text: originalText }] },
              { role: "model", parts: [{ text: rawText }] }
            ];
            try {
              await saveConversation(userId, nextHistory);
            } catch (error) {
              console.error("saveConversation failed", error);
            }
          } else {
            replyText = formatPlanForLine(plan);
            try {
              await clearConversation(userId);
            } catch (error) {
              console.error("clearConversation failed", error);
            }
          }
        } catch (error) {
          console.error(error);
          replyText = `⚠️ AI 解析失敗。\n${describeGeminiError(error)}\nLINE Webhook 本身正常。`;
        }
      }

      try {
        await publishToRelay({
          id: event.webhookEventId || crypto.randomUUID(),
          receivedAt: new Date().toISOString(),
          sourceType: event.source?.type || "unknown",
          sourceUserId: userId || "",
          text: originalText,
          plan: planForRelay
        });
      } catch (error) {
        console.error("publishToRelay failed", error);
      }

      if (!accessToken) {
        console.warn("LINE_CHANNEL_ACCESS_TOKEN is not configured; message received but not replied.");
        continue;
      }

      try {
        await replyMessage(event.replyToken, replyText, accessToken);
      } catch (error) {
        console.error(error);
      }
    }
  }

  return res.status(200).send("OK");
}
