// ============================================================
// Panini Blockchain poller — the always-on worker.
// Loops: read new Sawtooth blocks -> decode panini-cx-crypto txns -> upsert to
// Supabase chain_events -> advance the chain_sync cursor. Uses a real headless
// browser (Playwright) because the explorer API sits behind Cloudflare and a
// plain server fetch gets 403; a real browser passes the managed challenge.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, [PANINI_API], [POLL_MS], [PAGE_LIMIT], [MAX_PAGES]
// Run: node chain-poller/poller.mjs   (from repo root)
// Restart marker: 2026-09-12 (rebuilt: page cursor->head, no more skipped gaps).
// ============================================================
import { chromium } from "playwright";
import { blockEvents, blockPulls } from "./panini-chain.mjs";   // vendored copy of tools/panini-chain.mjs

const API = process.env.PANINI_API || "https://explorerapi.paniniamerica.net";
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const POLL_MS = +(process.env.POLL_MS || 120000);   // 2 min -- gentler on Cloudflare
// Paging: read EVERY block from the cursor up to the chain head, following the
// explorer's paging.next, instead of only grabbing the latest N (the old bug
// that silently dropped every block in a gap -- e.g. the whole 3-day trial
// outage). PAGE_LIMIT per request, up to MAX_PAGES per tick (covers a large
// backfill in one recovery tick), a small delay between pages to stay gentle on
// Cloudflare. To backfill an existing hole, just set chain_sync.last_block_num
// back to the start of the gap and the next tick walks head -> that block.
const PAGE_LIMIT = +(process.env.PAGE_LIMIT || 50);
const MAX_PAGES = +(process.env.MAX_PAGES || 800);
const PAGE_DELAY = +(process.env.PAGE_DELAY || 150);
const CHUNK = 500;   // rows per Supabase write
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  for (let i = 0; i < events.length; i += CHUNK) {
    await sb("chain_events?on_conflict=tx_id", {
      method: "POST",
      headers: { ...SBH, Prefer: "resolution=merge-duplicates,return=minimal" },
      body: JSON.stringify(events.slice(i, i + CHUNK)),
    });
  }
}

async function recordPulls(pulls) {
  if (!pulls.length) return 0;
  const rows = pulls.map(p => ({ tx_id: p.tx_id, sku_base: p.sku_base, serial: p.serial, run: p.run, to_key: p.to_key, block_num: p.block_num, ts: p.ts }));
  const byCard = {};
  let insertedCount = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    // insert; ignore ones we've already recorded, get back only the NEW pulls
    const res = await sb("chain_pulls?on_conflict=tx_id", {
      method: "POST", headers: { ...SBH, Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify(rows.slice(i, i + CHUNK)),
    });
    const inserted = res.ok ? await res.json() : [];
    insertedCount += inserted.length;
    for (const r of inserted) byCard[r.sku_base] = (byCard[r.sku_base] || 0) + 1;   // decrement once per NEW pull
  }
  for (const [sku, n] of Object.entries(byCard)) {
    await sb("rpc/decrement_remaining", { method: "POST", body: JSON.stringify({ p_sku: sku, p_n: n }) });
  }
  return insertedCount;
}

async function tick() {
  const cursor = await getCursor();
  // Walk from the chain head backward via paging.next, ingesting EVERY block
  // whose num > cursor, until we reach a block already ingested (num <= cursor)
  // or run out of pages. This closes any gap (normal 1-2 pages; a big backfill
  // pages more, bounded by MAX_PAGES) instead of skipping to the head.
  let path = `/blocks?limit=${PAGE_LIMIT}`;
  let head = cursor, all = [], pulls = [], pages = 0, reached = false;
  while (path && pages < MAX_PAGES) {
    const resp = await apiGet(path);
    const blocks = (resp && resp.data) || [];
    if (!blocks.length) break;
    for (const b of blocks) {
      const num = b.header ? Number(b.header.block_num) : null;
      if (num == null) continue;
      if (num > head) head = num;
      if (num <= cursor) { reached = true; continue; }   // hit already-ingested territory
      all.push(...blockEvents(b));
      pulls.push(...blockPulls(b));
    }
    pages++;
    if (reached) break;
    const next = resp.paging && resp.paging.next;
    if (!next) break;   // reached genesis / no more pages
    // paging.next is a full URL (and http://, one char shorter than our https
    // base) -- parse out path+query so apiGet's `API + path` stays well-formed.
    try { const u = new URL(next); path = u.pathname + u.search; }
    catch { path = next.startsWith("/") ? next : "/" + next; }
    await sleep(PAGE_DELAY);
  }
  if (all.length) await upsertEvents(all);
  const newPulls = await recordPulls(pulls);
  // Only advance the cursor when the fetched range is contiguous down to the old
  // cursor (reached) or we paged to the very end (!path). If we stopped on
  // MAX_PAGES with a gap still open, leave the cursor so the next tick continues.
  const complete = reached || !path;
  if (head > cursor && complete) await setCursor(head);
  const sales = all.filter(e => e.is_sale).length;
  console.log(`[${new Date().toISOString()}] cursor ${cursor} -> ${complete ? head : cursor} (head ${head}) | pages ${pages}${complete ? "" : " MAX_PAGES-gap-remains"} | events ${all.length} (sales ${sales}, pulls ${newPulls})`);
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
