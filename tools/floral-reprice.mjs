// ============================================================
// Floral Edition sales-driven repricing (recency engine, same shape as the
// NFL / Silhouette / Moonbirds engines). Sticky: a floral card's value only
// moves when a REAL recent floral sale lands, else it holds the seeded/modeled
// value. On /4 the sale IS the card; on /9 and /18 a #1/last-serial sale is a
// premium (excluded). No owner floors yet -- add scarce-parallel floors here if
// the market proves thin once it trades.
//
// Input:  values = [{ sku_base, value, cardset, athlete, run, slot }]
//         sales  = [{ athlete, parallel, serial, run, price, tags, sold_at }]
// Output: { newValues: { sku_base: { value, src } }, moves: [ ... ] }
// ============================================================
const DAY = 86400000;
const med = a => { a = [...a].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
const ord = s => Number(s.run) <= 1 ? true : (s.serial !== 1 && s.serial < s.run - 1 && !/perfect mint|jersey mint/i.test(s.tags || ""));

export function repriceFloral(values, sales, opts = {}) {
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
    const cur = Number(v.value);
    let nv = cur, src = "hold";
    const mkt = marketValue(key);
    if (mkt != null) { nv = Math.round(mkt); src = "market"; }   // a real floral sale moves it either way
    newValues[v.sku_base] = { value: nv, src };
    if (nv !== cur) moves.push({ sku_base: v.sku_base, athlete: v.athlete, cardset: v.cardset, run: v.run, old: cur, new: nv, src });
  }
  return { newValues, moves };
}
