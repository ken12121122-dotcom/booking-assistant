import crypto from "node:crypto";

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
              "record_checkin",
              "find_customer",
              "unknown"
            ]
          },
          customer_name: { type: ["string", "null"] },
          date_text: { type: ["string", "null"] },
          time_text: { type: ["string", "null"] },
          new_date_text: { type: ["string", "null"] },
          new_time_text: { type: ["string", "null"] },
          details: { type: "string" }
        },
        required: [
          "action",
          "customer_name",
          "date_text",
          "time_text",
          "new_date_text",
          "new_time_text",
          "details"
        ]
      }
    },
    unresolved_gaps: {
      type: "array",
      items: { type: "string" }
    },
    requires_confirmation: { type: "boolean" }
  },
  required: ["summary", "actions", "unresolved_gaps", "requires_confirmation"]
};

async function parseCommandWithGemini(userText, apiKey) {
  const now = new Date().toISOString();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`;

  const prompt = [
    "你是一個排課與簽到系統的自然語言指令解析器。",
    "目前只能分析，不得執行任何排課、調課、取消、簽到或資料修改。",
    "將使用者中文指令拆成一個或多個動作。",
    "允許的 action 只有：search_schedule、create_booking、reschedule_booking、cancel_booking、record_checkin、find_customer、unknown。",
    "若日期、時間或姓名資訊不完整，不要自行補造，填入 unresolved_gaps。",
    "customer_name 請保留使用者原文中的姓名或稱呼。",
    `系統目前 UTC 時間：${now}`,
    "請解析以下使用者指令：",
    userText
  ].join("\n");

  const result = await fetch(endpoint, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
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
  return JSON.parse(text);
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
      if (item.details) parts.push(item.details);
      lines.push(parts.join("｜"));
    });
  }

  if (Array.isArray(plan.unresolved_gaps) && plan.unresolved_gaps.length) {
    lines.push(`⚠️ 待補資料：${plan.unresolved_gaps.join("、")}`);
  }

  lines.push("\n目前為 dry-run，不會修改課表或簽到資料。");
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

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "LINE webhook",
      webhook: "/api/line/webhook",
      channelSecretConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
      accessTokenConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      model: GEMINI_MODEL,
      mode: "dry-run-command-parser"
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).send("Method Not Allowed");
  }

  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const geminiKey = process.env.GEMINI_API_KEY;

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
      if (!accessToken) {
        console.warn("LINE_CHANNEL_ACCESS_TOKEN is not configured; message received but not replied.");
        continue;
      }

      const originalText = event.message.text;
      let replyText;

      if (!geminiKey) {
        replyText = "⚠️ GEMINI_API_KEY 尚未設定。LINE 通道正常，但 AI 解析尚未啟用。";
      } else {
        try {
          const plan = await parseCommandWithGemini(originalText, geminiKey);
          replyText = formatPlanForLine(plan);
        } catch (error) {
          console.error(error);
          replyText = `⚠️ AI 解析失敗。\n${describeGeminiError(error)}\nLINE Webhook 本身正常。`;
        }
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
