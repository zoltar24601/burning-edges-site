// ============================================================
// Recompute the 2021 NFL Prizm pack payload from LIVE remaining counts
// (card_remaining, kept current by the chain poller on prefix packcard-1584)
// + the frozen per-card value map (tools/nflprizm-values.json).
//
// Pack = 5 cards: 3 Base + 1 Rookie Base + 1 (Parallel 5/6 or Insert 1/6).
// Prices are the frozen owner model (Brady Gold $50k / #1 $150k, Mahomes Gold
// $30k, Pat Tillman kept, Landon Collins farce dropped). Only the COUNTS move
// as packs are opened; dollar values stay put until we deliberately change them.
//
// Shared by the initial build + the hourly refresh function.
// ============================================================

// Serial-#1 (and other named-serial) premiums shown as chase upside. NOT baked
// into pack EV -- the EV values every sealed copy at the "normal" price; a #1 is
// a bonus only realized if that exact serial is the one still in a pack.
export const SERIAL1 = {
  "Tom Brady|Gold": { serial: 1, price: 150000, note: "serial #1 -- GOAT premium" },
};

const INSERT_ODDS = 1 / 6; // insert replaces the parallel 1 in 6 packs

export function recomputeNflPrizm(remaining, valueMap, template) {
  const slotSum = { base: { n: 0, v: 0 }, rookiebase: { n: 0, v: 0 }, parallel: { n: 0, v: 0 }, insert: { n: 0, v: 0 } };
  const setAgg = {}; // cardset -> {cardset, slot, run, uncl, valSum}
  const chase = [];  // sealed cards worth showing

  for (const [sku, info] of Object.entries(valueMap)) {
    const u = remaining[sku] || 0;
    if (u <= 0) continue;
    const slot = info.slot;
    slotSum[slot].n += u;
    slotSum[slot].v += info.v * u;
    const key = info.cs;
    if (!setAgg[key]) setAgg[key] = { cardset: info.cs, slot, run: info.r, uncl: 0, valSum: 0 };
    setAgg[key].uncl += u;
    setAgg[key].valSum += info.v * u;
    if (info.v >= 300) chase.push({ c: info.a, s: info.cs, r: info.r, u, p: info.v });
  }

  // Bake named-serial premiums into EV: ONE sealed copy is the grail (Brady Gold
  // #1 = $150k), the rest stay at the normal price. So the group is valued as
  // (u-1)*normal + 1*premium -- not u*normal. Only one #1 per card, only if sealed.
  for (const [k, meta] of Object.entries(SERIAL1)) {
    const [athlete, cs] = k.split("|");
    let target = null;
    for (const [sku, info] of Object.entries(valueMap)) {
      if (info.a === athlete && info.cs === cs && (remaining[sku] || 0) > 0) { target = info; break; }
    }
    if (!target) continue;
    const delta = meta.price - target.v;   // e.g. 150000 - 50000 = 100000, added once
    if (delta <= 0) continue;
    slotSum[target.slot].v += delta;
    if (setAgg[target.cs]) setAgg[target.cs].valSum += delta;
  }

  const avg = s => (s.n ? +(s.v / s.n).toFixed(2) : 0);
  const baseEV = avg(slotSum.base), rookEV = avg(slotSum.rookiebase);
  const parEV = avg(slotSum.parallel), insEV = avg(slotSum.insert);
  const slot5EV = +((1 - INSERT_ODDS) * parEV + INSERT_ODDS * insEV).toFixed(2);
  const packEV = +(3 * baseEV + rookEV + slot5EV).toFixed(2);
  const packsRemaining = Math.round(slotSum.base.n / 3);

  const breakdown = Object.values(setAgg)
    .map(x => ({ cardset: x.cardset, slot: x.slot, run: x.run, uncl: x.uncl, avg_value: +(x.valSum / x.uncl).toFixed(2) }))
    .sort((a, b) => b.avg_value - a.avg_value);

  chase.sort((a, b) => b.p - a.p || b.u - a.u);

  // named-serial chase overlay -- only surface if that card is still sealed
  const chaseSerials = [];
  for (const [k, meta] of Object.entries(SERIAL1)) {
    const [athlete, cs] = k.split("|");
    let run = 0, stillSealed = false;
    for (const [sku, info] of Object.entries(valueMap)) {
      if (info.a === athlete && info.cs === cs) { run = info.r; if ((remaining[sku] || 0) > 0) stillSealed = true; }
    }
    if (stillSealed) chaseSerials.push({ c: athlete, s: cs, serial: meta.serial, run, p: meta.price, note: meta.note });
  }

  const out = JSON.parse(JSON.stringify(template));
  out.updated = new Date().toISOString().slice(0, 10);
  out.packs_remaining = packsRemaining;
  out.data_note = "Remaining counts are LIVE from the Panini blockchain (auto-decremented as packs are opened). Prices from the owner model; Tom Brady Gold #1/10 held at $150,000.";
  out.pack_ev = {
    base_card_ev: baseEV, rookie_card_ev: rookEV,
    parallel_card_ev: parEV, insert_card_ev: insEV, slot5_ev: slot5EV,
    base_slots_ev: +(3 * baseEV).toFixed(2),
    pack_book_ev: packEV, predicted_price: +(packEV * 2.5).toFixed(2),
    base_pool_remaining: slotSum.base.n, rookie_pool_remaining: slotSum.rookiebase.n,
    parallel_pool_remaining: slotSum.parallel.n, insert_pool_remaining: slotSum.insert.n,
    breakdown,
  };
  out.cards_remaining = chase;
  out.chase_serials = chaseSerials;
  return out;
}
