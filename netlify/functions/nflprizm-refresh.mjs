// ============================================================
// HOURLY engine for 2021 NFL Prizm. One pass does the whole loop:
//   1. append new on-chain sales (chain_events, prefix packcard-1584) -> pack_sales
//   2. reprice the value map off the running sales log (recency rules)  -> pack_values
//   3. log notable moves -> price_changes (the /changes feed + on-page feed)
//   4. recompute the snapshot from LIVE card_remaining + the repriced values
// Counts track the blockchain automatically; values reevaluate off real sales.
// Falls back to the static value map until pack_values is seeded (deploy-safe).
// Env (Netlify): SUPABASE_URL, SUPABASE_SERVICE_KEY.
// ============================================================
import { recomputeNflPrizm } from "../../tools/nflprizm-recompute.mjs";
import { repriceNfl } from "../../tools/nflprizm-reprice.mjs";
import staticMap from "../../tools/nflprizm-values.json";

export const config = { schedule: "@hourly" };
const PRODUCT = "nflprizm21", PREFIX = "packcard-1584";
// only log a move to the public feed when it's meaningful
const notable = (o, n) => Math.abs(n - o) >= 100 && Math.abs(n - o) / Math.max(o, 1) >= 0.15;

export default async () => {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return resp(500, { error: "missing Supabase env" });
  const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
  const getAll = async (q) => { const out = []; for (let off = 0; ; off += 1000) { const r = await (await fetch(`${SB_URL}/rest/v1/${q}&limit=1000&offset=${off}`, { headers: H })).json(); if (!Array.isArray(r)) break; out.push(...r); if (r.length < 1000) break; } return out; };
  try {
    // 1) value map: pack_values if seeded, else the static file (deploy-safe)
    let vrows = await getAll(`pack_values?product=eq.${PRODUCT}&select=sku_base,value,cardset,athlete,run,slot`);
    const seeded = vrows.length > 0;
    if (!seeded) vrows = Object.entries(staticMap).map(([sku_base, m]) => ({ sku_base, value: m.v, cardset: m.cs, athlete: m.a, run: m.r, slot: m.slot }));
    const meta = Object.fromEntries(vrows.map(v => [v.sku_base, v]));

    // 2) append new on-chain sales -> pack_sales (dedup makes it idempotent)
    const evs = await (await fetch(`${SB_URL}/rest/v1/chain_events?sku_base=like.${PREFIX}*&price=gt.0&select=sku_base,serial,run,price,ts&order=ts.desc&limit=500`, { headers: H })).json();
    const newSales = (Array.isArray(evs) ? evs : []).filter(e => meta[e.sku_base]).map(e => {
      const m = meta[e.sku_base], d = (e.ts || "").slice(0, 10);
      return { product: PRODUCT, sku_base: e.sku_base, athlete: m.athlete, parallel: m.cardset, serial: e.serial, run: e.run, price: e.price, tags: null, sold_at: d, source: "chain", dedup: [PRODUCT, e.sku_base, e.serial, e.price, d].join("|") };
    });
    if (seeded && newSales.length) {
      await fetch(`${SB_URL}/rest/v1/pack_sales?on_conflict=dedup`, { method: "POST", headers: { ...H, Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(newSales) });
    }

    // 3) reprice off the running sales log
    const sales = seeded ? await getAll(`pack_sales?product=eq.${PRODUCT}&select=athlete,parallel,serial,run,price,tags,sold_at`) : [];
    const { newValues, moves } = repriceNfl(vrows, sales);

    // persist changed values + log notable moves
    if (seeded && moves.length) {
      const upd = moves.map(m => ({ product: PRODUCT, sku_base: m.sku_base, value: m.new, cardset: m.cardset, athlete: m.athlete, run: m.run, slot: meta[m.sku_base].slot, src: m.src, updated_at: new Date().toISOString() }));
      await fetch(`${SB_URL}/rest/v1/pack_values?on_conflict=product,sku_base`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(upd) });
      const feed = moves.filter(m => notable(m.old, m.new)).map(m => ({ product: PRODUCT, scope: `${m.athlete} ${m.cardset} /${m.run}`, headline: `${m.athlete} ${m.cardset} repriced off recent sales`, detail: `$${m.old.toLocaleString()} -> $${m.new.toLocaleString()}`, old_value: m.old, new_value: m.new }));
      if (feed.length) await fetch(`${SB_URL}/rest/v1/price_changes`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(feed) });
    }

    // 4) recompute snapshot from LIVE remaining + the (repriced) values
    const remaining = {};
    (await getAll(`card_remaining?product=eq.${PRODUCT}&select=sku_base,remaining`)).forEach(r => remaining[r.sku_base] = r.remaining);
    const valueMap = {};
    for (const v of vrows) valueMap[v.sku_base] = { v: newValues[v.sku_base] ? newValues[v.sku_base].value : Number(v.value), cs: v.cardset, a: v.athlete, r: v.run, slot: v.slot };
    const cur = await (await fetch(`${SB_URL}/rest/v1/nflprizm_snapshots?select=id,payload&published=eq.true&order=computed_at.desc&limit=1`, { headers: H })).json();
    if (!cur.length) return resp(409, { error: "no published nflprizm snapshot" });
    const payload = recomputeNflPrizm(remaining, valueMap, cur[0].payload);
    await fetch(`${SB_URL}/rest/v1/nflprizm_snapshots?id=eq.${cur[0].id}`, { method: "PATCH", headers: H, body: JSON.stringify({ payload, pack_book_ev: payload.pack_ev.pack_book_ev, updated: payload.updated, computed_at: new Date().toISOString() }) });
    return resp(200, { ok: true, seeded, sales_appended: newSales.length, repriced: moves.length, book: payload.pack_ev.pack_book_ev, packs: payload.packs_remaining });
  } catch (e) { return resp(500, { error: String(e) }); }
};

function resp(status, body) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
