// ============================================================
// Recompute the Floral Edition payload from remaining counts + the (repriced)
// value map. Same unified payload shape as the other packs, but the Floral pack
// is 2 cards drawn from ONE pool of 3 floral parallels (no base/hit split):
//   pack_book_ev = 2 x pool-weighted avg card value.
// Emits base_slots:0 / hit_slots:2, hit_breakdown = the 3 parallels, empty base.
// valueMap[key] = { v, cs, a, r }  ;  remaining[key] = copies left in the pool.
// ============================================================
const MULT = 2.5;

export function recomputeFloral(remaining, valueMap) {
  const par = {}; let num = 0, den = 0, hits = [];
  for (const [k, info] of Object.entries(valueMap)) {
    const u = remaining[k] || 0;
    if (u <= 0) continue;
    const v = info.v;
    if (!par[info.cs]) par[info.cs] = { cardset: info.cs, run: info.r, uncl: 0, valSum: 0 };
    par[info.cs].uncl += u; par[info.cs].valSum += v * u;
    num += v * u; den += u;
    if (v >= 100) hits.push({ c: info.a, s: info.cs, r: info.r, u, p: v });
  }
  const hit_breakdown = Object.values(par)
    .map(x => ({ cardset: x.cardset, run: x.run, uncl: x.uncl, avg_value: +(x.valSum / x.uncl).toFixed(2) }))
    .sort((a, b) => b.avg_value - a.avg_value);
  const poolAvg = den ? num / den : 0;
  const book = +(2 * poolAvg).toFixed(2);
  hits.sort((a, b) => b.p - a.p || b.u - a.u);

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
