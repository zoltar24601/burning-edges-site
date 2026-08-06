// ============================================================
// Recompute the Silhouette payload from LIVE remaining counts (card_remaining,
// which the chain poller keeps current) + the frozen per-card value map. Prices
// stay put (owner model, Flagg 1/1 = $40k); only the counts move as packs open.
// Shared by the scheduled refresh function and any local run.
// ============================================================
export function recomputeSilhouette(remaining, valueMap, template) {
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
  const baseCard = baseDen ? +(baseNum / baseDen).toFixed(2) : 0;
  const hitCard = hitDen ? +(hitNum / hitDen).toFixed(2) : 0;
  const packEV = +(3 * baseCard + hitCard).toFixed(2);
  hits.sort((a, b) => b.p - a.p || b.u - a.u);

  const out = JSON.parse(JSON.stringify(template));
  out.updated = new Date().toISOString().slice(0, 10);
  out.data_note = "Remaining counts are LIVE from the Panini blockchain (auto-decremented as packs are opened). Prices from the owner model; Cooper Flagg 1/1 held at $40,000.";
  Object.assign(out.pack_ev, {
    base_card_ev: baseCard, base_slots_ev: +(3 * baseCard).toFixed(2),
    hit_card_ev: hitCard, pack_book_ev: packEV, predicted_price: +(packEV * 2.5).toFixed(2),
    base_pool_remaining: baseDen, hit_pool_remaining: hitDen,
    base_breakdown: fin(bd), hit_breakdown: fin(hd),
  });
  out.cards_remaining = hits;
  return out;
}
