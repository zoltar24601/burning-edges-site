// ============================================================
// Backfill pack_sales (moonbirds) from OUR chain_events history, then run the
// reprice + recompute locally to verify the book value before going live.
//   node tools/seed-moonbirds-sales.mjs
// ============================================================
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { repriceMoon } from "./moonbirds-reprice.mjs";
import { recomputeMoonbirds } from "./moonbirds-recompute.mjs";

const f = `${homedir()}/.burning-edges/supabase.env`;
const env = {}; if (existsSync(f)) for (const l of readFileSync(f, "utf8").split(/\r?\n/)) { const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/); if (m) env[m[1]] = m[2]; }
const URL = process.env.SUPABASE_URL || env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_KEY || env.SUPABASE_SERVICE_KEY;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const getAll = async q => { const out = []; for (let o = 0; ; o += 1000) { const r = await (await fetch(`${URL}/rest/v1/${q}&limit=1000&offset=${o}`, { headers: H })).json(); if (!Array.isArray(r)) break; out.push(...r); if (r.length < 1000) break; } return out; };

const main = async () => {
  const vrows = await getAll("pack_values?product=eq.moonbirds&select=sku_base,value,cardset,athlete,run,slot");
  const meta = Object.fromEntries(vrows.map(v => [v.sku_base, v]));
  console.log(`pack_values: ${vrows.length}`);

  // pull all moonbirds chain sales -> pack_sales rows
  const evs = await getAll("chain_events?sku_base=like.packcard-850178*&price=gt.0&select=sku_base,serial,run,price,ts&order=ts.desc");
  const sales = evs.filter(e => meta[e.sku_base]).map(e => { const m = meta[e.sku_base], d = (e.ts || "").slice(0, 10); return { product: "moonbirds", sku_base: e.sku_base, athlete: m.athlete, parallel: m.cardset, serial: e.serial, run: e.run, price: e.price, tags: null, sold_at: d, source: "chain", dedup: ["moonbirds", e.sku_base, e.serial, e.price, d].join("|") }; });
  console.log(`chain sales (moonbirds): ${evs.length} -> mapped ${sales.length}`);

  for (let i = 0; i < sales.length; i += 500) {
    const res = await fetch(`${URL}/rest/v1/pack_sales?on_conflict=dedup`, { method: "POST", headers: { ...H, Prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(sales.slice(i, i + 500)) });
    if (!res.ok) { console.error("pack_sales upsert failed:", res.status, await res.text()); process.exit(1); }
  }
  console.log(`upserted ${sales.length} pack_sales`);

  // reprice + recompute (local dry check)
  const allSales = await getAll("pack_sales?product=eq.moonbirds&select=athlete,parallel,serial,run,price,tags,sold_at");
  const { newValues, moves } = repriceMoon(vrows, allSales);
  const remaining = {}; (await getAll("card_remaining?product=eq.moonbirds&select=sku_base,remaining")).forEach(r => remaining[r.sku_base] = r.remaining);
  const valueMap = {}; for (const v of vrows) valueMap[v.sku_base] = { v: newValues[v.sku_base] ? newValues[v.sku_base].value : Number(v.value), cs: v.cardset, a: v.athlete, r: v.run, base: v.slot === "base" };
  const p = recomputeMoonbirds(remaining, valueMap);
  console.log("\n=== RECOMPUTE ===");
  console.log("moves:", moves.length, moves.slice(0, 8).map(m => `${m.athlete} ${m.cardset} $${m.old}->$${m.new}`));
  console.log("base_card_ev (Base Silver):", p.pack_ev.base_card_ev);
  console.log("hit_card_ev (slot2):", p.pack_ev.hit_card_ev);
  console.log("PACK BOOK EV:", p.pack_ev.pack_book_ev, "| predicted:", p.pack_ev.predicted_price);
  console.log("base_pool_remaining:", p.pack_ev.base_pool_remaining, "| hit_pool_remaining:", p.pack_ev.hit_pool_remaining);
  console.log("top chases:", p.cards_remaining.slice(0, 6).map(h => `${h.c} ${h.s} /${h.r} $${h.p} (${h.u} left)`));
};
main();
