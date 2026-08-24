// ============================================================
// Moonbirds ("Birbs Beyond") sales-driven repricing (recency engine, Moonbirds
// config). Same shape as the NFL / Silhouette engines: last-3-months precedence,
// sticky (a price only moves on a real recent sale, else holds).
//
// Moonbirds specifics (per pbc-value.mjs philosophy):
//   - A real ordinary (mid-serial) sale is the truth and moves the price EITHER
//     way -- this is what lets a market dump actually show through (the old
//     Diamond model floored on offers and never dropped).
//   - Standing GLOBAL offers are HARD floors (someone is actively bidding that
//     serial): Birbhalla >= $2,000. Applied as a minimum even over a lower sale.
//   - Base Silver commons (the slot-1 pool) are capped so a wash can't spike them.
//
// Input:  values = [{ sku_base, value, cardset, athlete, run, slot }]  (slot: base|hit)
//         sales  = [{ athlete, parallel, serial, run, price, tags, sold_at }]
// Output: { newValues: { sku_base: { value, src } }, moves: [ ... ] }
// ============================================================

const DAY = 86400000;
const med = a => { a = [...a].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
const HARD_FLOOR = { "Birbhalla": 2000 };   // global standing offers = hard minimums
const COMMON_CAP = 50;                        // Base Silver pool sanity cap vs washes
// ordinary sale. On /1 cards the sale IS the card (serial 1 counts). On multi-serial
// cards a #1/last-serial/perfect-mint sale is a premium (already sold) -> excluded,
// so it never drags the sealed-copy value up.
const ord = s => Number(s.run) <= 1 ? true : (s.serial !== 1 && s.serial < s.run - 1 && !/perfect mint|jersey mint/i.test(s.tags || ""));

export function repriceMoon(values, sales, opts = {}) {
  const now = opts.now || Date.now();
  const buckets = {};
  for (const s of sales) { if (!ord(s)) continue; (buckets[s.athlete + "|" + s.parallel] = buckets[s.athlete + "|" + s.parallel] || []).push(s); }
  const marketValue = key => {
    const b = buckets[key]; if (!b) return null;
    const win = days => { const c = now - days * DAY; const v = b.filter(s => s.sold_at && new Date(s.sold_at).getTime() >= c).map(s => s.price); return v.length >= 2 ? med(v) : null; };
    return win(90) ?? win(180) ?? win(365) ?? null;
  };

  const newValues = {}, moves = [];
  for (const v of values) {
    const key = v.athlete + "|" + v.cardset;
    const money = v.slot !== "base" || Number(v.run) < 25;   // hits + scarce = market; Base Silver commons capped
    const floor = HARD_FLOOR[v.cardset] || 0;
    const cur = Number(v.value);
    let nv = cur, src = "hold";
    const mkt = marketValue(key);
    if (mkt != null) { nv = money ? mkt : Math.min(mkt, COMMON_CAP); src = "market"; }   // real sale moves it either way
    nv = Math.max(Math.round(nv), floor);                    // standing-offer hard floor
    newValues[v.sku_base] = { value: nv, src };
    if (nv !== cur) moves.push({ sku_base: v.sku_base, athlete: v.athlete, cardset: v.cardset, run: v.run, old: cur, new: nv, src });
  }
  return { newValues, moves };
}
