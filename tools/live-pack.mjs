// ============================================================
// Shared hourly engine for the live pack pages (stickers, 2022 Prizm WC,
// 2022 Mosaic RTWC). One run, per product:
//   1. load its state row from stickers_snapshots (product column; the table
//      holds every live pack despite its name) -- first run seeds from repo files
//   2. append new chain SALES since last_ts - 30 min (chain_events, ts-bounded)
//   3. append new chain PULLS since last_pull_id (chain_pulls; first run: since
//      the collection report's time) -> copies pulled out of packs per sku
//   4. compute the page payload, save payload + state (one row, updated in place)
// state (stored in the `sales` jsonb column) = { log, pulled, pullSpec, last_pull_id }
// ============================================================
const OVERLAP_MS = 30 * 60 * 1000;
const MAX_BACK_MS = 7 * 24 * 3600 * 1000;

export async function runLivePack({ product, prefix, seedLog, pullsFrom, mapSale, saleKey, prune, compute }) {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return { status: 500, body: { error: "missing Supabase env" } };
  const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
  const hi = prefix.replace(/(\d+)$/, d => String(Number(d) + 1));   // packcard-850180 -> packcard-850181
  const range = `sku_base=gte.${prefix}_&sku_base=lt.${hi}`;
  const page = async q => {
    const out = [];
    for (let off = 0; ; off += 1000) {
      const r = await (await fetch(`${SB_URL}/rest/v1/${q}&limit=1000&offset=${off}`, { headers: H })).json();
      if (!Array.isArray(r)) throw new Error(`read failed: ${JSON.stringify(r).slice(0, 200)}`);
      out.push(...r);
      if (r.length < 1000) return out;
    }
  };

  // 1) state
  const rows = await (await fetch(`${SB_URL}/rest/v1/stickers_snapshots?product=eq.${product}&select=id,sales,last_ts&order=computed_at.desc&limit=1`, { headers: H })).json();
  if (!Array.isArray(rows)) return { status: 502, body: { error: "stickers_snapshots unreadable", detail: rows } };
  const row = rows[0];
  const st = !row ? { log: seedLog(), pulled: {}, pullSpec: {}, last_pull_id: null }
    : Array.isArray(row.sales) ? { log: row.sales, pulled: {}, pullSpec: {}, last_pull_id: null }   // pre-pull-tracking row
    : row.sales;
  const lastTs = row && row.last_ts ? Date.parse(row.last_ts) : Date.parse(st.log.map(x => x.date).sort().at(-1) + "Z");

  // 2) sales
  const since = new Date(Math.max(lastTs - OVERLAP_MS, Date.now() - MAX_BACK_MS)).toISOString();
  const evs = await page(`chain_events?${range}&price=gt.0&ts=gte.${since}&select=sku_base,serial,run,price,ts&order=ts.asc`);
  const seen = new Set(st.log.map(saleKey));
  let added = 0, newest = lastTs;
  for (const e of evs) {
    newest = Math.max(newest, Date.parse(e.ts));
    const x = mapSale(e);
    if (!x || seen.has(saleKey(x))) continue;
    seen.add(saleKey(x)); st.log.push(x); added++;
  }

  // 3) pulls (incremental by chain_pulls.id, so no overlap/dedup needed)
  const pq = st.last_pull_id != null ? `id=gt.${st.last_pull_id}` : `ts=gte.${pullsFrom}`;
  const pulls = await page(`chain_pulls?${range}&${pq}&select=id,sku_base,serial,run&order=id.asc`);
  for (const p of pulls) {
    st.pulled[p.sku_base] = (st.pulled[p.sku_base] || 0) + 1;
    if (p.run > 1 && (p.serial === 1 || p.serial === p.run)) (st.pullSpec[p.sku_base] ||= []).push(p.serial === 1 ? "number 1" : "perfect mint");
    st.last_pull_id = Math.max(st.last_pull_id || 0, p.id);
  }

  // 4) compute + save
  const pricedAt = new Date().toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
  const payload = compute(st, pricedAt);
  st.log = prune ? prune(st.log) : st.log;
  const body = { product, updated: pricedAt, pack_book_ev: payload.book, payload, sales: st, last_ts: new Date(newest).toISOString(), published: true, computed_at: new Date().toISOString() };
  const w = row
    ? await fetch(`${SB_URL}/rest/v1/stickers_snapshots?id=eq.${row.id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(body) })
    : await fetch(`${SB_URL}/rest/v1/stickers_snapshots`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!w.ok) return { status: 502, body: { error: "save failed", status: w.status, detail: await w.text() } };
  const pulledTotal = Object.values(st.pulled).reduce((s, n) => s + n, 0);
  return { status: 200, body: { ok: true, product, seeded: !row, sales_added: added, sales_kept: st.log.length, pulls_new: pulls.length, pulled_total: pulledTotal, book: payload.book } };
}

export const respond = r => new Response(JSON.stringify(r.body), { status: r.status, headers: { "Content-Type": "application/json" } });
