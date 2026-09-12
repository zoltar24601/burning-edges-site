// ============================================================
// Recompute the Animal Print Parallels payload from remaining counts + the
// (repriced) value map. The pack is 2 cards, but UNLIKE Floral's single random
// pool it is DETERMINISTIC: every pack = exactly 1 Giraffe /20 + 1 Elephant /20,
// each a random player from that parallel's 30-player pool. So:
//   pack_book_ev = (avg Giraffe card value) + (avg Elephant card value)
// Emits base_slots:0 / hit_slots:2, hit_breakdown = the 2 animal parallels.
// valueMap[key] = { v, cs, a, r, slot }  ;  remaining[key] = copies left.
// ============================================================
const MULT = 2.5;
const CHASE_MIN = 25;   // show player-cards worth >= this on the chase board
const GIRAFFE = "Base Choice Prizms Giraffe";
const ELEPHANT = "Base Choice Prizms Elephant";

// SPECIAL SERIALS. We read exact serials off-chain, so we price the chase
// serials separately from the "normal" (mid-serial) value (John's multipliers):
//   #1 (first serial)     = 3x normal
//   #run (last serial)    = 2x normal
//   jersey-number serial  = 2x normal
// When a real on-chain sale exists for that exact serial we use it instead
// (handled by the refresh/reprice layer); here we emit the modeled premium.
const FIRST_MULT = 3;
const LAST_MULT = 2;
const JERSEY_MULT = 2;
const SPECIAL_MIN = 100;   // only break out specials for cards worth >= this normal
// Best-known shirt numbers for the checklist stars (edit as needed). Only used
// to flag the jersey-match serial; players not here just get #1 + #last.
const JERSEY = {
  "Lionel Messi": 10, "Cristiano Ronaldo": 7, "Kylian Mbappe": 10, "Erling Haaland": 9,
  "Lamine Yamal": 19, "Jude Bellingham": 5, "Vinicius Junior": 7, "Harry Kane": 9,
  "Mohamed Salah": 11, "Luka Modric": 10, "Pedri": 8, "Diego Maradona": 10,
  "Zinedine Zidane": 10, "Andres Iniesta": 8, "Christian Pulisic": 10, "Michael Olise": 7,
};

export function recomputeAnimalPrint(remaining, valueMap) {
  // ONE unified list: special serials (#1 = 3x, last = 2x, jersey = 2x) broken
  // out as their own rows, and the normal-serial row with the LEFTOVER count
  // (run minus however many specials we split off -> e.g. 17/20). Everything
  // sorts together by value, so Messi/Yamal specials sit at the top and the
  // normal serials fall in wherever their value lands.
  const par = {}; const hits = [];
  for (const [k, info] of Object.entries(valueMap)) {
    const u = remaining[k] || 0;
    if (u <= 0) continue;
    const v = info.v, run = info.r, short = shortSet(info.cs);
    if (!par[info.cs]) par[info.cs] = { cardset: info.cs, run, uncl: 0, valSum: 0 };
    par[info.cs].uncl += u; par[info.cs].valSum += v * u;

    // specials for this card (only worth breaking out above SPECIAL_MIN)
    const specials = [];
    if (v >= SPECIAL_MIN) {
      const addS = (sn, lbl, mult) => { if (sn >= 1 && sn <= run && !specials.some(x => x.sn === sn)) specials.push({ sn, lbl, p: Math.round(v * mult) }); };
      addS(1, "#1", FIRST_MULT);
      addS(run, "#" + run + " (last)", LAST_MULT);
      const jn = JERSEY[info.a];
      if (jn != null) addS(jn, "#" + jn + " (jersey)", JERSEY_MULT);
    }
    for (const sp of specials) hits.push({ c: info.a, s: short, r: run, sn: sp.sn, lbl: sp.lbl, u: 1, p: sp.p, kind: "special", st: "in packs" });
    const uNormal = u - specials.length;
    if (uNormal > 0 && v >= CHASE_MIN) hits.push({ c: info.a, s: short, r: run, lbl: "normal", u: uNormal, p: v, kind: "normal" });
  }
  const g = par[GIRAFFE] || { uncl: 0, valSum: 0, run: 20 };
  const e = par[ELEPHANT] || { uncl: 0, valSum: 0, run: 20 };
  const gAvg = g.uncl ? g.valSum / g.uncl : 0;
  const eAvg = e.uncl ? e.valSum / e.uncl : 0;
  const book = +(gAvg + eAvg).toFixed(2);
  const poolRemaining = g.uncl + e.uncl;
  const packsRemaining = Math.floor(poolRemaining / 2);   // 2 cards per pack

  const hit_breakdown = [
    { cardset: "Choice Prizms Giraffe", run: 20, uncl: g.uncl, avg_value: +gAvg.toFixed(2) },
    { cardset: "Choice Prizms Elephant", run: 20, uncl: e.uncl, avg_value: +eAvg.toFixed(2) },
  ];
  // largest -> smallest; specials outrank the normal row of the same card
  hits.sort((a, b) => b.p - a.p || (a.kind === b.kind ? a.c.localeCompare(b.c) : a.kind === "special" ? -1 : 1));

  return {
    type: "pack_analytics",
    product: "2026 Panini NFT Prizm World Cup - Animal Print Edition",
    updated: new Date().toISOString().slice(0, 10),
    data_note: "Craft pack (600 total, 2 cards each): 1 Giraffe /20 + 1 Elephant /20 from a 30-player checklist. Seeded off our main World Cup pricing at the /20 craft tier; reprices off realized on-chain Animal Print sales once the pack trades on secondary.",
    pricing_mechanism: "seed = player /20 craft value (main-set floral-tier anchor); then chain-live Animal Print sales (recency-weighted)",
    valuation_principle: "Modeled until the animal-print cards trade; a real mid-serial sale then moves value either way.",
    structure: { cards_per_pack: 2, base_slots: 0, hit_slots: 2, total_packs: 600, packs_remaining: packsRemaining, note: "Each pack = 1 Giraffe /20 + 1 Elephant /20, random player from the 30-card checklist." },
    pack_ev: {
      method: "avg Giraffe /20 value + avg Elephant /20 value (1 of each per pack)",
      cards_per_pack: 2, base_slots: 0, hit_slots: 2, multiplier: MULT, mint: null,
      base_card_ev: 0, base_slots_ev: 0, hit_card_ev: +(book / 2).toFixed(2), pack_book_ev: book,
      predicted_price: +(book * MULT).toFixed(2), base_pool_remaining: 0, hit_pool_remaining: poolRemaining,
      base_breakdown: [], hit_breakdown,
    },
    cards_remaining: hits,
  };
}

function shortSet(cs) {
  return cs.replace("Base Choice Prizms ", "").trim();  // "Giraffe" / "Elephant"
}
