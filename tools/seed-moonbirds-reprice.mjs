// ============================================================
// ONE-TIME seed of Moonbirds into the chain-based auto-reprice engine.
// Builds the per-card value map from Diamond's live API (final pull) joined to
// OUR card_remaining (authoritative sku_base / athlete / cardset / run), then:
//   - writes tools/moonbirds-values.json  (static fallback for the hourly fn)
//   - upserts pack_values (product=moonbirds)  (the live value map)
// After this, the hourly moonbirds-refresh runs purely off our chain_events.
//
//   node tools/seed-moonbirds-reprice.mjs
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (or ~/.burning-edges/supabase.env)
//      PBC_BIRBS_URL, PBC_API_KEY        (or ~/.burning-edges/pbc-api.env)
// ============================================================
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { ordinaryValue } from "./pbc-value.mjs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dir = dirname(fileURLToPath(import.meta.url));
const SILVER = "Base Silver";
// scarcity fallback (mirrors pbc-value.mjs defaultByRun, which isn't exported)
const _d = run => run <= 1 ? 300 : run <= 10 ? 60 : run <= 25 ? 30 : run <= 49 ? 12 : run <= 99 ? 6 : 2;

function envFrom(file, keys) {
  const out = {};
  const f = join(homedir(), ".burning-edges", file);
  if (existsSync(f)) for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/); if (m) out[m[1]] = m[2];
  }
  for (const k of keys) out[k] = process.env[k] || out[k];
  return out;
}
const sb = envFrom("supabase.env", ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"]);
const pb = envFrom("pbc-api.env", ["PBC_BIRBS_URL", "PBC_API_KEY"]);
if (!sb.SUPABASE_URL || !sb.SUPABASE_SERVICE_KEY) { console.error("missing supabase env"); process.exit(1); }
if (!pb.PBC_BIRBS_URL || !pb.PBC_API_KEY) { console.error("missing pbc-api env"); process.exit(1); }
const H = { apikey: sb.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${sb.SUPABASE_SERVICE_KEY}`, "Content-Type": "application/json" };

async function getAll(q) { const out = []; for (let off = 0; ; off += 1000) { const r = await (await fetch(`${sb.SUPABASE_URL}/rest/v1/${q}&limit=1000&offset=${off}`, { headers: H })).json(); if (!Array.isArray(r)) break; out.push(...r); if (r.length < 1000) break; } return out; }

const main = async () => {
  // authoritative card list (our keying) + Diamond values
  const rem = await getAll("card_remaining?product=eq.moonbirds&select=sku_base,athlete,cardset,run");
  const api = await (await fetch(pb.PBC_BIRBS_URL, { headers: { "x-api-key": pb.PBC_API_KEY } })).json();
  const byPsku = Object.fromEntries((api.cards || []).map(c => [c.psku, c]));
  console.log(`card_remaining rows: ${rem.length} | Diamond cards: ${(api.cards || []).length}`);

  const rows = [], staticMap = {}; let matched = 0;
  for (const r of rem) {
    const c = byPsku[r.sku_base];
    if (c) matched++;
    const value = c ? Math.round(ordinaryValue(c)) : _d(r.run || 49);
    const slot = r.cardset === SILVER ? "base" : "hit";      // Base Silver = slot1; rest = slot2
    rows.push({ product: "moonbirds", sku_base: r.sku_base, value, cardset: r.cardset, athlete: r.athlete, run: r.run, slot, src: "seed", updated_at: new Date().toISOString() });
    staticMap[r.sku_base] = { v: value, cs: r.cardset, a: r.athlete, r: r.run, base: slot === "base" };
  }
  console.log(`matched to Diamond: ${matched}/${rem.length}`);

  writeFileSync(join(__dir, "moonbirds-values.json"), JSON.stringify(staticMap, null, 0));
  console.log(`wrote tools/moonbirds-values.json (${rows.length} cards)`);

  // upsert into pack_values in chunks
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const res = await fetch(`${sb.SUPABASE_URL}/rest/v1/pack_values?on_conflict=product,sku_base`, { method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(chunk) });
    if (!res.ok) { console.error("upsert failed:", res.status, await res.text()); process.exit(1); }
  }
  const silver = rows.filter(r => r.slot === "base");
  console.log(`upserted ${rows.length} pack_values (moonbirds). Base Silver cards: ${silver.length}`);
  console.log(`sample values:`, rows.slice(0, 3).map(r => `${r.athlete} ${r.cardset} /${r.run} = $${r.value}`));
};
main();
