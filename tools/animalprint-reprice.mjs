// ============================================================
// Animal Print Parallels sales-driven repricing (recency engine, same shape as
// the Floral / NFL / Silhouette / Moonbirds engines). Sticky: a card's value
// only moves when a REAL recent Animal Print sale lands, else it holds the
// seeded/modeled value. Giraffe and Elephant are both /20; a #1/last-serial
// sale is a premium (excluded via ord()). No owner floors yet -- add scarce
// floors here if the market proves thin once it trades.
//
// Input:  values = [{ sku_base, value, cardset, athlete, run, slot }]
//         sales  = [{ athlete, parallel, serial, run, price, tags, sold_at }]
// Output: { newValues: { sku_base: { value, src } }, moves: [ ... ] }
// ============================================================
const DAY = 86400000;
const med = a => { a = [...a].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
// ONLY #1 (first) and #run (last) are premium serials; every other serial --
// including #19 of /20 -- is ordinary. (Was `serial < run-1`, an off-by-one that
// wrongly treated the last TWO serials as premium.)
const ord = s => Number(s.run) <= 1 ? true : (s.serial !== 1 && s.serial !== Number(s.run) && !/perfect mint|jersey mint/i.test(s.tags || ""));
// A #1 or last-serial sale is a PREMIUM (grail serial), normally excluded from
// the ordinary value. But when it's the ONLY signal we have, John's rule: use
// ~1/3 of that premium price as the normal-serial value (else the card sits at
// its stale seed while a real -- if premium -- sale exists on-chain).
const PREMIUM_TO_NORMAL = 1 / 3;
const isPremium = s => Number(s.run) > 1 && (s.serial === 1 || s.serial === Number(s.run));
// Giraffe and Elephant are the SAME /20 rarity, so they price EQUALLY per
// player -- we pool both parallels' sales by athlete (a sale of either moves
// both). Owner floors keep a card from a sale dragging it below its anchor
// (e.g. Messi: a #1 Elephant sale shouldn't cut ordinary below his $1,600).
const OWNER_FLOORS = { "Lionel Messi": 1600 };

export function repriceAnimalPrint(values, sales, opts = {}) {
  const now = opts.now || Date.now();
  const buckets = {}, premBuckets = {};
  for (const s of sales) {
    const key = s.athlete;   // pool Giraffe + Elephant together -> equal price
    if (ord(s)) (buckets[key] = buckets[key] || []).push(s);
    else if (isPremium(s)) (premBuckets[key] = premBuckets[key] || []).push(s);
  }
  const windowMed = (b) => {
    if (!b) return null;
    const win = days => { const c = now - days * DAY; const v = b.filter(s => s.sold_at && new Date(s.sold_at).getTime() >= c).map(s => s.price); return v.length ? med(v) : null; };
    return win(90) ?? win(180) ?? win(365) ?? null;
  };
  // A SINGLE real ordinary sale moves a thin-market craft card (>=1, not >=2).
  const marketValue = key => { const b = buckets[key]; if (!b) return null; const win = days => { const c = now - days * DAY; const v = b.filter(s => s.sold_at && new Date(s.sold_at).getTime() >= c).map(s => s.price); return v.length >= 1 ? med(v) : null; }; return win(90) ?? win(180) ?? win(365) ?? null; };
  const premiumNormalValue = key => { const p = windowMed(premBuckets[key]); return p != null ? Math.round(p * PREMIUM_TO_NORMAL) : null; };

  const newValues = {}, moves = [];
  for (const v of values) {
    const key = v.athlete;   // both parallels keyed by athlete -> same value
    const cur = Number(v.value);
    let nv = cur, src = "hold";
    const mkt = marketValue(key);
    if (mkt != null) { nv = Math.round(mkt); src = "market"; }        // real ordinary sales win
    else { const pn = premiumNormalValue(key); if (pn != null) { nv = pn; src = "premium/3"; } }  // else 1/3 of a #1-only sale
    const floor = OWNER_FLOORS[v.athlete];
    if (floor != null && nv < floor) { nv = floor; src = src === "hold" ? "floor" : src + "+floor"; }
    newValues[v.sku_base] = { value: nv, src };
    if (nv !== cur) moves.push({ sku_base: v.sku_base, athlete: v.athlete, cardset: v.cardset, run: v.run, old: cur, new: nv, src });
  }
  return { newValues, moves };
}
