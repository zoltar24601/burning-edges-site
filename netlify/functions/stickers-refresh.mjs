// ============================================================
// HOURLY reprice for the 2026 WC Sticker pack (/stickers).
//   1. load the rolling sales log from stickers_snapshots (first run: seed from
//      data/stickers26-sales.json)
//   2. append new on-chain sticker sales since the last run (chain_events,
//      packcard-850180_*, mapped to player/parallel via data/stickers26-cards.json)
//   3. re-run tools/stickers-model.mjs (same model that bakes the static page)
//   4. save payload + pruned sales log -> /api/stickers-data serves the payload
// Copies left, rules, overrides and the pack market snapshot come from
// data/stickers26-checklist.json (updated by hand from Panini's reports).
// Env (Netlify): SUPABASE_URL, SUPABASE_SERVICE_KEY. Table: migrations/011.
// ============================================================
import { stickersModel } from "../../tools/stickers-model.mjs";
import ck from "../../data/stickers26-checklist.json";
import seed from "../../data/stickers26-sales.json";
import cards from "../../data/stickers26-cards.json";

export const config = { schedule: "@hourly" };
const PRODUCT = "stickers26";
const OVERLAP_MS = 30 * 60 * 1000;          // re-read the last 30 min (dedup makes it safe)
const MAX_BACK_MS = 7 * 24 * 3600 * 1000;   // never scan more than a week of chain_events
const KEEP_MS = 72 * 3600 * 1000;           // prune: last 72h + newest 10 per card + post-burn Silvers
const dkey = x => [x.a, x.p, x.serial, x.date].join("|");

export default async () => {
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return resp(500, { error: "missing Supabase env" });
  const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
  try {
    // 1) rolling sales log
    const rows = await (await fetch(`${SB_URL}/rest/v1/stickers_snapshots?product=eq.${PRODUCT}&select=id,sales,last_ts&order=computed_at.desc&limit=1`, { headers: H })).json();
    if (!Array.isArray(rows)) return resp(502, { error: "stickers_snapshots unreadable (run migrations/011?)", detail: rows });
    const row = rows[0];
    let sales = row ? row.sales : seed.sales.map(({ a, p, serial, run, price, date, tags }) => ({ a, p, serial, run, price, date: date.slice(0, 19), tags }));
    const newestSeed = sales.map(x => x.date).sort().at(-1);
    const lastTs = row && row.last_ts ? Date.parse(row.last_ts) : Date.parse(newestSeed + "Z");

    // 2) new chain sales (bounded by ts so it never scans the whole table)
    const since = new Date(Math.max(lastTs - OVERLAP_MS, Date.now() - MAX_BACK_MS)).toISOString();
    const evs = [];
    for (let off = 0; ; off += 1000) {
      const r = await (await fetch(`${SB_URL}/rest/v1/chain_events?sku_base=gte.packcard-850180_&sku_base=lt.packcard-850181&price=gt.0&ts=gte.${since}&select=sku_base,serial,run,price,ts&order=ts.asc&limit=1000&offset=${off}`, { headers: H })).json();
      if (!Array.isArray(r)) return resp(502, { error: "chain_events read failed", detail: r });
      evs.push(...r);
      if (r.length < 1000) break;
    }
    const notable = new Set(ck.cards.map(c => c.a + "|" + c.p));
    const seen = new Set(sales.map(dkey));
    let added = 0, newest = lastTs;
    for (const e of evs) {
      const m = cards[e.sku_base.replace("packcard-850180_", "")];
      if (!m) continue;
      const [a, p] = m;
      if (p !== "Silver" && !notable.has(a + "|" + p)) continue;   // the model only reads these
      const x = { a, p, serial: e.serial, run: e.run, price: Number(e.price), date: e.ts.slice(0, 19),
                  tags: e.run > 1 && e.serial === 1 ? "number 1" : e.run > 1 && e.serial === e.run ? "perfect mint" : "" };
      newest = Math.max(newest, Date.parse(e.ts));
      if (seen.has(dkey(x))) continue;
      seen.add(dkey(x)); sales.push(x); added++;
    }

    // 3) reprice
    const pricedAt = new Date().toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " ET";
    const payload = stickersModel(ck, sales, seed.window_from, pricedAt);

    // 4) prune + save (one row, updated in place)
    const keepFrom = new Date(Date.now() - KEEP_MS).toISOString().slice(0, 19);
    const sbSince = ck.rules?.silver_burn?.since || "9999";
    const perCard = {};
    sales.sort((a, b) => b.date.localeCompare(a.date));
    sales = sales.filter(x => {
      const k = x.a + "|" + x.p; perCard[k] = (perCard[k] || 0) + 1;
      return x.date >= keepFrom || perCard[k] <= 10 || (x.p === "Silver" && x.date >= sbSince);
    });
    const body = { product: PRODUCT, updated: pricedAt, pack_book_ev: payload.book, payload, sales, last_ts: new Date(newest).toISOString(), published: true, computed_at: new Date().toISOString() };
    const w = row
      ? await fetch(`${SB_URL}/rest/v1/stickers_snapshots?id=eq.${row.id}`, { method: "PATCH", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(body) })
      : await fetch(`${SB_URL}/rest/v1/stickers_snapshots`, { method: "POST", headers: { ...H, Prefer: "return=minimal" }, body: JSON.stringify(body) });
    if (!w.ok) return resp(502, { error: "save failed", status: w.status, detail: await w.text() });
    return resp(200, { ok: true, seeded: !row, chain_rows: evs.length, sales_added: added, sales_kept: sales.length, book: payload.book });
  } catch (e) { return resp(500, { error: String(e) }); }
};

function resp(status, body) { return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }); }
