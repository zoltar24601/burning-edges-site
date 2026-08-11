// Burning Edges - unified card-value lookup feed for /value. Route: /api/card-values
// Serves every card we price in pack_values (NFL Prizm + Silhouette), so the
// "Value My Card" search covers them alongside the baked soccer set. Values are
// the live, auto-repriced ones (updated hourly off blockchain sales).
// Env (functions only): SUPABASE_URL, SUPABASE_SERVICE_KEY.
export async function handler() {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return json(500, { error: "Server not configured." });
  const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` };
  const label = { nflprizm21: "NFL Prizm", silhouette: "Silhouette" };
  try {
    const cards = [];
    for (let off = 0; ; off += 1000) {
      const q = `${SB_URL}/rest/v1/pack_values?product=in.(nflprizm21,silhouette)&select=product,athlete,cardset,run,value&order=value.desc&limit=1000&offset=${off}`;
      const rows = await (await fetch(q, { headers: H })).json();
      if (!Array.isArray(rows) || !rows.length) break;
      for (const r of rows) if (r.athlete && r.value != null) cards.push({ a: r.athlete, s: r.cardset, r: r.run, v: Number(r.value), t: "S", m: "model", pack: label[r.product] || r.product });
      if (rows.length < 1000) break;
    }
    return json(200, { cards });
  } catch (e) { return json(500, { error: String(e) }); }
}
function json(status, body) {
  return { statusCode: status, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" }, body: JSON.stringify(body) };
}
