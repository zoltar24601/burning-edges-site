// ============================================================
// PBC card valuation rules (shared by the hourly pipeline + any recompute).
//
// CORE PRINCIPLE (per John, 2026-08-04): a best offer is a FLOOR, never a
// ceiling. Cards sell for MORE than the standing offer, not less. So we NEVER
// discount an offer -- we take the max of every available signal.
//
//   value = max( real-sale signal, best offer, manual parallel floor )
//
// Manual PARALLEL_FLOORS pin scarce chases that a thin/quiet market under-quotes
// (e.g. Kaboom Green stays $20,000 until a real comp indicates higher). Add/edit
// entries here as John directs; the pipeline applies them every run.
// ============================================================

// Manual REFERENCE values: what a parallel is worth when nothing has sold yet.
// These hold until a REAL sale moves them (an offer never marks them down). Edit
// as John directs.
// SOFT references: used only as a fallback when a card has no ordinary sale.
// A real ordinary sale overrides them.
export const PARALLEL_FLOORS = {
  "Kaboom Green": 20000,          // keep at 20k unless a real sale says otherwise
  "Base Black": 2300,             // 1/1 chases hold ~2.3k until one actually sells
  "Kaboom Gold": 3000,            // ordinary Kaboom Gold ~3k; the 6-7k sales were #1 serials
};

// HARD floors: a GLOBAL standing offer (a bid to buy ANY serial). Offers are
// floors -- cards sell for more, never less -- so this is a minimum applied on
// top of everything, even over lower ordinary sales.
export const PARALLEL_OFFER_FLOORS = {
  "Birbhalla": 2000,              // $2k global offer on any Birbhalla copy
};

// Fallback when a card has NO sales, NO offer, and NO reference -- a minimum by
// scarcity so a /1 never collapses to a token value.
function defaultByRun(run) {
  if (run <= 1) return 300;
  if (run <= 10) return 60;
  if (run <= 25) return 30;
  if (run <= 49) return 12;
  if (run <= 99) return 6;
  return 2;
}

export function median(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
}

// Has this card ACTUALLY traded? (not just carry a standing offer)
function hasRealSale(c) {
  const sales = (c.recent_sales || []).filter(s => s.txn_amount > 0);
  return sales.length > 0 || (c.top_sale > 0) || (c.recent_sale > 0) || (c.avg_sale > 0);
}
function saleSignal(c) {
  const sales = (c.recent_sales || []).map(s => s.txn_amount).filter(x => x > 0);
  return sales.length ? median(sales) : Math.max(c.recent_sale || 0, c.avg_sale || 0, c.top_sale || 0);
}

// Value ONE copy of a single-serial (/1) card. A real sale is the truth (floored
// by any standing offer); with no sale, the manual reference holds -- an offer
// alone never drops it below reference.
export function cardValue(c) {
  const offer = c.best_offer || 0;
  const ref = PARALLEL_FLOORS[c.cardset] || 0;
  if (hasRealSale(c)) return Math.max(saleSignal(c), offer);
  return Math.max(ref, offer) || defaultByRun(c.print_run || c.total_mints || 1);
}

// Split a card's real sales into #1/last-serial (PREMIUM) vs mid-serial (ORDINARY),
// using the exact serial (start_seq) the API gives on every sale.
function serialSales(c) {
  const run = c.print_run || c.total_mints || 0;
  const sales = (c.recent_sales || []).filter(s => s.txn_amount > 0);
  const isPrem = s => s.start_seq === 1 || (run > 1 && s.start_seq === run);
  return {
    prem: sales.filter(isPrem).map(s => s.txn_amount),
    mid:  sales.filter(s => !isPrem(s)).map(s => s.txn_amount),
    all:  sales.map(s => s.txn_amount),
  };
}

// The ORDINARY (typical sealed copy) value. On multi-serial cards this uses
// MID-serial sales only -- a #1 or last-serial sale (which is a premium, and by
// definition already SOLD so it isn't sealed anymore) never drags the ordinary up.
// No mid sale -> manual reference -> scarcity default. On /1 cards the sale IS the card.
export function ordinaryValue(c) {
  const run = c.print_run || c.total_mints || 49;
  const ref = PARALLEL_FLOORS[c.cardset] || 0;              // soft fallback
  const hard = PARALLEL_OFFER_FLOORS[c.cardset] || 0;       // global-offer hard floor
  const { mid, all } = serialSales(c);
  let v;
  if (run <= 1) v = all.length ? median(all) : (ref || defaultByRun(run));
  else v = mid.length ? median(mid) : (ref || defaultByRun(run));
  return Math.max(v, hard);
}

// The best-serial value -- for the tier board / serial lookup only (NOT the pull EV).
// Highest of standing offer, top sale, actual #1/last sales, ordinary, reference.
export function chaseValue(c) {
  const ref = PARALLEL_FLOORS[c.cardset] || 0;
  const { prem } = serialSales(c);
  return Math.max(c.best_offer || 0, c.top_sale || 0, ...prem, ordinaryValue(c), ref);
}

// Value the whole remaining stack = { copies, valueSum, avg }. Every SEALED copy is
// valued at the ordinary price -- we do NOT bake a premium serial into the pull EV,
// because the premium serials that set those big prices have generally already sold
// (they're not in the packs anymore). Premiums live on the board as reference.
export function stackValue(c) {
  const u = c.unopened_pack_count || 0;
  if (u <= 0) return { copies: 0, valueSum: 0, avg: 0 };
  const v = ordinaryValue(c);
  return { copies: u, valueSum: v * u, avg: v };
}
