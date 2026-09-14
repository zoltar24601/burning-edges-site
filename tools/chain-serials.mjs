// ============================================================
// Deduce pack state from the chain, serial by serial. Every serial that has
// LEFT a pack shows up as a transfer_product event with its serial (a $0 vault
// pull or a priced sale), so:
//   out(card)      = distinct serials seen in a transfer_product
//   in-packs(card) = {1..run} MINUS out
//   remaining      = run - |out|
// The poller now reads every block, so as serials get unpacked their transfers
// land here and this updates on its own -- no hand-tracking, no report re-syncs.
//
// getRows(path) fetches a Supabase REST path and returns the parsed array.
// ============================================================

// { sku_base: Set(out serials) } -- cheap (only serials that actually moved).
export async function outSerialsBySku(getRows, skus) {
  const out = {};
  for (let i = 0; i < skus.length; i += 25) {
    const inlist = encodeURIComponent(skus.slice(i, i + 25).join(","));
    let rows = [];
    try { rows = await getRows(`chain_events?sku_base=in.(${inlist})&action=eq.transfer_product&serial=not.is.null&select=sku_base,serial`); } catch (e) { rows = []; }
    for (const e of (Array.isArray(rows) ? rows : [])) {
      (out[e.sku_base] = out[e.sku_base] || new Set()).add(Number(e.serial));
    }
  }
  return out;
}

// { sku_base: remaining COUNT } = run - |out|. For big-run packs (NFL /6000,
// Silhouette) where building the full serial list is wasteful.
export async function remainingCountBySku(getRows, skus, runBySku) {
  const out = await outSerialsBySku(getRows, skus);
  const rem = {};
  for (const sku of skus) {
    const run = Number(runBySku[sku]);
    if (!run) continue;
    rem[sku] = Math.max(0, run - (out[sku] ? out[sku].size : 0));
  }
  return rem;
}

// Safe remaining for OLDER packs (traded through past poller outages, so their
// historical transfers may be incomplete on-chain): the LOWER of the chain
// deduction and the current card_remaining -- a serial counts as OUT if EITHER
// the poller decremented it or the chain shows it transferred. New activity
// still tightens it since the poller now reads every block.
export async function reconciledRemaining(getRows, skus, runBySku, cardRemaining = {}) {
  const chain = await remainingCountBySku(getRows, skus, runBySku);
  const rem = {};
  for (const sku of skus) {
    const c = chain[sku], cr = cardRemaining[sku];
    if (c == null && cr == null) continue;
    rem[sku] = Math.min(c == null ? Infinity : c, cr == null ? Infinity : cr);
  }
  return rem;
}

// Prefix/filter path for packs with their OWN SKU prefix (NFL packcard-1584,
// Silhouette 2217/2305) -- ONE paginated query instead of a per-card in-list, so
// it scales to thousands of cards. `getAll(query)` pages a chain_events query.
export async function outSerialsByFilter(getAll, filter) {
  let rows = [];
  try { rows = await getAll(`chain_events?${filter}&action=eq.transfer_product&serial=not.is.null&select=sku_base,serial`); } catch (e) { rows = []; }
  const out = {};
  for (const e of (Array.isArray(rows) ? rows : [])) (out[e.sku_base] = out[e.sku_base] || new Set()).add(Number(e.serial));
  return out;
}
export async function reconciledRemainingByFilter(getAll, filter, runBySku, cardRemaining = {}) {
  const out = await outSerialsByFilter(getAll, filter);
  const rem = {};
  for (const sku of Object.keys(runBySku)) {
    const run = Number(runBySku[sku]); if (!run) continue;
    const chainRem = Math.max(0, run - (out[sku] ? out[sku].size : 0));
    const cr = cardRemaining[sku];
    rem[sku] = Math.min(chainRem, cr == null ? Infinity : cr);
  }
  return rem;
}

// { sku_base: [sorted in-packs serials] }. For small-run packs (Floral, Animal
// Print) that show exact surviving serials + #1/#last/#jersey hit status.
export async function inPacksBySku(getRows, skus, runBySku) {
  const out = await outSerialsBySku(getRows, skus);
  const inPacks = {};
  for (const sku of skus) {
    const run = Number(runBySku[sku]);
    if (!run) continue;
    const o = out[sku] || new Set();
    const arr = [];
    for (let sn = 1; sn <= run; sn++) if (!o.has(sn)) arr.push(sn);
    inPacks[sku] = arr;
  }
  return inPacks;
}
