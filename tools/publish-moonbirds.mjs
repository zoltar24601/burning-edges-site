// Recompute the Moonbirds payload from live DB (pack_values + pack_sales +
// card_remaining), write it to a file for baking into the page, and INSERT it as
// a new moonbirds_snapshots row (published=false; flip after the page deploys).
//   node tools/publish-moonbirds.mjs
import { readFileSync, existsSync, writeFileSync } from "node:fs";
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
  const sales = await getAll("pack_sales?product=eq.moonbirds&select=athlete,parallel,serial,run,price,tags,sold_at");
  const { newValues } = repriceMoon(vrows, sales);
  const remaining = {}; (await getAll("card_remaining?product=eq.moonbirds&select=sku_base,remaining")).forEach(r => remaining[r.sku_base] = r.remaining);
  const valueMap = {}; for (const v of vrows) valueMap[v.sku_base] = { v: newValues[v.sku_base] ? newValues[v.sku_base].value : Number(v.value), cs: v.cardset, a: v.athlete, r: v.run, base: v.slot === "base" };
  const payload = recomputeMoonbirds(remaining, valueMap);

  writeFileSync("tools/_moonbirds_payload.json", JSON.stringify(payload, null, 2));
  console.log("book:", payload.pack_ev.pack_book_ev, "| predicted:", payload.pack_ev.predicted_price, "| cards:", payload.pack_ev.base_pool_remaining + payload.pack_ev.hit_pool_remaining);

  const row = { payload, pack_book_ev: payload.pack_ev.pack_book_ev, updated: payload.updated, computed_at: new Date().toISOString(), published: false };
  const res = await fetch(`${URL}/rest/v1/moonbirds_snapshots`, { method: "POST", headers: { ...H, Prefer: "return=representation" }, body: JSON.stringify(row) });
  if (!res.ok) { console.error("insert failed:", res.status, await res.text()); process.exit(1); }
  const [ins] = await res.json();
  console.log("inserted moonbirds_snapshots id:", ins.id, "(published=false -> flip after page deploys)");
};
main();
