// ============================================================
// Panini Blockchain poller — the always-on worker.
// Loops: read new Sawtooth blocks -> decode panini-cx-crypto txns -> upsert to
// Supabase chain_events -> advance the chain_sync cursor. Uses a real headless
// browser (Playwright) because the explorer API sits behind Cloudflare and a
// plain server fetch gets 403; a real browser passes the managed challenge.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, [PANINI_API], [POLL_MS], [LOOKBACK]
// Run: node chain-poller/poller.mjs   (from repo root)
// ============================================================
import { chromium } from "playwright";
import { blockEvents } from "./panini-chain.mjs";   // vendored copy of tools/panini-chain.mjs

const API = process.env.PANINI_API || "https://explorerapi.paniniamerica.net";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const POLL_MS = +(process.env.POLL_MS || 30000);
const LOOKBACK = +(process.env.LOOKBACK || 40);   // blocks to scan each poll
const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

if (!SB_URL || !SB_KEY) { console.error("missing SUPABASE_URL / SUPABASE_SERVICE_KEY"); process.exit(1); }

let page;
async function browserReady() {
  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
  page = await ctx.newPage();
  await page.goto(`${API}/blocks?limit=1`, { waitUntil: "load", timeout: 60000 });  // clear Cloudflare
  console.log("browser session established (Cloudflare cleared)");
}

// fetch JSON from the API inside the cleared browser context; re-clear on failure
async function apiGet(path, retry = true) {
  try {
    const r = await page.evaluate(async (u) => {
      const res = await fetch(u, { headers: { accept: "application/json" } });
      return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
    }, API + path);
    if (r.ok) return r.body;
    throw new Error("HTTP " + r.status);
  } catch (e) {
    if (retry) { console.warn("apiGet retry after:", e.message); await page.goto(`${API}/blocks?limit=1`, { waitUntil: "load" }); return apiGet(path, false); }
    throw e;
  }
}

const sb = (path, opts) => fetch(`${SB_URL}/rest/v1/${path}`, { headers: SBH, ...opts });

async function getCursor() {
  const rows = await (await sb("chain_sync?select=last_block_num&id=eq.1")).json();
  return rows.length ? Number(rows[0].last_block_num) : 0;
}
async function setCursor(n) {
  await sb("chain_sync?id=eq.1", { method: "PATCH", body: JSON.stringify({ last_block_num: n, updated_at: new Date().toISOString() }) });
}
async function upsertEvents(events) {
  if (!events.length) return;
  await sb("chain_events?on_conflict=tx_id", {
    method: "POST",
    headers: { ...SBH, Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(events),
  });
}

async function tick() {
  const cursor = await getCursor();
  const resp = await apiGet(`/blocks?limit=${LOOKBACK}`);
  const blocks = (resp && resp.data) || [];
  let maxBlock = cursor, all = [];
  for (const b of blocks) {
    const num = b.header ? Number(b.header.block_num) : null;
    if (num == null || num <= cursor) continue;          // already ingested
    all.push(...blockEvents(b));
    if (num > maxBlock) maxBlock = num;
  }
  if (all.length) await upsertEvents(all);
  if (maxBlock > cursor) await setCursor(maxBlock);
  const sales = all.filter(e => e.is_sale).length;
  console.log(`[${new Date().toISOString()}] cursor ${cursor} -> ${maxBlock} | events ${all.length} (sales ${sales})`);
}

(async () => {
  await browserReady();
  for (;;) {
    try { await tick(); } catch (e) { console.error("tick error:", e.message); }
    await new Promise(r => setTimeout(r, POLL_MS));
  }
})();
