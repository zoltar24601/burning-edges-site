// ============================================================
// One-time seed for the auto-reprice engine (after migration 008).
//   pack_values <- tools/nflprizm-values.json      (current per-card value map)
//   pack_sales  <- tools/nflprizm-sales-seed.json  (620 historical dated sales)
// After this the hourly engine appends new chain_events sales + reprices on its own.
// Usage: node tools/seed-pack-reprice.mjs
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (from ~/.burning-edges/supabase.env)
// ============================================================
import { readFileSync } from "node:fs";
import os from "node:os";

const PRODUCT = "nflprizm21";
const env = readFileSync(os.homedir() + "/.burning-edges/supabase.env", "utf8");
const U = env.match(/SUPABASE_URL=(.*)/)[1].trim();
const K = env.match(/SUPABASE_(?:SERVICE_ROLE_KEY|SERVICE_KEY)=(.*)/)[1].trim();
const H = { apikey: K, Authorization: `Bearer ${K}`, "Content-Type": "application/json" };

async function chunkPost(path, rows, prefer) {
  for (let i = 0; i < rows.length; i += 500) {
    const r = await fetch(`${U}/rest/v1/${path}`, { method: "POST", headers: { ...H, Prefer: prefer }, body: JSON.stringify(rows.slice(i, i + 500)) });
    if (!r.ok) { console.error("chunk", i, "failed:", r.status, (await r.text()).slice(0, 200)); process.exit(1); }
  }
}

// pack_values
const vm = JSON.parse(readFileSync("tools/nflprizm-values.json"));
const vrows = Object.entries(vm).map(([sku_base, m]) => ({ product: PRODUCT, sku_base, value: m.v, cardset: m.cs, athlete: m.a, run: m.r, slot: m.slot, src: "seed", updated_at: new Date().toISOString() }));
console.log(`pack_values: seeding ${vrows.length}`);
await chunkPost("pack_values?on_conflict=product,sku_base", vrows, "resolution=merge-duplicates,return=minimal");

// pack_sales
const seed = JSON.parse(readFileSync("tools/nflprizm-sales-seed.json"));
const srows = seed.map(s => ({ product: PRODUCT, sku_base: null, athlete: s.a, parallel: s.p, serial: s.ser, run: s.run, price: s.price, tags: s.tags || null, sold_at: s.d, source: "seed", dedup: [PRODUCT, s.a, s.p, s.ser, s.price, s.d].join("|") }));
console.log(`pack_sales: seeding ${srows.length}`);
await chunkPost("pack_sales?on_conflict=dedup", srows, "resolution=ignore-duplicates,return=minimal");

console.log("done.");
