// ============================================================
// Recompute the 2022 Panini Prizm FIFA World Cup "block-point store" pack
// payload from LIVE remaining counts + the per-card value map
// (tools/prizmwc22-values.json). Chain prefix: packcard-1733.
//
// Pack = 3 cards (confirmed from the on-site pack-content panel):
//   Card 1 : Base  #/1399
//   Card 2 : Base  #/1399
//   Card 3 : one hit -- Parallel / Insert / Autograph, #/149 or less,
//            drawn from a pool of 62 cardsets.
//
// EV = 2 * avgBaseValue + 1 * avgHitValue, where each avg is a
// remaining-weighted average over its pool (every sealed copy valued at the
// normal price; named-serial grails surfaced separately as chase upside and,
// for the ones in SERIAL1, baked in once).
//
// This pack's pack_book_ev is the key input to the 2026 FIFA WC Sticker pack's
// block-point dividend, so the output exposes pack_book_ev + a full breakdown.
//
// valueMap shape (per sku_base): { v:Number, cs:cardset, a:athlete, r:run, slot:"base"|"hit" }
// Shared by the initial build + the hourly refresh function.
// ============================================================

// Named-serial premiums (e.g. Messi Base Gold #1/10). Surfaced as chase upside
// and baked into EV once -- ONE sealed copy is the grail, the rest stay normal.
// Seeded from real sales once the value map is populated.
export const SERIAL1 = {
  // "Lionel Messi|Base Gold": { serial: 1, price: 150000, note: "serial #1 -- GOAT premium" },
};

export function recomputePrizmWc22(remaining, valueMap, template) {
  const slotSum = { base: { n: 0, v: 0 }, hit: { n: 0, v: 0 } };
  const setAgg = {}; // cardset -> {cardset, slot, run, uncl, valSum}
  const chase = [];  // sealed cards worth showing

  for (const [sku, info] of Object.entries(valueMap)) {
    const u = remaining[sku] || 0;
    if (u <= 0) continue;
    const slot = info.slot === "base" ? "base" : "hit";
    slotSum[slot].n += u;
    slotSum[slot].v += info.v * u;
    const key = info.cs;
    if (!setAgg[key]) setAgg[key] = { cardset: info.cs, slot, run: info.r, uncl: 0, valSum: 0 };
    setAgg[key].uncl += u;
    setAgg[key].valSum += info.v * u;
    if (info.v >= 300) chase.push({ c: info.a, s: info.cs, r: info.r, u, p: info.v });
  }

  // Bake named-serial premiums into EV once (one grail copy sealed, rest normal).
  for (const [k, meta] of Object.entries(SERIAL1)) {
    const [athlete, cs] = k.split("|");
    let target = null;
    for (const [sku, info] of Object.entries(valueMap)) {
      if (info.a === athlete && info.cs === cs && (remaining[sku] || 0) > 0) { target = info; break; }
    }
    if (!target) continue;
    const delta = meta.price - target.v;
    if (delta <= 0) continue;
    const slot = target.slot === "base" ? "base" : "hit";
    slotSum[slot].v += delta;
    if (setAgg[target.cs]) setAgg[target.cs].valSum += delta;
  }

  const avg = s => (s.n ? +(s.v / s.n).toFixed(2) : 0);
  const baseEV = avg(slotSum.base);
  const hitEV = avg(slotSum.hit);
  const packEV = +(2 * baseEV + hitEV).toFixed(2);
  // Two base per pack -> packs are gated by the smaller of base/2 and hit pools.
  const packsRemaining = Math.min(Math.round(slotSum.base.n / 2), slotSum.hit.n || Infinity);

  const breakdown = Object.values(setAgg)
    .map(x => ({ cardset: x.cardset, slot: x.slot, run: x.run, uncl: x.uncl, avg_value: +(x.valSum / x.uncl).toFixed(2) }))
    .sort((a, b) => b.avg_value - a.avg_value);

  chase.sort((a, b) => b.p - a.p || b.u - a.u);

  const chaseSerials = [];
  for (const [k, meta] of Object.entries(SERIAL1)) {
    const [athlete, cs] = k.split("|");
    let run = 0, stillSealed = false;
    for (const [sku, info] of Object.entries(valueMap)) {
      if (info.a === athlete && info.cs === cs) { run = info.r; if ((remaining[sku] || 0) > 0) stillSealed = true; }
    }
    if (stillSealed) chaseSerials.push({ c: athlete, s: cs, serial: meta.serial, run, p: meta.price, note: meta.note });
  }

  const out = JSON.parse(JSON.stringify(template || {}));
  out.updated = new Date().toISOString().slice(0, 10);
  out.packs_remaining = isFinite(packsRemaining) ? packsRemaining : null;
  out.data_note = "2022 Prizm World Cup block-point store pack. 3 cards: 2 Base #/1399 + 1 hit (#/149 or less). Remaining counts from the collection report / chain; prices from the sales-anchored value model.";
  out.pack_ev = {
    base_card_ev: baseEV,
    hit_card_ev: hitEV,
    base_slots_ev: +(2 * baseEV).toFixed(2),
    pack_book_ev: packEV,
    predicted_price: +(packEV * 2.5).toFixed(2),
    base_pool_remaining: slotSum.base.n,
    hit_pool_remaining: slotSum.hit.n,
    breakdown,
  };
  out.cards_remaining = chase;
  out.chase_serials = chaseSerials;
  return out;
}
