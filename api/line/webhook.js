import crypto from "node:crypto";

const LINE_REPLY_URL = "https://api.line.me/v2/bot/message/reply";

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

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "LINE webhook",
      webhook: "/api/line/webhook",
      channelSecretConfigured: Boolean(process.env.LINE_CHANNEL_SECRET),
      accessTokenConfigured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN),
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).send("Method Not Allowed");
  }

  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
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

      try {
        await replyMessage(event.replyToken, `收到：${event.message.text}`, accessToken);
      } catch (error) {
        console.error(error);
      }
    }
  }

  return res.status(200).send("OK");
}
