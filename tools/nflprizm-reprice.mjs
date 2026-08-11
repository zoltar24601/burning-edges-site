// ============================================================
// 2021 NFL Prizm sales-driven repricing (the recency engine, as a module).
//
// Input:  values = current per-card map  [{ sku_base, value, cardset, athlete, run, slot }]
//         sales  = the running sales log  [{ athlete, parallel, serial, run, price, tags, sold_at }]
// Output: { newValues: { sku_base: { value, src } }, moves: [ ... ] }
//
// Rules (per John): last-3-months takes precedence; a price only moves on a real
// recent sale, otherwise it HOLDS (sticky); owner anchors are floors; money cards
// (kaboom/gold/gv/rare) price straight to market, wash-prone commons stay capped;
// challenge-corner farces and junk-transfer base sales stay excluded.
// The Brady Gold #1/10 grail premium is applied in the snapshot recompute, not here.
// ============================================================

const DAY = 86400000;
const med = a => { a = [...a].sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };

const OVERRIDE = { "Tom Brady|Gold": 50000, "Patrick Mahomes II|Gold": 30000 };
const FARCE = new Set(["Landon Collins"]);
const KEEP = new Set(["Pat Tillman"]);
const MONEY = new Set(["kaboom", "gold", "gv", "rare"]);
const CEIL = { "Silver": 80, "Rookies Silver": 5, "Blue Camo": 200, "Rookies Blue Camo": 10, "Purple Power": 250, "Rookies Purple Power": 40, "Black White Night": 100, "Spectra Neon Nights": 40, "Spectra Retro Spectacle": 125, "Base": 20, "Rookies": 5, "Base Challenge": 60 };
const NOISE = new Set(["Base", "Rookies", "Red", "Rookies Red", "Red Challenge", "Purple Power Challenge", "Blue Camo Challenge", "Silver Challenge", "Base Challenge", "Gold Vinyl", "Rookies Gold Vinyl", "White Sparkle", "Rookies White Sparkle"]);
const pclass = cs => cs === "Absolute Kaboom" ? "kaboom" : (cs === "Gold" || cs === "Rookies Gold") ? "gold" : (cs === "Gold Vinyl" || cs === "Rookies Gold Vinyl") ? "gv" : (cs === "Red" || cs === "Rookies Red" || cs === "White Sparkle" || cs === "Rookies White Sparkle") ? "rare" : (cs === "Purple Power" || cs === "Rookies Purple Power" || cs === "Blue Camo" || cs === "Rookies Blue Camo") ? "mid" : "base";
const ord = s => s.serial !== 1 && s.serial < s.run - 1 && !/perfect mint|jersey mint/i.test(s.tags || "");

export function repriceNfl(values, sales, opts = {}) {
  const now = opts.now || Date.now();

  // player tier from legit sales (noise-excluded) -- gates trust on rare/gv role players
  const pscore = {};
  for (const s of sales) { if (s.serial === 1 || s.serial >= s.run - 1 || NOISE.has(s.parallel)) continue; pscore[s.athlete] = Math.max(pscore[s.athlete] || 0, s.price); }
  const tier = p => FARCE.has(p) ? 1 : p === "Tom Brady" ? 6 : p === "Patrick Mahomes II" ? 5 : (pscore[p] || 0) >= 1500 ? 4 : (pscore[p] || 0) >= 400 ? 3 : (pscore[p] || 0) >= 60 ? 2 : (pscore[p] || 0) > 0 ? 1.3 : 1;

  const buckets = {};
  for (const s of sales) { if (!ord(s)) continue; (buckets[s.athlete + "|" + s.parallel] = buckets[s.athlete + "|" + s.parallel] || []).push(s); }
  const marketValue = key => {
    const b = buckets[key]; if (!b) return null;
    const win = days => { const c = now - days * DAY; const v = b.filter(s => s.sold_at && new Date(s.sold_at).getTime() >= c).map(s => s.price); return v.length >= 2 ? med(v) : null; };
    return win(90) ?? win(180) ?? win(365) ?? null;   // 3mo precedence; hold if none
  };

  const newValues = {}, moves = [];
  for (const v of values) {
    const ok = v.athlete + "|" + v.cardset, cl = pclass(v.cardset);
    const cap = x => CEIL[v.cardset] != null ? Math.min(x, CEIL[v.cardset]) : x;
    let nv = Number(v.value), src = "hold";
    if (OVERRIDE[ok] !== undefined) { nv = OVERRIDE[ok]; src = "owner"; }
    else if (!FARCE.has(v.athlete)) {
      const trust = KEEP.has(v.athlete) ? true : (cl === "rare" ? tier(v.athlete) >= 4 : (cl === "gv" ? tier(v.athlete) >= 3 : true));
      const mkt = marketValue(ok);
      if (mkt != null && trust) { nv = MONEY.has(cl) ? mkt : cap(mkt); src = "market"; }
    }
    nv = Math.round(nv);
    newValues[v.sku_base] = { value: nv, src };
    if (nv !== Number(v.value)) moves.push({ sku_base: v.sku_base, athlete: v.athlete, cardset: v.cardset, run: v.run, old: Number(v.value), new: nv, src });
  }
  return { newValues, moves };
}
