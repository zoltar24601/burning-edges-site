// ============================================================
// Re-seed card_remaining (moonbirds) from Diamond's CURRENT per-card unopened
// counts (accurate baseline; the poller's pull-tracking missed ~600 packs).
// Then reprice + recompute to print the corrected book.
//   node tools/reseed-moonbirds-remaining.mjs
// ============================================================
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { repriceMoon } from "./moonbirds-reprice.mjs";
import { recomputeMoonbirds } from "./moonbirds-recompute.mjs";

const rd = (file) => { const f = `${homedir()}/.burning-edges/${file}`; const o = {}; if (existsSync(f)) for (const l of readFileSync(f, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/); if (m) o[m[1]] = m[2]; } return o; };
const sb = rd("supabase.env"), pb = rd("pbc-api.env");
const URL = process.env.SUPABASE_URL || sb.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY || sb.SUPABASE_SERVICE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const getAll = async q => { const out = []; for (let o = 0; ; o += 1000) { const r = await (await fetch(`${URL}/rest/v1/${q}&limit=1000&offset=${o}`, { headers: H })).json(); if (!Array.isArray(r)) break; out.push(...r); if (r.length < 1000) break; } return out; };

const main = async () => {
  const rem = await getAll("card_remaining?product=eq.moonbirds&select=sku_base,athlete,cardset,run,remaining");
  const api = await (await fetch(pb.PBC_BIRBS_URL, { headers: { "x-api-key": pb.PBC_API_KEY } })).json();
  const byPsku = Object.fromEntries((api.cards || []).map(c => [c.psku, c]));

  let before = 0, after = 0;
  const rows = rem.map(r => {
    const c = byPsku[r.sku_base];
    const u = c ? (c.unopened_pack_count || 0) : 0;
    before += r.remaining || 0; after += u;
    return { product: "moonbirds", sku_base: r.sku_base, athlete: r.athlete, cardset: r.cardset, run: r.run, remaining: u, updated_at: new Date().toISOString() };
  });
  console.log(`card_remaining total: ${before} (stale) -> ${after} (Diamond live)  [~${Math.round(after / 2)} packs]`);

  let ok = 0;
  for (const r of rows) {
    const res = await fetch(`${URL}/rest/v1/card_remaining?product=eq.moonbirds&sku_base=eq.${encodeURIComponent(r.sku_base)}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify({ remaining: r.remaining, updated_at: r.updated_at }) });
    if (res.ok) ok++; else { console.error("PATCH failed:", r.sku_base, res.status, await res.text()); }
  }
  console.log(`re-seeded ${ok}/${rows.length} card_remaining rows`);

  // recompute with corrected counts
  const vrows = await getAll("pack_values?product=eq.moonbirds&select=sku_base,value,cardset,athlete,run,slot");
  const sales = await getAll("pack_sales?product=eq.moonbirds&select=athlete,parallel,serial,run,price,tags,sold_at");
  const { newValues } = repriceMoon(vrows, sales);
  const remaining = {}; rows.forEach(r => remaining[r.sku_base] = r.remaining);
  const valueMap = {}; for (const v of vrows) valueMap[v.sku_base] = { v: newValues[v.sku_base] ? newValues[v.sku_base].value : Number(v.value), cs: v.cardset, a: v.athlete, r: v.run, base: v.slot === "base" };
  const p = recomputeMoonbirds(remaining, valueMap);
  console.log("\n=== CORRECTED RECOMPUTE ===");
  console.log("base_card_ev:", p.pack_ev.base_card_ev, "| hit_card_ev:", p.pack_ev.hit_card_ev);
  console.log("PACK BOOK EV:", p.pack_ev.pack_book_ev, "| predicted:", p.pack_ev.predicted_price, "| vs mint:", p.pack_ev.book_vs_mint + "x");
  console.log("remaining: base", p.pack_ev.base_pool_remaining, "hit", p.pack_ev.hit_pool_remaining, "=", p.pack_ev.base_pool_remaining + p.pack_ev.hit_pool_remaining, "cards");
};
main();
