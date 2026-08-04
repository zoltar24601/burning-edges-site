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
export const PARALLEL_FLOORS = {
  "Kaboom Green": 20000,          // keep at 20k unless a real sale says otherwise
  "Base Black": 2300,             // 1/1 chases hold ~2.3k until one actually sells
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

// The ordinary (typical copy) value of a card: a real sale if it has traded,
// else the manual reference, else a scarcity default. Offer does NOT lift the
// ordinary -- an offer prices only the one best serial (see chaseValue).
export function ordinaryValue(c) {
  const ref = PARALLEL_FLOORS[c.cardset] || 0;
  return hasRealSale(c) ? saleSignal(c) : (ref || defaultByRun(c.print_run || c.total_mints || 49));
}

// The best-serial value: highest of standing offer, top sale, ordinary, reference.
export function chaseValue(c) {
  const ref = PARALLEL_FLOORS[c.cardset] || 0;
  return Math.max(c.best_offer || 0, c.top_sale || 0, ordinaryValue(c), ref);
}

// Value the whole remaining stack of a card = { copies, valueSum, avg }.
// The single best_offer / top_sale belongs to the ONE best remaining serial, so
// on multi-serial cards it prices just that one copy; the rest go at the ordinary
// value. On /1 cards the reference/offer/sale prices the single copy. This is what
// the pipeline sums across all cards to get pack EV.
export function stackValue(c) {
  const u = c.unopened_pack_count || 0;
  if (u <= 0) return { copies: 0, valueSum: 0, avg: 0 };
  const run = c.print_run || c.total_mints || 49;
  const ref = PARALLEL_FLOORS[c.cardset] || 0;
  const offer = c.best_offer || 0, top = c.top_sale || 0;
  let valueSum;
  if (run <= 1) {
    valueSum = cardValue(c) * u;
  } else {
    const ordinary = hasRealSale(c) ? saleSignal(c) : (ref || defaultByRun(run));
    const chase = Math.max(offer, top, ordinary, ref);     // one best serial
    valueSum = chase + ordinary * (u - 1);
  }
  return { copies: u, valueSum, avg: valueSum / u };
}
