// ============================================================
// Change log for the live packs (stickers, 2022 Prizm WC, 2022 Mosaic).
// Turns "last hourly run vs this run" into rows for the public price_changes feed
// (/changes + the on-page "Recent price changes" lists), each with the WHY.
//
// Pure functions, no I/O: tools/live-pack.mjs does the reading/writing and treats this
// whole step as best-effort, so a bug here can never block a price refresh.
//
// prev / next = snapshots. The sticker model returns next as payload._cl:
//   { v, book, avgSilver, nonU, vals{key->value}, eff{key->copy-equivalents},
//     offers{key->[offer,floor]}, ovr{key->override}, ladder, rules, scrub, notes[] }
// (key = "Athlete|Parallel"). The 2022 packs only have { book }, so they get the
// pack-level row. The first run (prev = null) just records the baseline.
//
// Rows:
//   - one per NEW entry in the data file's `changelog` ([{id, note, scope}]): the human
//     "why" for a manual push (an override, a data refresh, a rule change)
//   - one per card whose value moved >= CARD_MIN_ABS and >= CARD_MIN_PCT (always when
//     an override changed), biggest copy-weighted moves first, capped at MAX_CARD_ROWS
//   - one pack row when the book moved >= max(0.02, 0.5% of the book), with the
//     breakdown: top card moves, Silver average, and what is left (pulls, special serials)
// ============================================================
const RUNS = { Silver: 501, Blue: 269, Red: 49, Gold: 10, Green: 5, Black: 1 };
const PAR = ["Silver", "Blue", "Red", "Gold", "Green", "Black"];
export const CARD_MIN_ABS = 20, CARD_MIN_PCT = 0.10, MAX_CARD_ROWS = 12;

const $ = n => "$" + (Math.abs(n) >= 100 ? Math.round(Math.abs(n)).toLocaleString("en-US") : Math.abs(Number(n)).toFixed(2));
const sgn = n => (n < 0 ? "-" : "+") + $(n);
const ser = s => (s.run > 1 && s.serial != null ? ` (#${s.serial}/${s.run})` : "");
const isNum = x => typeof x === "number" && Number.isFinite(x);

export function buildChangeRows({ product, prev, next, fresh = [], pulls = 0 }) {
  const n = next || {};
  const noteList = Array.isArray(n.notes) ? n.notes : [];
  const seenNotes = new Set((prev && prev.noteIds) || []);
  const snapshot = { ...n, noteIds: [...new Set([...seenNotes, ...noteList.map(x => x.id).filter(Boolean)])] };
  delete snapshot.notes;
  // first run (or an incompatible old snapshot): just record the baseline
  if (!prev || !isNum(prev.book) || !isNum(n.book)) return { rows: [], snapshot };

  const pv = prev.vals || {}, nv = n.vals || {};
  const hasCards = Object.keys(nv).length > 0;
  const display = [];

  // 1) pack row (shown first): the book moved enough to matter
  const dBook = n.book - prev.book;
  const bookMin = Math.max(0.02, 0.005 * prev.book);
  const newNotes = noteList.filter(x => x && x.id && x.note && !seenNotes.has(x.id));
  const moves = [];
  if (hasCards) {
    for (const k of Object.keys(nv)) {
      const o = pv[k], v = nv[k];
      if (!isNum(o) || !isNum(v) || o === v) continue;
      if (!((n.eff && n.eff[k]) > 0)) continue;   // none left in packs: moves nothing
      const ovrChanged = (prev.ovr || {})[k] !== (n.ovr || {})[k];
      const d = v - o;
      if (!ovrChanged && !(Math.abs(d) >= CARD_MIN_ABS && Math.abs(d) / Math.max(o, 1) >= CARD_MIN_PCT)) continue;
      moves.push({ k, o, v, d, impact: Math.abs(d) * n.eff[k] });
    }
    moves.sort((a, b) => b.impact - a.impact);
  }
  const shown = moves.slice(0, MAX_CARD_ROWS);

  if (Math.abs(dBook) >= bookMin) {
    const parts = [];
    if (hasCards && n.nonU > 0) {
      // effect of each card's new value on the book = 2 hit slots x delta x copy-equivalents / non-Silver copies
      const effects = [];
      let explained = 0;
      for (const k of Object.keys(nv)) {
        const o = pv[k], v = nv[k];
        if (!isNum(o) || !isNum(v) || o === v || k.split("|")[1] === "Silver") continue;
        const e = 2 * (v - o) * ((n.eff && n.eff[k]) || 0) / n.nonU;
        if (e) { effects.push([k, e]); explained += e; }
      }
      effects.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
      const top = effects.filter(([, e]) => Math.abs(e) >= 0.005).slice(0, 3).map(([k, e]) => `${k.replace("|", " ")} ${sgn(e)}`);
      if (top.length) parts.push("card values: " + top.join(", "));
      if (isNum(n.avgSilver) && isNum(prev.avgSilver)) {
        const sv = 3 * (n.avgSilver - prev.avgSilver);
        if (Math.abs(sv) >= 0.005) parts.push(`Silver average ${$(prev.avgSilver)} -> ${$(n.avgSilver)} (${sgn(sv)})`);
        explained += sv;
      }
      const rest = dBook - explained;
      if (Math.abs(rest) >= 0.01) parts.push(`copies left and special serials ${sgn(rest)}` + (pulls ? ` (${pulls} cards pulled)` : ""));
    } else {
      if (fresh.length) {
        const top = Math.max(...fresh.map(s => Number(s.price) || 0));
        parts.push(`${fresh.length} new chain sale${fresh.length === 1 ? "" : "s"} (highest ${$(top)})`);
      }
      if (pulls) parts.push(`${pulls} cards pulled from packs`);
    }
    if (newNotes.length) parts.push("data update, see below");
    if (moves.length > shown.length) parts.push(`+${moves.length - shown.length} smaller card moves`);
    if (!parts.length) parts.push("pack mix shifted");
    display.push({ product, scope: "Pack book value", headline: `Book ${dBook > 0 ? "up" : "down"} ${sgn(dBook)}: ${parts.join("; ")}`,
      detail: `${$(prev.book)} -> ${$(n.book)} (2x: ${$(2 * prev.book)} -> ${$(2 * n.book)})`, old_value: prev.book, new_value: n.book });
  }

  // 2) manual pushes: the human "why", once per note id
  for (const x of newNotes) {
    display.push({ product, scope: x.scope || "Data update", headline: "Data update: " + x.note,
      detail: `${$(prev.book)} -> ${$(n.book)}`, old_value: prev.book, new_value: n.book });
  }

  // 3) card moves, biggest first
  const why = m => {
    const [a, p] = m.k.split("|");
    const po = (prev.ovr || {})[m.k], no = (n.ovr || {})[m.k];
    if (po !== no) return no != null ? `override set to ${$(no)}` : "override removed";
    const mine = fresh.filter(s => s.a === a && s.p === p && (s.run === 1 || !s.tags)).sort((x, y) => String(y.date || "").localeCompare(String(x.date || "")));
    if (mine.length) return mine.length === 1 ? `new sale ${$(mine[0].price)}${ser(mine[0])}` : `${mine.length} new sales, latest ${$(mine[0].price)}${ser(mine[0])}`;
    const of = (prev.offers || {})[m.k], nf = (n.offers || {})[m.k];
    if (of && nf && (of[0] !== nf[0] || of[1] !== nf[1])) return `market data refreshed (offer ${$(of[0])} -> ${$(nf[0])}, floor ${$(of[1])} -> ${$(nf[1])})`;
    if (prev.rules !== n.rules || prev.scrub !== n.scrub) return "pricing rules changed";
    if (n.ladder) {
      for (let j = 0; j < PAR.indexOf(p); j++) {
        const k2 = a + "|" + PAR[j];
        if (isNum(pv[k2]) && isNum(nv[k2]) && pv[k2] !== nv[k2] && nv[k2] === m.v) return `follows ${PAR[j]} (a rarer card never prices below a commoner one)`;
      }
    }
    return "24h sales window moved on (older sales dropped out)";
  };
  for (const m of shown) {
    const [a, p] = m.k.split("|");
    display.push({ product, scope: `${a} ${p} /${RUNS[p] || "?"}`, headline: `${a} ${p} repriced: ${why(m)}`,
      detail: `${$(m.o)} -> ${$(m.v)}`, old_value: m.o, new_value: m.v });
  }

  // insert in reverse display order: ties on created_at are listed newest id first
  return { rows: display.reverse(), snapshot };
}
