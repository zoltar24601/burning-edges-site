// ============================================================
// Recompute the Moonbirds payload from LIVE remaining counts (card_remaining,
// kept current by the chain poller) + the repriced per-card value map.
//
// Emits the SAME payload shape as Silhouette/NFL so the unified page renders it:
//   pack_ev.{base_card_ev, hit_card_ev, pack_book_ev, base_breakdown,
//            hit_breakdown, ...}  +  top-level cards_remaining [{c,s,r,u,p}].
//
// Moonbirds pack = 2 cards: 1 Base Silver (slot1) + 1 weighted parallel (slot2).
//   pack_book_ev = base_card_ev(Base Silver) + hit_card_ev(all other parallels).
// (slot2_ev in the old model == the remaining-weighted avg of every non-Silver
//  card == hit_card_ev here, so the number is identical, just unified shape.)
// ============================================================
const MULT = 2.5;   // borrowed predicted-price multiplier
const MINT = 50;

export function recomputeMoonbirds(remaining, valueMap) {
  const bd = {}, hd = {};
  let baseNum = 0, baseDen = 0, hitNum = 0, hitDen = 0, hits = [];
  for (const [sku, info] of Object.entries(valueMap)) {
    const u = remaining[sku] || 0;
    if (u <= 0) continue;
    const v = info.v;
    const g = info.base ? bd : hd;
    if (!g[info.cs]) g[info.cs] = { cardset: info.cs, run: info.r, uncl: 0, valSum: 0 };
    g[info.cs].uncl += u; g[info.cs].valSum += v * u;
    if (info.base) { baseNum += v * u; baseDen += u; }
    else { hitNum += v * u; hitDen += u; if (v >= 100) hits.push({ c: info.a, s: info.cs, r: info.r, u, p: v }); }
  }
  const fin = g => Object.values(g).map(x => ({ cardset: x.cardset, run: x.run, uncl: x.uncl, avg_value: +(x.valSum / x.uncl).toFixed(2) })).sort((a, b) => b.avg_value - a.avg_value);
  const baseCard = baseDen ? +(baseNum / baseDen).toFixed(2) : 0;   // Base Silver avg (slot1)
  const hitCard = hitDen ? +(hitNum / hitDen).toFixed(2) : 0;       // weighted avg of all slot2 parallels
  const packEV = +(baseCard + hitCard).toFixed(2);                  // 1 silver + 1 slot2
  hits.sort((a, b) => b.p - a.p || b.u - a.u);

  return {
    type: "pack_analytics",
    product: "2026 Panini NFT Moonbirds - Birbs Beyond",
    updated: new Date().toISOString().slice(0, 10),
    data_note: "Remaining counts and prices are LIVE from the Panini blockchain (our own indexer). Values reprice off realized on-chain sales; standing global offers act as floors.",
    pricing_mechanism: "chain-live sales (recency-weighted) + report-seeded remaining, auto-decremented per pack open",
    valuation_principle: "A real mid-serial sale is the truth and moves value either way; a standing global offer is a hard floor; #1/last-serial premiums are reference-only.",
    structure: {
      cards_per_pack: 2, base_slots: 1, hit_slots: 1,
      base_parallels: ["Base Silver"],
      note: "Each pack: 1 Base Silver + 1 parallel/insert (weighted by remaining supply).",
    },
    pack_ev: {
      method: "pull odds = LIVE remaining per-parallel counts; avg from repriced per-card values",
      cards_per_pack: 2, base_slots: 1, hit_slots: 1, multiplier: MULT, mint: MINT,
      base_card_ev: baseCard, base_slots_ev: baseCard,
      hit_card_ev: hitCard, pack_book_ev: packEV,
      predicted_price: +(packEV * MULT).toFixed(2),
      book_vs_mint: +(packEV / MINT).toFixed(2),
      base_pool_remaining: baseDen, hit_pool_remaining: hitDen,
      base_breakdown: fin(bd), hit_breakdown: fin(hd),
    },
    cards_remaining: hits,
  };
}
