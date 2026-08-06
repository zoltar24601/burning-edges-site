// ============================================================
// One-time seeder: load a collection report's UNCLAIMED counts into
// card_remaining. This is the LAST manual CSV for a pack -- after this the
// poller keeps `remaining` current from on-chain pulls.
//
// Usage: node tools/seed-remaining.mjs <report.csv> <product>
//   e.g. node tools/seed-remaining.mjs ".../Silhouette Basketball.csv" silhouette
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (read from ~/.burning-edges/supabase.env)
// ============================================================
import fs from "fs"; import os from "os";

const REPORT = process.argv[2];
const PRODUCT = process.argv[3];
if (!REPORT || !PRODUCT) { console.error("usage: node tools/seed-remaining.mjs <report.csv> <product>"); process.exit(1); }

let url, key;
for (const l of fs.readFileSync(os.homedir() + "/.burning-edges/supabase.env", "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.+)$/);
  if (m) { if (m[1] === "SUPABASE_URL") url = m[2].trim(); if (m[1] === "SUPABASE_SERVICE_KEY") key = m[2].trim(); }
}
const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

const rows = fs.readFileSync(REPORT, "utf8").split(/\r?\n/).filter(Boolean).slice(1)
  .map(r => r.split(",").map(x => x.replace(/^"|"$/g, "")))
  // header: YEAR,SPORT,COLLECTION,CARDSET,ATHLETE,PSKU,TEAM,MINT RUN,WITH COLLECTORS,UNCLAIMED,...
  .map(c => ({ sku_base: c[5], product: PRODUCT, athlete: c[4], cardset: c[3], run: +c[7], remaining: +c[9] }))
  .filter(r => r.sku_base);

console.log(`${PRODUCT}: seeding ${rows.length} cards (sum remaining ${rows.reduce((a, r) => a + r.remaining, 0)})`);

// upsert in chunks
for (let i = 0; i < rows.length; i += 500) {
  const chunk = rows.slice(i, i + 500);
  const r = await fetch(`${url}/rest/v1/card_remaining?on_conflict=sku_base`, {
    method: "POST", headers: { ...H, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(chunk.map(x => ({ ...x, seeded_at: new Date().toISOString(), updated_at: new Date().toISOString() }))),
  });
  if (!r.ok) { console.error("chunk", i, "failed:", r.status, (await r.text()).slice(0, 200)); process.exit(1); }
}
console.log("done.");
