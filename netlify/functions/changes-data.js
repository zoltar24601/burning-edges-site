// Burning Edges - public price-change feed. Route: /api/changes
// Serves the most recent price_changes rows for the /changes page.
// Env (functions only): SUPABASE_URL, SUPABASE_SERVICE_KEY.
export async function handler(event) {
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return json(500, { error: "Server not configured." });
  try {
    const url = `${SB_URL}/rest/v1/price_changes?select=product,scope,headline,detail,old_value,new_value,created_at&order=created_at.desc&limit=200`;
    const res = await fetch(url, { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } });
    if (!res.ok) return json(502, { error: "Supabase read failed", status: res.status });
    return json(200, { changes: await res.json() });
  } catch (e) {
    return json(500, { error: String(e) });
  }
}
function json(status, body) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=120" },
    body: JSON.stringify(body),
  };
}
