const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

export function isKvConfigured() {
  return Boolean(KV_URL && KV_TOKEN);
}

export async function kvCommand(...args) {
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
