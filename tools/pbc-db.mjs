// ============================================================
// pbc-db.mjs — direct Supabase writes for the PBC pricing workflow,
// using the service-role key (bypasses the flaky MCP OAuth).
// ------------------------------------------------------------
// The key is read from env or a LOCAL gitignored file and is NEVER printed.
//   Preferred: env vars SUPABASE_URL + SUPABASE_SERVICE_KEY
//   Fallback : ~/.burning-edges/supabase.env  (KEY=VALUE lines)
//
// Commands (only these — deliberately scoped to pbc_snapshots):
//   node pbc-db.mjs verify
//       list snapshots (id, published, books, updated) — read test
//   node pbc-db.mjs insert <calc.json> <valuer.json>
//       POST a new snapshot (lands published=false); prints the new id
//   node pbc-db.mjs publish <id>
//       set that id published=true and ALL others false (exactly one live)
// ============================================================
import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";

function loadEnv() {
  let url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_KEY;
  const f = `${homedir()}/.burning-edges/supabase.env`;
  if ((!url || !key) && existsSync(f)) {
    for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (!m) continue;
      if (m[1] === "SUPABASE_URL" && !url) url = m[2];
      if (m[1] === "SUPABASE_SERVICE_KEY" && !key) key = m[2];
    }
  }
  if (!url) url = "https://rklfzqqusainitumsvta.supabase.co"; // project default
  if (!key) {
    console.error("ERROR: no SUPABASE_SERVICE_KEY found (env or ~/.burning-edges/supabase.env).");
    process.exit(1);
  }
  return { url, key };
}

const { url, key } = loadEnv();
const H = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
const REST = `${url}/rest/v1/pbc_snapshots`;

async function req(method, qs, body, prefer) {
  const res = await fetch(REST + (qs || ""), {
    method, headers: prefer ? { ...H, Prefer: prefer } : H,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

function books(calc) {
  const pools = ["silver", "nonsilver", "insert", "fotl"];
  const v = {}, c = {}; pools.forEach(k => (v[k] = 0, c[k] = 0));
  calc.top.forEach(x => { v[x.pool] += x.p * x.u; c[x.pool] += x.u; });
  for (const [p, i] of Object.entries(calc.tail)) { v[p] += i.value; c[p] += i.copies; }
  const per = {}; pools.forEach(k => per[k] = c[k] ? v[k] / c[k] : 0);
  const base = 2 * per.silver + per.nonsilver + (0.65 * per.nonsilver + 0.35 * per.insert);
  const fotl = v.fotl / calc.fotlPacks + base;
  return { base: Math.round(base * 100) / 100, fotl: Math.round(fotl * 100) / 100 };
}

const cmd = process.argv[2];

if (cmd === "verify") {
  const rows = await req("GET", "?select=id,published,computed_at,base_book,fotl_book,base_packs,fotl_packs&order=computed_at.desc");
  console.table(rows);

} else if (cmd === "insert") {
  const calc = JSON.parse(readFileSync(process.argv[3], "utf8"));
  const valuer = JSON.parse(readFileSync(process.argv[4], "utf8"));
  const b = books(calc);
  const row = {
    release: calc.release, base_packs: calc.basePacks, fotl_packs: calc.fotlPacks,
    base_book: b.base, fotl_book: b.fotl, base_mint: calc.mint, fotl_mint: calc.fotlMint,
    multiplier: calc.multiplier, payload: calc, valuer,
  };
  const [created] = await req("POST", "?select=id", row, "return=representation");
  console.log(`inserted snapshot id=${created.id} (published=false) — base_book ${b.base}, fotl_book ${b.fotl}`);

} else if (cmd === "publish") {
  const id = parseInt(process.argv[3], 10);
  if (!id) { console.error("usage: publish <id>"); process.exit(1); }
  await req("PATCH", `?id=neq.${id}`, { published: false });          // retire everything else
  const [row] = await req("PATCH", `?id=eq.${id}`, { published: true }, "return=representation");
  if (!row) { console.error(`no snapshot id=${id}`); process.exit(1); }
  console.log(`published id=${id} (all others set false)`);

} else {
  console.error("commands: verify | insert <calc.json> <valuer.json> | publish <id>");
  process.exit(1);
}
