// Burning Edges - live pack data for the hourly-repriced packs (tools/live-pack.mjs).
// Route: /api/pack-live?product=<prizmwc22|mosaic22|stickers26>. Serves that
// product's payload from stickers_snapshots (the table holds every live pack).
// If the table/row is missing the function returns non-200 and the page keeps
// its baked numbers.
// Env (functions only): SUPABASE_URL, SUPABASE_SERVICE_KEY.
export async function handler(event) {
  const product = (event.queryStringParameters || {}).product;
  if (!["prizmwc22", "mosaic22", "stickers26"].includes(product)) return json(400, { error: "unknown product" });
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) {
    return json(500, { error: "Server not configured (missing Supabase env vars)." });
  }
  try {
    const url = `${SB_URL}/rest/v1/stickers_snapshots?select=payload,computed_at&product=eq.${product}&published=eq.true&order=computed_at.desc&limit=1`;
    const res = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    if (!res.ok) return json(502, { error: "Supabase read failed", status: res.status });
    const rows = await res.json();
    if (!rows.length) return json(404, { error: `No published ${product} snapshot.` });
    return json(200, rows[0].payload);
  } catch (e) {
    return json(500, { error: String(e) });
  }
}
function json(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=60",
    },
    body: JSON.stringify(body),
  };
}
