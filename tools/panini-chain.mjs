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

// Pack PULLS in a block. A pack open sends the pack's cards $0 from the Panini
// PACK-VAULT wallet to the opener. The old "burn_product in the same block"
// heuristic under-counted every product (burns aren't reliably co-located, and
// Moonbirds never burns at all) -- so we key on the vault source directly, which
// is the universal, atomic pull signal.
//
// Moonbirds (+ Bad Eggs, untracked) additionally allow bridging cards TO Ethereum,
// which also flows $0 from the vault and would masquerade as opens -- so its prefix
// is carved out of auto-decrement until the bridge signature is pinned; its counts
// are kept accurate by re-seed instead.
const PACK_VAULT = new Set([
  "02882dfcdc4ab8076051922a738bd8914d19b4b4e053db6d860ce53e4ad8b91212",
]);
const BRIDGE_PREFIXES = new Set(["packcard-850178"]);   // Moonbirds -- ETH bridge confounds the vault flow
export function blockPulls(block) {
  return blockEvents(block).filter(e =>
    e.action === "transfer_product" && Number(e.price) === 0 &&
    e.from_key && PACK_VAULT.has(e.from_key) &&
    e.sku_base && e.sku_base.startsWith("packcard-") && e.serial != null && e.run != null &&
    !BRIDGE_PREFIXES.has(e.sku_base.split("_")[0])
  );
}
