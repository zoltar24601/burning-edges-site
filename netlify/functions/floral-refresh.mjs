// ============================================================
// HOURLY engine for the World Cup Floral Edition. Same loop as the other packs:
//   1. append new on-chain floral SALES -> pack_sales
//   2. reprice the value map off the running sales log (recency)  -> pack_values
//   3. log notable moves -> price_changes (feeds /changes + on-page feed)
//   4. recompute the snapshot from remaining + the (repriced) values
//
// DORMANT UNTIL SECONDARY: the Floral pack crafts 2026-09-02 and has no chain
// SKUs / sales yet. Until then this publishes the modeled seed each run. To
// ACTIVATE once it trades: set EV_FILTER to the real Floral packcard prefix and
// seed pack_values + card_remaining (product=floral). Deploy-safe: falls back to
// the static value map + full runs so it works before any seeding.
// Env (Netlify): SUPABASE_URL, SUPABASE_SERVICE_KEY.
// ============================================================
import { recomputeFloral } from "../../tools/floral-recompute.mjs";
import { repriceFloral } from "../../tools/floral-reprice.mjs";
import staticMap from "../../tools/floral-values.json";

export const config = { schedule: "@hourly" };
const PRODUCT = "floral";
// Floral SKUs span TWO prefixes -- Lotus /4 = packcard-2333, Cherry /9 + Plum /18
// = packcard-2332 (shared with the main set) -- so we can't use a single prefix.
// The chain-sales query is built from the seeded pack_values SKUs (see below).
const notable = (o, n) => Math.abs(n - o) >= 100 && Math.abs(n - o) / Math.max(o, 1) >= 0.15;

export default async () => {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return resp(500, { error: "missing Supabase env" });
  const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
  const getAll = async (q) => { const out = []; for (let off = 0; ; off += 1000) { const r = await (await fetch(`${SB_URL}/rest/v1/${q}&limit=1000&offset=${off}`, { headers: H })).json(); if (!Array.isArray(r)) break; out.push(...r); if (r.length < 1000) break; } return out; };
  try {
    // 1) value map: pack_values if seeded, else the static seed (keyed athlete|parallel)
    let vrows = await getAll(`pack_values?product=eq.${PRODUCT}&select=sku_base,value,cardset,athlete,run,slot`);
    const seeded = vrows.length > 0;
    if (!seeded) vrows = Object.entries(staticMap).map(([sku_base, m]) => ({ sku_base, value: m.v, cardset: m.cs, athlete: m.a, run: m.r, slot: "hit" }));
    const meta = Object.fromEntries(vrows.map(v => [v.sku_base, v]));

    // 2) append new on-chain floral SALES (price>0) -> pack_sales. Query by the
    //    exact seeded SKUs (both prefixes) so we don't pull the whole main set.
    const skuIn = vrows.map(v => v.sku_base).join(",");
    const evs = skuIn ? await (await fetch(`${SB_URL}/rest/v1/chain_events?sku_base=in.(${encodeURIComponent(skuIn)})&price=gt.0&select=sku_base,serial,run,price,ts&order=ts.desc&limit=500`, { headers: H })).json() : [];
    const newSales = (Array.isArray(evs) ? evs : []).filter(e => meta[e.sku_base]).map(e => {
      const m = meta[e.sku_base], d = (e.ts || "").slice(0, 10);
      return { product: PRODUCT, sku_base: e.sku_base, athlete: m.athlete, parallel: m.cardset, serial: e.serial, run: e.run, price: e.price, tags: null, sold_at: d, source: "chain", dedup: [PRODUCT, e.sku_base, e.serial, e.price, d].join("|") };
    });
    if (seeded && newSales.length) {
      await fetch(`${SB_URL}/rest/v1/pack_sales?on_conflict=dedup`, { method: "POST", headers: { ...H, Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(newSales) });
    }

    // 3) reprice off the running sales log
    const sales = seeded ? await getAll(`pack_sales?product=eq.${PRODUCT}&select=athlete,parallel,serial,run,price,tags,sold_at`) : [];
    const { newValues, moves } = repriceFloral(vrows, sales);
    if (seeded && moves.length) {
      const upd = moves.map(m => ({ product: PRODUCT, sku_base: m.sku_base, value: m.new, cardset: m.cardset, athlete: m.athlete, run: m.run, slot: "hit", src: m.src, updated_at: new Date().toISOString() }));
      await fetch(`${SB_URL}/rest/v1/pack_values?on_conflict=product,sku_base`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(upd) });
      const feed = moves.filter(m => notable(m.old, m.new)).map(m => ({ product: PRODUCT, scope: `${m.athlete} ${m.cardset} /${m.run}`, headline: `${m.athlete} ${m.cardset} repriced off recent sales`, detail: `$${m.old.toLocaleString()} -> $${m.new.toLocaleString()}`, old_value: m.old, new_value: m.new }));
      if (feed.length) await fetch(`${SB_URL}/rest/v1/price_changes`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(feed) });
    }

    // 4) recompute from remaining (card_remaining if seeded, else full runs = all available)
    const remaining = {};
    const remRows = await getAll(`card_remaining?product=eq.${PRODUCT}&select=sku_base,remaining`);
    if (remRows.length) remRows.forEach(r => remaining[r.sku_base] = r.remaining);
    else vrows.forEach(v => remaining[v.sku_base] = v.run);   // pre-launch: everything available
    const valueMap = {};
    for (const v of vrows) valueMap[v.sku_base] = { v: newValues[v.sku_base] ? newValues[v.sku_base].value : Number(v.value), cs: v.cardset, a: v.athlete, r: v.run };
    const payload = recomputeFloral(remaining, valueMap);

    const cur = await (await fetch(`${SB_URL}/rest/v1/floral_snapshots?select=id&published=eq.true&order=computed_at.desc&limit=1`, { headers: H })).json();
    if (!Array.isArray(cur) || !cur.length) return resp(409, { error: "no published floral snapshot yet (run migration 009 + publish)" });
    await fetch(`${SB_URL}/rest/v1/floral_snapshots?id=eq.${cur[0].id}`, { method: "PATCH", headers: H, body: JSON.stringify({ payload, pack_book_ev: payload.pack_ev.pack_book_ev, updated: payload.updated, computed_at: new Date().toISOString() }) });
    return resp(200, { ok: true, seeded, sales_appended: newSales.length, repriced: moves.length, book: payload.pack_ev.pack_book_ev });
  } catch (e) { return resp(500, { error: String(e) }); }
};

function resp(status, body) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
