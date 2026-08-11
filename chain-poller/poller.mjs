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
import { blockEvents, blockPulls } from "./panini-chain.mjs";   // vendored copy of tools/panini-chain.mjs

const API = process.env.PANINI_API || "https://explorerapi.paniniamerica.net";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const POLL_MS = +(process.env.POLL_MS || 120000);   // 2 min -- gentler on Cloudflare
const LOOKBACK = +(process.env.LOOKBACK || 40);   // blocks to scan each poll
// Optional residential proxy (the durable fix for the datacenter-IP Cloudflare block).
// Set PROXY_SERVER=http://host:port (+ PROXY_USER / PROXY_PASS) in Railway env.
const PROXY_SERVER = process.env.PROXY_SERVER;
const SBH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

if (!SB_URL || !SB_KEY) { console.error("missing SUPABASE_URL / SUPABASE_SERVICE_KEY"); process.exit(1); }

let browser, page;
async function browserReady() {
  if (browser) { try { await browser.close(); } catch (_) {} }
  const opts = { headless: true, args: ["--no-sandbox"] };
  if (PROXY_SERVER) opts.proxy = { server: PROXY_SERVER, username: process.env.PROXY_USER, password: process.env.PROXY_PASS };
  browser = await chromium.launch(opts);
  const ctx = await browser.newContext({ userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36" });
  page = await ctx.newPage();
  await page.goto(`${API}/blocks?limit=1`, { waitUntil: "load", timeout: 60000 });  // clear Cloudflare
  console.log(`browser session established (Cloudflare cleared)${PROXY_SERVER ? " via proxy" : ""}`);
}

// fetch JSON from the API inside the cleared browser context. No inline re-clear
// hammering -- on failure we throw; the main loop backs off + rebuilds the session.
async function apiGet(path) {
  const r = await page.evaluate(async (u) => {
    const res = await fetch(u, { headers: { accept: "application/json" } });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
  }, API + path);
  if (r.ok) return r.body;
  throw new Error("HTTP " + r.status);
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

async function recordPulls(pulls) {
  if (!pulls.length) return 0;
  const rows = pulls.map(p => ({ tx_id: p.tx_id, sku_base: p.sku_base, serial: p.serial, run: p.run, to_key: p.to_key, block_num: p.block_num, ts: p.ts }));
  // insert; ignore ones we've already recorded, get back only the NEW pulls
  const res = await sb("chain_pulls?on_conflict=tx_id", {
    method: "POST", headers: { ...SBH, Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });
  const inserted = res.ok ? await res.json() : [];
  // decrement remaining once per new pull, grouped by card
  const byCard = {};
  for (const r of inserted) byCard[r.sku_base] = (byCard[r.sku_base] || 0) + 1;
  for (const [sku, n] of Object.entries(byCard)) {
    await sb("rpc/decrement_remaining", { method: "POST", body: JSON.stringify({ p_sku: sku, p_n: n }) });
  }
  return inserted.length;
}

async function tick() {
  const cursor = await getCursor();
  const resp = await apiGet(`/blocks?limit=${LOOKBACK}`);
  const blocks = (resp && resp.data) || [];
  let maxBlock = cursor, all = [], pulls = [];
  for (const b of blocks) {
    const num = b.header ? Number(b.header.block_num) : null;
    if (num == null || num <= cursor) continue;          // already ingested
    all.push(...blockEvents(b));
    pulls.push(...blockPulls(b));
    if (num > maxBlock) maxBlock = num;
  }
  if (all.length) await upsertEvents(all);
  const newPulls = await recordPulls(pulls);
  if (maxBlock > cursor) await setCursor(maxBlock);
  const sales = all.filter(e => e.is_sale).length;
  console.log(`[${new Date().toISOString()}] cursor ${cursor} -> ${maxBlock} | events ${all.length} (sales ${sales}, pulls ${newPulls})`);
}

(async () => {
  await browserReady();
  let fails = 0;
  for (;;) {
    try { await tick(); fails = 0; }
    catch (e) {
      fails++;
      console.error(`tick error: ${e.message} (consecutive ${fails})`);
      // On a run of failures (e.g. a Cloudflare 403 wall) rebuild the browser
      // session -- a fresh challenge sometimes clears; with PROXY_SERVER set it
      // reconnects through the residential IP.
      if (fails % 5 === 0) { try { await browserReady(); console.log("browser session rebuilt after failures"); } catch (be) { console.error("rebuild failed:", be.message); } }
    }
    // exponential-ish back-off while failing (up to 10 min), normal cadence when healthy
    const wait = fails ? Math.min(POLL_MS * Math.min(fails, 5), 600000) : POLL_MS;
    await new Promise(r => setTimeout(r, wait));
  }
})();
