// ============================================================
// 2026 Prizm FIFA WC Stickers -- the pack value model (single source of truth).
// Used by netlify/functions/stickers-refresh.mjs (hourly, live sales) and by
// tools/stickers-build.mjs (baked fallback inside stickers.html).
//
// Priced on what is STILL IN PACKS. ck = data/stickers26-checklist.json: per
// notable card copies left (u), best offer, floor, sealed special serials; every
// other card rolled up per parallel. sales = [{a, p, serial, run, price, date
// (UTC "YYYY-MM-DDTHH:MM:SS"), tags}].
// Card value (normal serial): override > silver_burn rule (Silvers) > median of
// the last 24h of normal sales if >= 3, else last 5 > no sales: offer/floor
// midpoint (offer capped at floor) > never below scrub. Ladder: a rarer parallel
// of a player is never below a commoner one. Each sealed special serial is
// valued on its own (specialMult).
// ============================================================
const PAR = ["Silver", "Blue", "Red", "Gold", "Green", "Black"];
const RUNS = { Silver: 501, Blue: 269, Red: 49, Gold: 10, Green: 5, Black: 1 };
const SPECIAL = ["number 1", "perfect mint", "jersey mint"];
const isSpecial = x => SPECIAL.some(t => (x.tags || "").includes(t));
const median = ps => { const s = [...ps].sort((a, b) => a - b); return s[s.length >> 1]; };
const money = n => "$" + (n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2));
const g = n => String(Number(n));
const key = (a, p) => a + "|" + p;

function specialMult(tags, run) {
  if (run === 1) return 1;
  const hi = run >= 49;
  const m = { "number 1": hi ? 5 : 3, "perfect mint": hi ? 5 : 2, "jersey mint": hi ? 8 : 2 };
  return Math.max(1, ...SPECIAL.filter(t => tags.includes(t)).map(t => m[t]));
}

export function stickersModel(ck, sales, windowFrom = "2026-10-26", pricedAt = null) {
  const scrub = ck.scrub, RULES = ck.rules || {}, SB = RULES.silver_burn;
  const OVR = new Map(Object.entries(ck.overrides).map(([k, v]) => [k, v]));
  const recent = new Map();
  for (const x of [...sales].sort((a, b) => b.date.localeCompare(a.date))) {
    if (x.date < windowFrom) continue;
    const k = key(x.a, x.p);
    if (!recent.has(k)) recent.set(k, []);
    recent.get(k).push(x);
  }
  const last = sales.filter(x => x.date.includes("T")).map(x => x.date.slice(0, 19)).sort().at(-1);
  const cut24 = new Date(Date.parse(last + "Z") - 24 * 3600e3).toISOString().slice(0, 19);

  const sinceMedian = k => {
    const ps = (recent.get(k) || []).filter(x => x.date >= SB.since && !isSpecial(x)).map(x => x.price);
    return ps.length ? median(ps) : 0;
  };

  function cardValue(c) {
    const k = key(c.a, c.p);
    if (OVR.has(k)) return OVR.get(k);
    if (SB && c.p === "Silver") {
      if (!SB.stars.includes(c.a)) return SB.uncapped[c.a] != null ? 0 : sinceMedian(k);
      if (sinceMedian(k)) return sinceMedian(k);   // stars: post-burn sales first
    }
    if ((RULES.zero || []).includes(c.p)) return 0;
    let norm = (recent.get(k) || []).filter(x => c.run === 1 || !isSpecial(x));
    if (RULES.window24) {
      const day = norm.filter(x => x.date >= cut24).map(x => x.price);
      norm = day.length >= 3 ? day : norm.slice(0, 5).map(x => x.price);
    } else norm = norm.slice(0, 3).map(x => x.price);
    let v;
    if (norm.length) v = median(norm);
    else {
      v = c.offer || 0;
      if (RULES.mid && v && c.floor > v) v = (v + c.floor) / 2;   // no sales: bid/ask midpoint
      else if (c.floor && v > c.floor) v = c.floor;               // a bid above the floor is for one serial
    }
    return Math.max(v, scrub[c.p]);
  }

  const VAL = new Map(ck.cards.map(c => [key(c.a, c.p), cardValue(c)]));
  if (RULES.ladder) {
    for (const a of new Set(ck.cards.map(c => c.a))) {
      let best = 0;
      for (const p of PAR) {
        const k = key(a, p);
        if (!VAL.has(k)) continue;
        if (VAL.get(k) < best && !OVR.has(k)) VAL.set(k, best);
        best = Math.max(best, VAL.get(k));
      }
    }
  }

  const tot = Object.fromEntries(PAR.map(p => [p, [0, 0]]));
  const hits = [];
  const lab = (t, run) => ({ "number 1": "#1", "perfect mint": `#${run} (last)`, "jersey mint": "jersey #" })[t];
  for (const c of ck.cards) {
    const v = VAL.get(key(c.a, c.p)), sp = c.spec;
    tot[c.p][0] += c.u;
    tot[c.p][1] += (c.u - sp.length) * v + sp.reduce((s, t) => s + v * specialMult(t, c.run), 0);
    if (c.u && v >= 50) {
      const left = c.run > 1 ? sp.map(t => t.split(",").map(x => lab(x, c.run)).join(" / ")) : [];
      hits.push({ c: c.a, s: c.p + (left.length ? " &middot; still sealed: " + left.join(", ") : ""), r: c.run, u: c.u, p: v });
    }
  }
  const NOTABLE = new Set(ck.cards.map(c => key(c.a, c.p)));
  const restVal = {};
  for (const [p, r] of Object.entries(ck.rest)) {
    // un-listed Silvers under silver_burn: average over all r.cards of each fully
    // burned card's post-cutoff median (unsold = $0); other parallels at scrub
    restVal[p] = SB && p === "Silver"
      ? [...recent.keys()].filter(k => k.endsWith("|Silver") && !NOTABLE.has(k) && SB.uncapped[k.split("|")[0]] == null)
          .reduce((s, k) => s + sinceMedian(k), 0) / r.cards
      : scrub[p];
    const nspec = Object.values(r.spec).reduce((s, n) => s + n, 0);
    tot[p][0] += r.u;
    tot[p][1] += (r.u - nspec) * restVal[p] + Object.entries(r.spec).reduce((s, [t, n]) => s + n * restVal[p] * specialMult(t, r.run), 0);
  }
  const avg = Object.fromEntries(PAR.map(p => [p, tot[p][1] / tot[p][0]]));
  const nonU = PAR.filter(p => p !== "Silver").reduce((s, p) => s + tot[p][0], 0);
  const hitEv = PAR.filter(p => p !== "Silver").reduce((s, p) => s + tot[p][1], 0) / nonU;
  const book = 3 * avg.Silver + 2 * hitEv;
  hits.sort((a, b) => b.p - a.p);
  const mk = ck.pack, UNOPENED = ck.unopened;
  const pulled = mk.pulled || ck.pulled;
  const priced = pricedAt ? ` · prices updated ${pricedAt}` : "";

  return {
    eyebrow: "2026 Panini NFT Prizm FIFA World Cup Stickers",
    h1: "World Cup <span class=\"accent\">Stickers</span>",
    updated: `Copies left ${ck.pulled.slice(0, 10)} · ${UNOPENED.toLocaleString("en-US")} unopened packs (${(mk.unopened_with_collectors || 0).toLocaleString("en-US")} with collectors)${priced} · $8 mint`,
    disclaimer: "<strong>How this pack works.</strong> 5 stickers: <strong>3 Base Silver #/501</strong> + <strong>2 non-Silver</strong> (Blue /269 · Red /49 · Gold /10 · Green /5 · Black 1/1). Silvers are <strong>burnable for 10 block points</strong> (100 BP buys a 2022 Prizm WC pack); burning is capped at half of each card's copies. Priced on <strong>only the stickers still sealed in packs</strong>, from Panini's own pack checklist. A card's value is its recent normal-serial sales first, then its best offer capped at its floor, never below scrub. Every special serial still in a pack (#1, last serial, jersey number) is valued on its own. "
      + (SB ? `<strong>Silvers after the burn:</strong> ${960 - Object.keys(SB.uncapped).length} of 960 are fully burned and priced only on sales since 9pm ET Oct 30 ($0 if unsold); the stars nobody burns (${SB.stars.map(n => n.split(" ").at(-1)).join(", ")}) on their sales; the other ${Object.keys(SB.uncapped).length - SB.stars.length} still being burned at $0, since their price is burn value that ends at the cap. ` : "")
      + "Scrub levels: " + PAR.filter(p => !(SB && p === "Silver")).map(p => `${p} $${g(scrub[p])}`).join(" · ") + ". "
      + (pricedAt ? "Prices refresh every hour from blockchain sales. " : "") + "Not financial advice.",
    book: Math.round(book * 100) / 100,
    book_sub: `3 Silver at ${money(avg.Silver)} + 2 hits at ${money(hitEv)}`,
    mkt_label: `Pack floor (${pulled.slice(5, 10)})`,
    mkt_value: money(mk.floor),
    mkt_sub: `latest sale $${g(mk.recent)} · avg sale $${mk.avg.toFixed(2)} · ${mk.listings.toLocaleString("en-US")} listed · mint $8`,
    slots: [{ n: 5, d: "Stickers<br>per pack" }, { n: 3, d: "Silver<br>#/501 (burnable)" },
            { n: 2, d: "Non-Silver<br>/269 to 1/1", hit: true }, { n: UNOPENED.toLocaleString("en-US"), d: "Unopened<br>packs" }],
    hits_sub: `Every sticker worth $50+ that is still sealed, with copies left in packs (pulled ${ck.pulled}). Special serials still in packs are noted.`,
    hits: hits.slice(0, 60),
    break_label: "Each parallel",
    break_sub: "Copies still in packs, odds per hit slot from those copies, and average value of a pulled copy (special serials included).",
    break_cols: ["Parallel", "Run", "In packs", "Odds / hit slot", "Avg value"],
    breakdown: PAR.map(p => [p, `/${RUNS[p]}`, tot[p][0].toLocaleString("en-US"), p === "Silver" ? "3 per pack" : `${(tot[p][0] / nonU * 100).toFixed(1)}%`, money(avg[p])]),
    foot: "Data: data/stickers26-checklist.json (Panini pack checklist + collection report) + blockchain sales" + (pricedAt ? " (refreshed hourly)." : " (data/stickers26-sales.json)."),
    live: true,
  };
}
