// ============================================================
// Panini Blockchain (Hyperledger Sawtooth) transaction decoder.
// Family: panini-cx-crypto v1.0. Every transaction's `payload` is base64-encoded
// JSON like:
//   { action, date(ms), price, product_sku_id, from_customer_pub_key, to_customer_pub_key }
//
// This turns a raw Sawtooth transaction (or a whole block) into normalized events
// the pricing pipeline can use. Pure functions -- no network here; the poller
// feeds blocks in.
// ============================================================

export function decodePayload(b64) {
  return JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
}

// SKU forms seen:
//   chain:   packcard-1940_377840_9774508_1__42_49   (<base>__<serial>_<run>)
//   tracker: packcard-850178_103_12_6_25             (<base>_<serial>_<run>)
// The <base> matches the PSKU in the Panini collection reports -> card metadata.
export function parseSku(sku) {
  if (!sku) return { base: null, serial: null, run: null };
  let m = sku.match(/^(.*)__(\d+)_(\d+)$/);          // double-underscore (chain)
  if (!m) m = sku.match(/^(.*)_(\d+)_(\d+)$/);         // single-underscore (tracker)
  if (m) return { base: m[1], serial: +m[2], run: +m[3] };
  return { base: sku, serial: null, run: null };
}

// One Sawtooth transaction -> one normalized event (or null if not our family).
export function txToEvent(tx) {
  const h = tx.header || {};
  if (h.family_name !== "panini-cx-crypto") return null;
  const p = decodePayload(tx.payload);
  const { base, serial, run } = parseSku(p.product_sku_id);
  return {
    tx_id: tx.header_signature,
    action: p.action || null,
    price: (p.price ?? null),
    sku_base: base,
    serial, run,
    from_key: p.from_customer_pub_key || null,
    to_key: p.to_customer_pub_key || null,
    ts: p.date ? new Date(p.date).toISOString() : null,
    // a real, priced peer-to-peer sale (vs mint / gift / $0 transfer)
    is_sale: p.action === "transfer_product" && Number(p.price) > 0,
    raw: p,
  };
}

// A whole /blocks response block -> all events inside it (batches -> transactions).
export function blockEvents(block) {
  const out = [];
  const blockNum = block.header ? Number(block.header.block_num) : null;
  for (const batch of block.batches || []) {
    for (const tx of batch.transactions || []) {
      const ev = txToEvent(tx);
      if (ev) { ev.block_num = blockNum; out.push(ev); }
    }
  }
  return out;
}

// Pack PULLS in a block. A pack-open is atomic: a `burn_product` (the pack) plus
// the pack's cards $0-transferred to the opener, in the same block. So a $0 card
// transfer IN A BLOCK THAT CONTAINS A BURN is a real rip -- which cleanly excludes
// the consolidations/gifts/mints that also use $0 transfers in non-burn blocks.
// We gate on the CARD prefix (`packcard-`) rather than a run cap: the pack token
// itself is a `burn_product` (already excluded by action), and older products like
// 2021 NFL Prizm have base cards numbered into the 1000s-6000s -- a run cap silently
// dropped those legit base/rookie pulls, so their counts never moved.
export function blockPulls(block) {
  const evs = blockEvents(block);
  if (!evs.some(e => e.action === "burn_product")) return [];
  return evs.filter(e =>
    e.action === "transfer_product" && Number(e.price) === 0 &&
    e.sku_base && e.sku_base.startsWith("packcard-") && e.serial != null && e.run != null
  );
}
