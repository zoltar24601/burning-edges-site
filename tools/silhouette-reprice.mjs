// ============================================================
// Silhouette Basketball sales-driven repricing (recency engine, Silhouette config).
// Same rules as the NFL engine: last-3-months precedence, sticky (a price only
// moves on a real recent sale, else holds), owner anchors are floors.
//
// Silhouette specifics:
//   - Cooper Flagg is an owner anchor (1/1 = $40k, /10 = $7,500): FLOOR only --
//     market can raise him, never drop below the frozen value.
//   - "money" cards (hits, plus scarce base /1 & /10) price straight to market;
//     the base-pool commons (run >= 25) stay capped so a wash can't spike them.
//
// Input:  values = [{ sku_base, value, cardset, athlete, run, slot }]  (slot: base|hit)
//         sales  = [{ athlete, parallel, serial, run, price, tags, sold_at }]
// Output: { newValues: { sku_base: { value, src } }, moves: [ ... ] }
// ============================================================

const DAY = 86400000;
const med = a => { a = [...a].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
const KEEP = new Set(["Cooper Flagg"]);   // owner anchors -> floor
const COMMON_CAP = 50;                     // base-pool commons (run >= 25) sanity cap
const ord = s => s.serial !== 1 && s.serial < s.run - 1 && !/perfect mint|jersey mint/i.test(s.tags || "");

export function repriceSil(values, sales, opts = {}) {
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
    const ok = v.athlete + "|" + v.cardset;
    const money = v.slot !== "base" || Number(v.run) < 25;    // hits + scarce base = market; base commons capped
    const cap = x => money ? x : Math.min(x, COMMON_CAP);
    const cur = Number(v.value);
    let nv = cur, src = "hold";
    const mkt = marketValue(ok);
    if (mkt != null) {
      const m = cap(mkt);
      if (KEEP.has(v.athlete)) { if (m > cur) { nv = m; src = "market"; } }   // Flagg: floor, only up
      else { nv = m; src = "market"; }                                          // others: market both ways
    }
    nv = Math.round(nv);
    newValues[v.sku_base] = { value: nv, src };
    if (nv !== cur) moves.push({ sku_base: v.sku_base, athlete: v.athlete, cardset: v.cardset, run: v.run, old: cur, new: nv, src });
  }
  return { newValues, moves };
}
