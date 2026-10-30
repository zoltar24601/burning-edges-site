// ============================================================
// Panini Blockchain poller — the always-on worker.
// Loops: read new Sawtooth blocks -> decode panini-cx-crypto txns -> upsert to
// Supabase chain_events -> advance the chain_sync cursor. Uses a real headless
// browser (Playwright) because the explorer API sits behind Cloudflare and a
// plain server fetch gets 403; a real browser passes the managed challenge.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, [PANINI_API], [POLL_MS], [PAGE_LIMIT], [MAX_PAGES]
// Run: node chain-poller/poller.mjs   (from repo root)
// Restart marker: 2026-10-30 (resumable backfill, per-page writes, 20-block pages).
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
// NOTE (2026-10-30): the explorer CAPS pages at 20 blocks no matter what limit we
// ask for. With 800 pages/tick that is only 16,000 blocks, so once the cursor fell
// more than 16k blocks behind (after Oct 6) it could never be reached again: every
// tick crawled 800 pages and re-upserted ~235k events in one go, which overloaded
// Supabase and drew Cloudflare 403s. Now: each page is written as it is read, a
// backfill resumes where it stopped (bf below), and a tick reads at most MAX_PAGES.
const PAGE_LIMIT = +(process.env.PAGE_LIMIT || 20);    // the API's real cap
const MAX_PAGES = +(process.env.MAX_PAGES || 150);     // per tick (150 x 20 = 3,000 blocks)
// Never backfill deeper than this many blocks below the head (a long outage beyond
// it is logged and skipped rather than crawled for hours). ~1.5-2 days of blocks.
const MAX_BACKFILL_BLOCKS = +(process.env.MAX_BACKFILL_BLOCKS || 15000);
const PAGE_DELAY = +(process.env.PAGE_DELAY || 700);   // ms between pages -- stay under the rate limit
const CHUNK = 100;   // rows per Supabase write (small = short statements on a busy DB)
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

// fetch JSON from the API inside the cleared browser context. Absorbs HTTP 429
// (rate limit) with escalating backoff + retry of the SAME page, so a long
// backfill doesn't fail the whole tick and restart from the top. Other errors
// throw -> main loop backs off + rebuilds the session.
async function apiGet(path) {
  for (let attempt = 0; ; attempt++) {
    const r = await page.evaluate(async (u) => {
      try { const res = await fetch(u, { headers: { accept: "application/json" } }); return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null }; }
      catch (e) { return { ok: false, status: 0, body: null }; }
    }, API + path);
    if (r.ok) return r.body;
    if (r.status === 429 && attempt < 8) { await sleep(4000 * (attempt + 1)); continue; }   // rate limited -> wait, retry same page
    throw new Error("HTTP " + r.status);
  }
}

const sb = (path, opts) => fetch(`${SB_URL}/rest/v1/${path}`, { headers: SBH, ...opts });

// Supabase call that must succeed: retry a few times, then throw (no silent drops).
async function sbMust(path, opts, what) {
  for (let attempt = 0; ; attempt++) {
    let res, txt = "";
    try { res = await sb(path, opts); if (res.ok) return res; txt = await res.text(); } catch (e) { txt = e.message; }
    if (attempt >= 3) throw new Error(`supabase ${what} failed: ${res ? res.status : ""} ${txt.slice(0, 80)}`);
    await sleep(3000 * (attempt + 1));
  }
}
async function getCursor() {
  const rows = await (await sbMust("chain_sync?select=last_block_num&id=eq.1", {}, "cursor read")).json();
  return rows.length ? Number(rows[0].last_block_num) : 0;
}
async function setCursor(n) {
  await sbMust("chain_sync?id=eq.1", { method: "PATCH", body: JSON.stringify({ last_block_num: n, updated_at: new Date().toISOString() }) }, "cursor write");
}
async function upsertEvents(events) {
  for (let i = 0; i < events.length; i += CHUNK) {
    await sbMust("chain_events?on_conflict=tx_id", {
      method: "POST",
      headers: { ...SBH, Prefer: "resolution=ignore-duplicates,return=minimal" },   // chain data never changes: skip rows we have (far cheaper than merge)
      body: JSON.stringify(events.slice(i, i + CHUNK)),
    }, "events upsert");
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

const HEAD_PATH = `/blocks?limit=${PAGE_LIMIT}`;
const nextPath = (resp) => {
  const next = resp && resp.paging && resp.paging.next;
  if (!next) return null;
  // paging.next is a full URL (and http://) -- keep just path+query for apiGet.
  try { const u = new URL(next); return u.pathname + u.search; }
  catch { return next.startsWith("/") ? next : "/" + next; }
};

// Walk down from `path` until a block <= stop (reached), the chain runs out, or
// `budget` pages. Every page's events + pulls are written before the next page,
// so an error mid-walk never throws away work. onPage(next, head) lets the
// caller save where to resume.
async function walkDown(path, stop, budget, onPage) {
  let head = 0, pages = 0, events = 0, sales = 0, pulls = 0, reached = false;
  while (path && pages < budget) {
    const resp = await apiGet(path);
    const blocks = (resp && resp.data) || [];
    if (!blocks.length) { path = null; break; }
    const ev = [], pl = [];
    for (const b of blocks) {
      const num = b.header ? Number(b.header.block_num) : null;
      if (num == null) continue;
      if (num > head) head = num;
      if (num <= stop) { reached = true; continue; }
      ev.push(...blockEvents(b));
      pl.push(...blockPulls(b));
    }
    if (ev.length) await upsertEvents(ev);
    pulls += await recordPulls(pl);
    events += ev.length; sales += ev.filter(e => e.is_sale).length; pages++;
    path = reached ? null : nextPath(resp);
    if (onPage) onPage(path, head);
    if (reached) break;
    if (path) await sleep(PAGE_DELAY);
  }
  return { reached: reached || !path, path, head, pages, events, sales, pulls };
}

// In-progress backfill: { high: newest block already covered, path: where to
// resume walking down, low: the cursor it is walking down to }.
let bf = null;

async function tick() {
  let cursor = await getCursor();
  const t0 = Date.now();
  let msg;
  if (!bf) {
    // normal case: head -> cursor, usually 1-2 pages
    const top = await apiGet(HEAD_PATH);
    const head0 = Math.max(0, ...((top && top.data) || []).map(b => Number(b.header && b.header.block_num) || 0));
    if (head0 - cursor > MAX_BACKFILL_BLOCKS) {            // too far behind: cap the dig, say so
      console.log(`cursor ${cursor} is ${head0 - cursor} blocks behind head ${head0} -- backfilling only the last ${MAX_BACKFILL_BLOCKS}`);
      cursor = head0 - MAX_BACKFILL_BLOCKS;
    }
    let first = null;
    const w = await walkDown(HEAD_PATH, cursor, MAX_PAGES, (p, head) => {
      if (first == null) first = head;
      bf = { high: first, path: p, low: cursor };            // provisional, so an error or budget stop resumes here
    });
    if (w.reached) { bf = null; if (w.head > cursor) await setCursor(w.head); }
    msg = `head walk ${w.pages}p ${w.events} ev (${w.sales} sales, ${w.pulls} pulls)${bf ? ` -- backfill pending down to ${bf.low}` : ` -> cursor ${Math.max(w.head, cursor)}`}`;
  } else {
    // 1) new blocks above what the backfill already covers
    const top = await walkDown(HEAD_PATH, bf.high, MAX_PAGES, null);
    if (top.reached) bf.high = Math.max(bf.high, top.head);
    else { bf.high = top.head; bf.path = top.path; }       // new blocks outran a tick: resume from there (re-reads, never skips)
    // 2) keep digging the backfill with whatever budget is left
    const left = Math.max(MAX_PAGES - top.pages, 10);
    const low = await walkDown(bf.path, bf.low, left, (p) => { bf.path = p; });
    msg = `top ${top.pages}p ${top.events} ev | backfill ${low.pages}p ${low.events} ev (${top.sales + low.sales} sales, ${top.pulls + low.pulls} pulls)`;
    if (low.reached) { await setCursor(bf.high); msg += ` -- backfill DONE -> cursor ${bf.high}`; bf = null; }
    else msg += ` -- still digging (resume ${bf.path && bf.path.match(/start=(0x[0-9a-f]+)/i) ? parseInt(bf.path.match(/start=(0x[0-9a-f]+)/i)[1], 16) : "?"} -> ${bf.low})`;
  }
  console.log(`[${new Date().toISOString()}] ${msg} | ${Math.round((Date.now() - t0) / 1000)}s`);
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
