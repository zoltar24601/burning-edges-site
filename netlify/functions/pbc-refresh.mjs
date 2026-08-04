// ============================================================
// HOURLY pipeline: pull Panini Blockchain Tracker -> recompute Moonbirds with
// John's valuation rules -> update the published snapshot -> log any MAJOR move
// to the public /changes feed. Runs on Netlify's cron, not through anyone.
//
// Env (Netlify): PBC_API_KEY (add this), SUPABASE_URL, SUPABASE_SERVICE_KEY.
// The API URL is public, so it's inline; only the key is a secret.
// ============================================================
import { buildMoonbirds } from "../../tools/pbc-build-moonbirds.mjs";

const BIRBS_URL = "https://pbc-challenge-tracker.vercel.app/api/birbs";

export const config = { schedule: "@hourly" };

export default async () => {
  const KEY = process.env.PBC_API_KEY;
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!KEY || !SB_URL || !SB_KEY) return resp(500, { error: "missing env (PBC_API_KEY / Supabase)" });
  const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

  try {
    // 1) live data
    const apiRes = await fetch(BIRBS_URL, { headers: { "x-api-key": KEY } });
    if (!apiRes.ok) return resp(502, { error: "birbs API " + apiRes.status });
    const api = await apiRes.json();

    // 2) current published payload = structural template + change baseline
    const cur = await fetch(`${SB_URL}/rest/v1/moonbirds_snapshots?select=id,payload&published=eq.true&order=computed_at.desc&limit=1`, { headers: SBH });
    const rows = await cur.json();
    if (!rows.length) return resp(409, { error: "no published Moonbirds snapshot to update" });
    const { id, payload: template } = rows[0];

    // 3) rebuild
    const { payload, changes } = buildMoonbirds(api, template);

    // 4) update the snapshot in place (stays newest via computed_at)
    await fetch(`${SB_URL}/rest/v1/moonbirds_snapshots?id=eq.${id}`, {
      method: "PATCH", headers: SBH,
      body: JSON.stringify({ payload, pack_book_ev: payload.pack_ev.pack_book_ev, updated: payload.updated, computed_at: new Date().toISOString() }),
    });

    // 5) log major moves to the public feed
    if (changes.length) {
      await fetch(`${SB_URL}/rest/v1/price_changes`, {
        method: "POST", headers: SBH,
        body: JSON.stringify(changes.map(c => ({ product: "moonbirds", scope: c.scope, headline: c.headline, detail: c.detail, old_value: c.old_value, new_value: c.new_value }))),
      });
    }

    return resp(200, { ok: true, book: payload.pack_ev.pack_book_ev, changes: changes.length });
  } catch (e) {
    return resp(500, { error: String(e) });
  }
};

function resp(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
