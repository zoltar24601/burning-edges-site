// ============================================================
// HOURLY: rebuild the Silhouette snapshot from LIVE card_remaining (kept current
// by the chain poller) + the frozen value map. Ends the manual CSV for Silhouette
// -- "remaining" now tracks the blockchain automatically. Prices unchanged.
// Env (Netlify): SUPABASE_URL, SUPABASE_SERVICE_KEY.
// ============================================================
import { recomputeSilhouette } from "../../tools/silhouette-recompute.mjs";
import valueMap from "../../tools/silhouette-values.json";

export const config = { schedule: "@hourly" };

export default async () => {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return resp(500, { error: "missing Supabase env" });
  const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
  try {
    // 1) live remaining counts (paged)
    const remaining = {};
    for (let off = 0; ; off += 1000) {
      const rows = await (await fetch(`${SB_URL}/rest/v1/card_remaining?select=sku_base,remaining&product=eq.silhouette&limit=1000&offset=${off}`, { headers: H })).json();
      rows.forEach(r => remaining[r.sku_base] = r.remaining);
      if (rows.length < 1000) break;
    }
    // 2) current published payload = structural template
    const cur = await (await fetch(`${SB_URL}/rest/v1/silhouette_snapshots?select=id,payload&published=eq.true&order=computed_at.desc&limit=1`, { headers: H })).json();
    if (!cur.length) return resp(409, { error: "no published silhouette snapshot" });
    // 3) recompute + publish in place
    const payload = recomputeSilhouette(remaining, valueMap, cur[0].payload);
    await fetch(`${SB_URL}/rest/v1/silhouette_snapshots?id=eq.${cur[0].id}`, {
      method: "PATCH", headers: H,
      body: JSON.stringify({ payload, pack_book_ev: payload.pack_ev.pack_book_ev, updated: payload.updated, computed_at: new Date().toISOString() }),
    });
    return resp(200, { ok: true, book: payload.pack_ev.pack_book_ev, hit_pool: payload.pack_ev.hit_pool_remaining });
  } catch (e) { return resp(500, { error: String(e) }); }
};

function resp(status, body) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
