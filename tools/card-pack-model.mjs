// ============================================================
// 2022 Prizm FIFA WC (BP store) + 2022 Mosaic Road to World Cup -- value model
// and page payload (single source of truth; port of the retired
// prizmwc22-build.py / mosaicrtwc22-build.py + the build-pack-pages section).
// Used hourly by netlify/functions/{prizmwc22,mosaic22}-refresh.mjs and by
// tools/card-pack-build.mjs (baked fallback in prizmwc22.html / mosaic22.html).
//
// cards = [[psku, athlete, cardset, run, unclaimed(, comp26)]] from the Panini
// collection report (data/<product>-cards.json). sales = [{k: psku, price}]
// (own-set chain sales). pulled = {psku: copies pulled since the report}.
// Pack = 3 cards: 2 Base + 1 hit. Per-card value (John's calls):
//   prizmwc22: run>=10 with a 2026 WC comp -> 1.5x comp > grail override >
//              exact-card 2022 sales median > scrub (cardset scrub median, else
//              run floor) > star = scrub x player tier
//   mosaic22:  override > exact-card 2026 sales median > scrub > star
// ============================================================
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length, m = n >> 1; return n % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const money = n => "$" + (n >= 100 ? Math.round(n).toLocaleString("en-US") : n.toFixed(2));
const fmt = n => n.toLocaleString("en-US");

export const PRODUCTS = {
  prizmwc22: {
    prefix: "packcard-1733", dflt: 1399,
    tier: a => a === "Lionel Messi" ? 18 : a === "Kylian Mbappe" ? 11 : a === "Cristiano Ronaldo" ? 13 :
      ["Neymar", "Karim Benzema", "Vinicius Junior", "Kevin De Bruyne", "Luka Modric", "Harry Kane", "Robert Lewandowski",
       "Heung-min Son", "Pedri", "Gavi", "Jude Bellingham", "Jamal Musiala", "Bukayo Saka", "Luis Suarez"].includes(a) ? 5 : 1,
    floor: run => run >= 99 ? 2 : run >= 75 ? 3 : run >= 49 ? 4 : run >= 25 ? 6 : run >= 11 ? 12 : run === 10 ? 25 : run >= 5 ? 50 : run >= 2 ? 80 : 120,
    comp: true,
    OVR: {
      "Lionel Messi|Base Choice Prizms Nebula": 80000,
      "Lionel Messi|Base Choice Prizms Zebra": 42000,
      "Lionel Messi|Base Prizms Black": 35000,
      "Lionel Messi|Global Reach Prizms Gold": 1000,
    },
  },
  mosaic22: {
    prefix: "packcard-1605", dflt: 1649,
    tier: a => ({ "Lionel Messi": 18, "Cristiano Ronaldo": 13, "Kylian Mbappe": 11, "Erling Haaland": 11 })[a] ||
      (["Neymar Jr", "Neymar", "Karim Benzema", "Vinicius Junior", "Kevin De Bruyne", "Luka Modric", "Harry Kane", "Robert Lewandowski",
        "Pedri", "Gavi", "Jude Bellingham", "Jamal Musiala", "Bukayo Saka", "Florian Wirtz", "Zlatan Ibrahimovic"].includes(a) ? 5 : 1),
    floor: run => run >= 1000 ? 1 : run >= 99 ? 2 : run >= 75 ? 3 : run >= 49 ? 4 : run >= 25 ? 6 : run >= 11 ? 12 : run === 10 ? 20 : run >= 5 ? 40 : run >= 2 ? 60 : 100,
    comp: false,
    OVR: {
      "Erling Haaland|Base Mosaic Black": 100000,          // debut 1/1, John's call
      "Erling Haaland|Base Mosaic Gold": 7000,             // 6/10 sold $7,000 May-26
      "Lionel Messi|Montage Mosaic Gold": 3500,            // 7/10 $3,500 Jul-26
      "Lionel Messi|Breakaway Mosaic Gold Fluorescent": 1500,
      "Lionel Messi|Base Mosaic Purple": 500,
      "Erling Haaland|Base Mosaic Blue": 400,
      "Cristiano Ronaldo|Autographs Mosaic Choice Fusion Red": 700,
      "Luka Modric|Base Mosaic Gold": 600,
      "Lionel Messi|Base Mosaic Black": 50000,             // sealed grails, John's values (2026-10-20)
      "Erling Haaland|Pitch Masters Mosaic Black": 25000,
      "Lionel Messi|Base Mosaic Gold": 10000,
      "Kylian Mbappe|Base Mosaic Gold": 5000,
      "Cristiano Ronaldo|Base Mosaic Gold": 5000,
      "Erling Haaland|Pitch Masters Mosaic Gold": 1500,    // proposed by Claude, not objected to
      "Erling Haaland|Breakaway Mosaic Gold Fluorescent": 1500,
      "Cristiano Ronaldo|Autographs Mosaic Gold": 800,
      "Cristiano Ronaldo|Breakaway Mosaic Gold Fluorescent": 600,
      "Neymar|Base Mosaic Gold": 400,
    },
  },
};

// per-card value map {psku: {v, cs, a, r, slot}}
export function valueCards(product, cards, sales) {
  const P = PRODUCTS[product];
  const meta = Object.fromEntries(cards.map(c => [c[0], c]));
  const recAc = {}, recScrub = {};
  for (const s of sales) {
    const m = meta[s.k];
    if (!m) continue;
    (recAc[m[1] + "|" + m[2]] ||= []).push(s.price);
    if (P.tier(m[1]) === 1) (recScrub[m[2]] ||= []).push(s.price);
  }
  for (const o of [recAc, recScrub]) for (const k in o) o[k] = median(o[k]);
  const scrubVal = (cs, run) => recScrub[cs] ?? P.floor(run);
  const vm = {};
  for (const [k, a, cs, run, , comp] of cards) {
    const ac = a + "|" + cs;
    let v;
    if (P.comp && run >= 10 && comp != null) v = 1.5 * comp;
    else if (ac in P.OVR) v = P.OVR[ac];
    else if (ac in recAc) v = recAc[ac];
    else if (P.tier(a) === 1) v = scrubVal(cs, run);
    else v = scrubVal(cs, run) * P.tier(a);
    vm[k] = { v: Math.round(v * 100) / 100, cs, a, r: run, slot: cs === "Base" ? "base" : "hit" };
  }
  return vm;
}

// page payload (same fields as the template's D)
export function cardPackPage(product, cards, sales, { pulled = {}, market = null, pricedAt = null, liveNote = null } = {}) {
  const vm = valueCards(product, cards, sales);
  const slot = { base: [0, 0], hit: [0, 0] }, byCs = {}, hits = [];
  for (const c of cards) {
    const k = c[0], i = vm[k], u = Math.max(0, c[4] - (pulled[k] || 0));
    if (!u) continue;
    slot[i.slot][0] += u; slot[i.slot][1] += u * i.v;
    if (i.slot === "hit") {
      const b = (byCs[i.cs] ||= [0, 0, 0]); b[0] += u; b[1] += u * i.v; b[2] = i.r;
      hits.push({ c: i.a, s: i.cs, r: i.r, u, p: i.v });
    }
  }
  const aB = slot.base[1] / slot.base[0], aH = slot.hit[1] / slot.hit[0], book = 2 * aB + aH;
  hits.sort((a, b) => b.p - a.p);
  const rows = Object.entries(byCs).sort((a, b) => b[1][1] - a[1][1]).slice(0, 14)
    .map(([cs, [u, v, r]]) => [cs, `/${r}`, fmt(u), money(v / u)]);
  const packs = Math.floor((slot.base[0] + slot.hit[0]) / 3);
  const live = pricedAt ? ` · prices updated ${pricedAt}` : "";
  const common = {
    book: Math.round(book * 100) / 100,
    book_sub: `2 base at ${money(aB)} + 1 hit at ${money(aH)}`,
    hits: hits.filter(h => h.p >= 300).slice(0, 40),
    break_label: "Hit slot by cardset",
    break_sub: "The biggest contributors to the hit slot's value (copies still in packs × average value).",
    break_cols: ["Cardset", "Run", "In packs", "Avg value"],
    breakdown: rows,
    live: `/api/pack-live?product=${product}`,
  };
  const copies = liveNote || "copies from the Panini collection report";
  if (product === "prizmwc22") return {
    eyebrow: "2022 Panini NFT Prizm FIFA World Cup · Block Point Store",
    h1: "2022 Prizm <span class=\"accent\">World Cup</span>",
    updated: `${fmt(packs)} packs left in the BP store (${copies})${live} · 100 BP each`,
    disclaimer: "<strong>How this pack works.</strong> 3 cards: <strong>2 Base #/1399</strong> + <strong>1 hit</strong> (parallel, insert or auto #/149 or less). Panini is putting the remaining packs in the Block Point store at <strong>100 BP</strong> each (burn sticker commons for 10 BP apiece). Values are 2026 chain sales first, a 2022 card at 1.5&times; the same player's 2026 WC comp, scrubs capped at scrub prices, and grail overrides. Book value is the cards' worth; the pack trades higher because of BP utility and the grail lottery. " + (pricedAt ? "Copies left and prices refresh every hour from the blockchain. " : "") + "Not financial advice.",
    ...common,
    mkt_label: `Pack floor (${market.date})`,
    mkt_value: money(market.floor),
    mkt_sub: `latest sale $${market.recent} · avg sale $${market.avg.toFixed(2)} · ${fmt(market.listings)} listed · top sale $${market.top}`,
    slots: [{ n: 3, d: "Cards<br>per pack" }, { n: 2, d: "Base<br>#/1399" },
            { n: 1, d: "Hit<br>#/149 or less", hit: true }, { n: fmt(packs), d: "Packs<br>left" }],
    hits_sub: `Every sealed hit worth $300+, ranked. ${fmt(hits.length)} distinct hit cards still in packs.`,
    foot: "Model: tools/card-pack-model.mjs · cards data/prizmwc22-cards.json (collection report + 2026 comps) · market snapshot data/pack-markets.json" + (pricedAt ? " · refreshed hourly from chain sales + pulls." : "."),
  };
  return {
    eyebrow: "2022 Panini NFT Mosaic Road to World Cup · Spend Promo Reward",
    h1: "2022 Mosaic <span class=\"accent\">Road to WC</span>",
    updated: `${fmt(packs)} packs remaining (${copies})${live}`,
    disclaimer: "<strong>How this pack works.</strong> 3 cards: <strong>2 Base</strong> + <strong>1 hit</strong> (parallel, insert or auto from a 40-cardset pool). These packs are no longer sold; Panini hands them out as <strong>Spend Promo rewards</strong> and airdrops. Priced on <strong>2026 sales only</strong> (Mosaic commons clear $1&ndash;2), with grail values set by hand for the sealed 1/1s and star Golds. The grail tail drives most of the value. " + (pricedAt ? "Copies left and prices refresh every hour from the blockchain. " : "") + "Not financial advice.",
    ...common,
    mkt_label: "Packs remaining",
    mkt_value: fmt(packs),
    mkt_sub: "cards still in packs ÷ 3 · reward-only, not sold",
    slots: [{ n: 3, d: "Cards<br>per pack" }, { n: 2, d: "Base<br>#/1649" },
            { n: 1, d: "Hit<br>40 cardsets", hit: true }, { n: money(book), d: "Book<br>value" }],
    hits_sub: "Sealed grails and star hits, ranked. Haaland's debut Base Black 1/1 is still in a pack.",
    foot: "Model: tools/card-pack-model.mjs · cards data/mosaic22-cards.json (collection report)" + (pricedAt ? " · refreshed hourly from chain sales + pulls." : "."),
  };
}
