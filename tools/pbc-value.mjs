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

export const PARALLEL_FLOORS = {
  "Kaboom Green": 20000,          // keep at 20k unless a sale/offer says higher
};

// Fallback when a card has NO sales AND no offer at all -- a minimum by scarcity
// so a /1 never collapses to a token value.
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

// Value ONE copy of a single-serial (/1) card. Offer floors it cleanly because
// the card IS the serial.
export function cardValue(c) {
  const sales = (c.recent_sales || []).map(s => s.txn_amount).filter(x => x > 0);
  const saleSignal = sales.length
    ? median(sales)
    : Math.max(c.recent_sale || 0, c.avg_sale || 0, c.top_sale || 0);
  const offer = c.best_offer || 0;                 // FLOOR, never discounted
  const floor = PARALLEL_FLOORS[c.cardset] || 0;   // manual chase floor
  const v = Math.max(saleSignal, offer, floor);
  return v > 0 ? v : defaultByRun(c.print_run || c.total_mints || 49);
}

// Value the whole remaining stack of a card = { copies, valueSum, avg }.
// The single best_offer / top_sale belongs to the ONE best remaining serial, so
// on multi-serial cards it prices just that one copy; the rest go at the ordinary
// (real-sale) value. On /1 cards the offer floors the single copy. This is what
// the pipeline sums across all cards to get pack EV.
export function stackValue(c) {
  const u = c.unopened_pack_count || 0;
  if (u <= 0) return { copies: 0, valueSum: 0, avg: 0 };
  const run = c.print_run || c.total_mints || 49;
  const floor = PARALLEL_FLOORS[c.cardset] || 0;
  const sales = (c.recent_sales || []).map(s => s.txn_amount).filter(x => x > 0);
  const saleSig = sales.length ? median(sales) : Math.max(c.recent_sale || 0, c.avg_sale || 0);
  const offer = c.best_offer || 0, top = c.top_sale || 0;
  let valueSum;
  if (run <= 1) {
    valueSum = (Math.max(saleSig, offer, floor) || defaultByRun(run)) * u;
  } else {
    const ordinary = Math.max(saleSig, floor) || defaultByRun(run);
    const chase = Math.max(offer, top, ordinary, floor);   // one best serial
    valueSum = chase + ordinary * (u - 1);
  }
  return { copies: u, valueSum, avg: valueSum / u };
}
