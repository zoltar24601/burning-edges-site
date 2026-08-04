// ============================================================
// Build the Moonbirds page payload from the live Panini Blockchain Tracker API.
// Takes the raw /birbs JSON + the previous payload (as a structural template),
// returns { payload, changes }. Used by both the hourly scheduled function and
// the one-off cutover publish, so the logic lives in exactly one place.
// ============================================================
import { stackValue, ordinaryValue, chaseValue, median } from "./pbc-value.mjs";

const BASE_SILVER = "Base Silver";
const SCARCE_MAX_RUN = 25;   // /25 and rarer are "hits", plus the Birbhalla grail
const MULT = 2.5;            // borrowed predicted-price multiplier

export function buildMoonbirds(api, template) {
  const cards = (api.cards || []).filter(c => (c.unopened_pack_count || 0) > 0);

  // ---- per-parallel aggregates ----
  const par = {};
  for (const c of cards) {
    const p = c.cardset;
    const sv = stackValue(c);
    if (!par[p]) par[p] = { copies: 0, valueSum: 0, run: c.print_run || 49, ordinaries: [], chase: 0 };
    par[p].copies += sv.copies;
    par[p].valueSum += sv.valueSum;
    par[p].ordinaries.push(ordinaryValue(c));
    par[p].chase = Math.max(par[p].chase, chaseValue(c));
    if ((c.print_run || 0) > par[p].run) par[p].run = c.print_run;
  }
  for (const p in par) { par[p].ordinary = Math.round(median(par[p].ordinaries)); par[p].avg = par[p].valueSum / par[p].copies; }

  const slot2Rem = Object.entries(par).filter(([p]) => p !== BASE_SILVER).reduce((a, [, v]) => a + v.copies, 0);
  const silver = par[BASE_SILVER] || { copies: 0, valueSum: 0 };
  const slot1 = silver.copies ? silver.valueSum / silver.copies : (template.pack_ev.slot1_silver_avg || 0);

  const sb = {}; let slot2ev = 0;
  for (const [p, v] of Object.entries(par)) {
    if (p === BASE_SILVER) continue;
    const prob = v.copies / slot2Rem;
    sb[p] = { copies: v.copies, p: +prob.toFixed(4), avg_value: +v.avg.toFixed(2) };
    slot2ev += prob * v.avg;
  }
  const book = +(slot1 + slot2ev).toFixed(2);

  // ---- clone template, refresh dynamic fields ----
  const out = JSON.parse(JSON.stringify(template));
  out.updated = new Date().toISOString().slice(0, 10);
  out.data_note = "Auto-updated hourly from Panini Blockchain Tracker (live sales + standing offers). Offers are treated as floors, never discounted; a scarce-serial premium prices only the one best remaining serial.";
  Object.assign(out.pack_ev, {
    slot1_silver_avg: +slot1.toFixed(2),
    slot2_ev: +slot2ev.toFixed(2),
    pack_book_ev: book,
    predicted_price: +(book * MULT).toFixed(2),
    book_vs_mint: +(book / (out.pack_ev.mint || 50)).toFixed(2),
    slot2_remaining: slot2Rem,
    packs_remaining: Math.min(silver.copies || slot2Rem, slot2Rem),
    slot2_breakdown: sb,
  });

  for (const t of out.tier_rules) {
    const v = par[t.parallel]; if (!v) continue;
    t.market_anchored = true;
    if (t.flat_value != null) t.flat_value = Math.round(v.chase);
    else {
      t.floor_value = Math.round(v.ordinary);
      if (Array.isArray(t.serial_breakouts)) t.serial_breakouts = t.serial_breakouts.map(b => ({ ...b, value: Math.round(v.chase) }));
    }
  }
  for (const pc of out.priced_cards) {
    const v = par[pc.parallel]; if (!v) continue;
    pc.market_anchored = true;
    pc.floor_value = Math.round(v.ordinary);
    if (Array.isArray(pc.serial_breakouts)) pc.serial_breakouts = pc.serial_breakouts.map(b => ({ ...b, value: Math.round(v.chase) }));
  }

  const cr = [];
  for (const c of cards) {
    const run = c.print_run || c.total_mints || 49;
    if (run > SCARCE_MAX_RUN && c.cardset !== "Birbhalla") continue;
    cr.push({ c: c.athlete, s: c.cardset, r: run, u: c.unopened_pack_count, p: Math.round(ordinaryValue(c)) });
  }
  cr.sort((a, b) => b.p - a.p || b.u - a.u);
  out.cards_remaining = cr;

  out.chase_serials = (template.chase_serials || []).map(l => {
    const v = par[l.s]; if (!v) return l;
    return { s: l.s, r: l.r, s1: Math.round(v.chase), last: Math.round(v.chase) };
  });

  return { payload: out, changes: detectChanges(template, out) };
}

// Major-move detector for the public /changes feed. Routine drift stays out.
function detectChanges(prev, next) {
  const out = [];
  const pv = prev.pack_ev.pack_book_ev, nv = next.pack_ev.pack_book_ev;
  if (pv && Math.abs(nv - pv) >= 2)
    out.push({ scope: "Pack book value", old_value: pv, new_value: nv, headline: `Pack book ${nv > pv ? "up" : "down"} to $${nv.toFixed(2)}`, detail: `was $${pv.toFixed(2)}` });
  const pb = prev.pack_ev.slot2_breakdown || {}, nb = next.pack_ev.slot2_breakdown || {};
  for (const p in nb) {
    const o = pb[p] ? pb[p].avg_value : 0, n = nb[p].avg_value;
    if (o > 0 && Math.abs(n - o) / o >= 0.15)
      out.push({ scope: p, old_value: o, new_value: n, headline: `${p} ${n > o ? "up" : "down"} ${Math.round(Math.abs(n - o) / o * 100)}%`, detail: `$${Math.round(o).toLocaleString()} → $${Math.round(n).toLocaleString()}` });
  }
  return out;
}
