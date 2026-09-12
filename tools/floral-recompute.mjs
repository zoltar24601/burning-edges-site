// ============================================================
// Recompute the Floral Edition payload from remaining counts + the (repriced)
// value map. Same unified payload shape as the other packs, but the Floral pack
// is 2 cards drawn from ONE pool of 3 floral parallels (no base/hit split):
//   pack_book_ev = 2 x pool-weighted avg card value.
// Emits base_slots:0 / hit_slots:2, hit_breakdown = the 3 parallels, empty base.
// valueMap[key] = { v, cs, a, r }  ;  remaining[key] = copies left in the pool.
// ============================================================
const MULT = 2.5;
// SPECIAL SERIALS (same scheme as Animal Print): #1 = 3x, last (#run) = 2x,
// jersey # = 2x the normal value, broken out as their OWN rows and interleaved
// with the normal rows in ONE list sorted by value. Runs differ per parallel
// (Lotus /4, Cherry /9, Plum /18) so #last and the jersey guard adapt per card.
const CHASE_MIN = 100;    // normal row shown when the card is worth >= this
const SPECIAL_MIN = 100;  // only break out specials above this normal value
const FIRST_MULT = 3, LAST_MULT = 2, JERSEY_MULT = 2;
const JERSEY = {
  "Lionel Messi": 10, "Cristiano Ronaldo": 7, "Kylian Mbappe": 10, "Erling Haaland": 9,
  "Lamine Yamal": 19, "Jude Bellingham": 5, "Vinicius Junior": 7, "Harry Kane": 9,
  "Mohamed Salah": 11, "Luka Modric": 10, "Pedri": 8, "Diego Maradona": 10,
  "Zinedine Zidane": 10, "Andres Iniesta": 8, "Christian Pulisic": 10, "Michael Olise": 7,
};

export function recomputeFloral(remaining, valueMap) {
  const par = {}; let num = 0, den = 0; const hits = [];
  for (const [k, info] of Object.entries(valueMap)) {
    const u = remaining[k] || 0;
    if (u <= 0) continue;
    const v = info.v, run = info.r, s = info.cs;
    if (!par[s]) par[s] = { cardset: s, run, uncl: 0, valSum: 0 };
    par[s].uncl += u; par[s].valSum += v * u;
    num += v * u; den += u;   // book uses ALL copies (specials are display-only)

    const specials = [];
    if (v >= SPECIAL_MIN) {
      const addS = (sn, lbl, mult) => { if (sn >= 1 && sn <= run && !specials.some(x => x.sn === sn)) specials.push({ sn, lbl, p: Math.round(v * mult) }); };
      addS(1, "#1", FIRST_MULT);
      addS(run, "#" + run + " (last)", LAST_MULT);
      const jn = JERSEY[info.a];
      if (jn != null) addS(jn, "#" + jn + " (jersey)", JERSEY_MULT);
    }
    for (const sp of specials) hits.push({ c: info.a, s, r: run, sn: sp.sn, lbl: sp.lbl, u: 1, p: sp.p, kind: "special", st: "in packs" });
    const uNormal = u - specials.length;
    if (uNormal > 0 && v >= CHASE_MIN) hits.push({ c: info.a, s, r: run, lbl: "normal", u: uNormal, p: v, kind: "normal" });
  }
  const hit_breakdown = Object.values(par)
    .map(x => ({ cardset: x.cardset, run: x.run, uncl: x.uncl, avg_value: +(x.valSum / x.uncl).toFixed(2) }))
    .sort((a, b) => b.avg_value - a.avg_value);
  const poolAvg = den ? num / den : 0;
  const book = +(2 * poolAvg).toFixed(2);
  hits.sort((a, b) => b.p - a.p || (a.kind === b.kind ? a.c.localeCompare(b.c) : a.kind === "special" ? -1 : 1));

  return {
    type: "pack_analytics",
    product: "2026 Panini NFT Prizm World Cup - Floral Edition",
    updated: new Date().toISOString().slice(0, 10),
    data_note: "Craft pack (465 total, 2 cards each) from a 30-player floral pool. Seeded off our main World Cup pricing; reprices off realized on-chain floral sales once the pack trades on secondary.",
    pricing_mechanism: "seed = main-set Gold/Blue x floral rule x0.20; then chain-live floral sales (recency-weighted)",
    valuation_principle: "Modeled until floral cards trade; a real mid-serial floral sale then moves value either way.",
    structure: { cards_per_pack: 2, base_slots: 0, hit_slots: 2, total_packs: 465, note: "Each pack = 2 cards drawn from the floral pool (Plum /18, Cherry /9, Lotus /4)." },
    pack_ev: {
      method: "pool-weighted avg of the 3 floral parallels x 2 slots",
      cards_per_pack: 2, base_slots: 0, hit_slots: 2, multiplier: MULT, mint: null,
      base_card_ev: 0, base_slots_ev: 0, hit_card_ev: +poolAvg.toFixed(2), pack_book_ev: book,
      predicted_price: +(book * MULT).toFixed(2), base_pool_remaining: 0, hit_pool_remaining: den,
      base_breakdown: [], hit_breakdown,
    },
    cards_remaining: hits,
  };
}
