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
// A #1 or last-serial sale is a PREMIUM (grail serial), normally excluded from
// the ordinary value. When it's the ONLY signal, John's rule: use ~1/3 of that
// premium price as the normal-serial value (e.g. Messi Plum #1 sold $2,650 with
// no mid-serial sales -> normal ~ $883, instead of sitting at the stale seed).
const PREMIUM_TO_NORMAL = 1 / 3;
const isPremium = s => Number(s.run) > 1 && (s.serial === 1 || s.serial >= Number(s.run) - 1);
// OWNER FLOORS / manual anchors, keyed "athlete|parallel". A value never prices
// below its floor (this is also where standing global-offer floors will live
// once we read them). Messi Plum: only sale is his #1 ($2,650 -> 1/3 = $883),
// but a $1,080 global offer stands and it should track Yamal ($1,599) -> floor
// it near Yamal. Real ordinary sales above the floor still win.
const OWNER_FLOORS = {
  "Lionel Messi|Plum Blossom": 1600,
};
// STRENGTH RATIO vs Messi, averaged across the tiers we HAVE priced (Lotus +
// Cherry). For a player with NO sale on a parallel, estimate = ratio x Messi's
// value on that same parallel -- so e.g. Ronaldo Plum (no sale) tracks his
// typical ~0.30 of Messi instead of sitting at a stale seed. Applied as a LIFT
// only (never drops a card below its seed), so low players don't round to $0.
const RATIO = {"Nico Paz":0.01,"Lionel Messi":1.0,"Diego Maradona":0.09,"Michael Olise":0.066,"Desire Doue":0.024,"Ousmane Dembele":0.0136,"Kylian Mbappe":0.264,"Zinedine Zidane":0.024,"Lennart Karl":0.028,"Franz Beckenbauer":0.012,"Lamine Yamal":0.72,"Pedri":0.006,"Estevao":0.025,"Vinicius Junior":0.0138,"Endrick":0.0155,"Harry Kane":0.013,"Jude Bellingham":0.0238,"Luka Modric":0.01,"Mohamed Salah":0.0088,"Yan Diomande":0.03,"Heung-min Son":0.005,"Gilberto Mora":0.013,"Julian Ryerson":0.0002,"Erling Haaland":0.3,"Cristiano Ronaldo":0.3,"Ibrahim Mbaye":0.008,"Johan Manzambi":0.01,"Christian Pulisic":0.013,"Kenan Yildiz":0.0002,"Arda Guler":0.0002,"Andres Iniesta":0.024};

export function repriceFloral(values, sales, opts = {}) {
  const now = opts.now || Date.now();
  const buckets = {}, premBuckets = {};
  for (const s of sales) {
    const key = s.athlete + "|" + s.parallel;
    if (ord(s)) (buckets[key] = buckets[key] || []).push(s);
    else if (isPremium(s)) (premBuckets[key] = premBuckets[key] || []).push(s);
  }
  const windowMed = (b) => { if (!b) return null; const win = days => { const c = now - days * DAY; const v = b.filter(s => s.sold_at && new Date(s.sold_at).getTime() >= c).map(s => s.price); return v.length ? med(v) : null; }; return win(90) ?? win(180) ?? win(365) ?? null; };
  const marketValue = key => {
    const b = buckets[key]; if (!b) return null;
    // A SINGLE real ordinary sale is enough to move a thin-market craft card
    // (Yamal Plum #9 sold $1,599 -> we were holding a $200 seed because the old
    // rule required >=2 sales). Median of whatever the window holds.
    const win = days => { const c = now - days * DAY; const v = b.filter(s => s.sold_at && new Date(s.sold_at).getTime() >= c).map(s => s.price); return v.length >= 1 ? med(v) : null; };
    return win(90) ?? win(180) ?? win(365) ?? null;
  };
  const premiumNormalValue = key => { const p = windowMed(premBuckets[key]); return p != null ? Math.round(p * PREMIUM_TO_NORMAL) : null; };

  // Per-parallel anchor = Messi's (floored) value on that parallel, for the
  // ratio fallback below.
  const anchorByParallel = {};
  for (const v of values) if (v.athlete === "Lionel Messi") {
    anchorByParallel[v.cardset] = Math.max(Number(v.value), OWNER_FLOORS["Lionel Messi|" + v.cardset] || 0);
  }

  const newValues = {}, moves = [];
  for (const v of values) {
    const key = v.athlete + "|" + v.cardset;
    const cur = Number(v.value);
    let nv = cur, src = "hold";
    const mkt = marketValue(key);
    if (mkt != null) { nv = Math.round(mkt); src = "market"; }   // real ordinary floral sales win
    else { const pn = premiumNormalValue(key); if (pn != null) { nv = pn; src = "premium/3"; } }  // else 1/3 of a #1-only sale
    if (src === "hold") {   // no sale at all -> estimate from ratio-to-Messi (lift only)
      const anchor = anchorByParallel[v.cardset], r = RATIO[v.athlete];
      if (anchor && r != null) { const est = Math.round(r * anchor); if (est > nv) { nv = est; src = "ratio"; } }
    }
    const floor = OWNER_FLOORS[key];
    if (floor != null && nv < floor) { nv = floor; src = src === "hold" ? "floor" : src + "+floor"; }  // never below owner/offer floor
    newValues[v.sku_base] = { value: nv, src };
    if (nv !== cur) moves.push({ sku_base: v.sku_base, athlete: v.athlete, cardset: v.cardset, run: v.run, old: cur, new: nv, src });
  }
  return { newValues, moves };
}
