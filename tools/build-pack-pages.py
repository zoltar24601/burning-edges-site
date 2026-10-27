#!/usr/bin/env python3
# ============================================================
# Render the static pack pages for the three packs priced 2026-10:
#   prizmwc22.html  -- 2022 Prizm FIFA WC (block-point store pack)
#   mosaic22.html   -- 2022 Mosaic Road to World Cup (Spend Promo reward pack)
#   stickers.html   -- 2026 Prizm FIFA WC Stickers
# Fills tools/packpage-template.html from the committed value files. Market
# figures (floors/avg sales) are snapshots typed in below -- update them here.
# Run from repo root:  python tools/build-pack-pages.py
# ============================================================
import json, os
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
TEMPLATE = open(P("tools", "packpage-template.html"), encoding="utf-8").read()
money = lambda n: "$" + (f"{n:,.0f}" if n >= 100 else f"{n:,.2f}")


def card_model(values_file, remaining_file):
    vm = json.load(open(P(*values_file)))
    rem = json.load(open(P(*remaining_file)))
    slot = {"base": [0, 0.0], "hit": [0, 0.0]}
    by_cs = defaultdict(lambda: [0, 0.0, 0])
    hits = []
    for k, i in vm.items():
        u = rem.get(k, 0)
        if not u:
            continue
        slot[i["slot"]][0] += u
        slot[i["slot"]][1] += u * i["v"]
        if i["slot"] == "hit":
            b = by_cs[i["cs"]]; b[0] += u; b[1] += u * i["v"]; b[2] = i["r"]
            hits.append({"c": i["a"], "s": i["cs"], "r": i["r"], "u": u, "p": i["v"]})
    aB = slot["base"][1] / slot["base"][0]
    aH = slot["hit"][1] / slot["hit"][0]
    hits.sort(key=lambda h: -h["p"])
    breakdown = sorted(by_cs.items(), key=lambda kv: -kv[1][1])[:14]
    rows = [[cs, f"/{r}", f"{u:,}", money(v / u)] for cs, (u, v, r) in breakdown]
    return aB, aH, hits, rows, slot


def render(fname, nav_key, title, accent, data):
    html = TEMPLATE.replace("__TITLE__", title).replace("__ACCENT__", accent)
    for k in ("prizmwc22", "mosaic22", "stickers"):
        html = html.replace(f"__NAV_{k}__", ' class="active"' if k == nav_key else "")
    html = html.replace("__DATA__", json.dumps(data, ensure_ascii=True))
    open(P(fname), "w", encoding="utf-8").write(html)
    print("wrote", fname, "| book", money(data["book"]))


# ---------- 2022 Prizm WC (BP store) ----------
aB, aH, hits, rows, slot = card_model(("tools", "prizmwc22-values.json"), ("data", "prizmwc22-remaining.json"))
render("prizmwc22.html", "prizmwc22", "2022 Prizm World Cup Pack", "#e8c468", {
    "eyebrow": "2022 Panini NFT Prizm FIFA World Cup · Block Point Store",
    "h1": "2022 Prizm <span class=\"accent\">World Cup</span>",
    "updated": "Modeled 2026-10-12 · 34,075 packs going to the BP store at 100 BP",
    "disclaimer": "<strong>How this pack works.</strong> 3 cards: <strong>2 Base #/1399</strong> + <strong>1 hit</strong> (parallel, insert or auto #/149 or less). Panini is putting the remaining <strong>34,075 packs</strong> in the Block Point store at <strong>100 BP</strong> each (burn sticker commons for 10 BP apiece). Values are 2026 chain sales first, a 2022 card at 1.5&times; the same player's 2026 WC comp, scrubs capped at scrub prices, and grail overrides. Book value is the cards' worth; the pack trades higher because of BP utility and the grail lottery. Not financial advice.",
    "book": round(2 * aB + aH, 2),
    "book_sub": f"2 base at {money(aB)} + 1 hit at {money(aH)}",
    "mkt_label": "Pack market (Oct 12)",
    "mkt_value": "$61.89",
    "mkt_sub": "average pack sale · floor $89 · top sale $415",
    "slots": [{"n": 3, "d": "Cards<br>per pack"}, {"n": 2, "d": "Base<br>#/1399"},
              {"n": 1, "d": "Hit<br>#/149 or less", "hit": True}, {"n": "34,075", "d": "Packs<br>in BP store"}],
    "hits_sub": f"Every sealed hit worth $300+, ranked. {len(hits):,} distinct hit cards still in packs.",
    "hits": [h for h in hits if h["p"] >= 300][:40],
    "break_label": "Hit slot by cardset",
    "break_sub": "The biggest contributors to the hit slot's value (copies still in packs × average value).",
    "break_cols": ["Cardset", "Run", "In packs", "Avg value"],
    "breakdown": rows,
    "foot": "Model: tools/prizmwc22-build.py · values tools/prizmwc22-values.json · market figures are a 2026-10-12 snapshot.",
})

# ---------- 2022 Mosaic Road to World Cup (Spend Promo reward) ----------
aB, aH, hits, rows, slot = card_model(("tools", "mosaicrtwc22-values.json"), ("data", "mosaicrtwc22-remaining.json"))
packs = (slot["base"][0] + slot["hit"][0]) // 3
render("mosaic22.html", "mosaic22", "2022 Mosaic Road to World Cup Pack", "#b89be0", {
    "eyebrow": "2022 Panini NFT Mosaic Road to World Cup · Spend Promo Reward",
    "h1": "2022 Mosaic <span class=\"accent\">Road to WC</span>",
    "updated": f"Modeled 2026-10-20 · {packs:,} packs remaining",
    "disclaimer": "<strong>How this pack works.</strong> 3 cards: <strong>2 Base</strong> + <strong>1 hit</strong> (parallel, insert or auto from a 40-cardset pool). These packs are no longer sold; Panini hands them out as <strong>Spend Promo rewards</strong> and airdrops. Priced on <strong>2026 sales only</strong> (Mosaic commons clear $1&ndash;2), with grail values set by hand for the sealed 1/1s and star Golds. The grail tail drives most of the value. Not financial advice.",
    "book": round(2 * aB + aH, 2),
    "book_sub": f"2 base at {money(aB)} + 1 hit at {money(aH)}",
    "mkt_label": "Packs remaining",
    "mkt_value": f"{packs:,}",
    "mkt_sub": "cards still in packs ÷ 3 · reward-only, not sold",
    "slots": [{"n": 3, "d": "Cards<br>per pack"}, {"n": 2, "d": "Base<br>#/1649"},
              {"n": 1, "d": "Hit<br>40 cardsets", "hit": True}, {"n": money(2 * aB + aH), "d": "Book<br>value"}],
    "hits_sub": "Sealed grails and star hits, ranked. Haaland's debut Base Black 1/1 is still in a pack.",
    "hits": [h for h in hits if h["p"] >= 300][:40],
    "break_label": "Hit slot by cardset",
    "break_sub": "The biggest contributors to the hit slot's value (copies still in packs × average value).",
    "break_cols": ["Cardset", "Run", "In packs", "Avg value"],
    "breakdown": rows,
    "foot": "Model: tools/mosaicrtwc22-build.py · values tools/mosaicrtwc22-values.json.",
})

# ---------- 2026 Prizm FIFA WC Stickers ----------
off = json.load(open(P("data", "stickers26-offers.json")))
sal = json.load(open(P("data", "stickers26-sales.json")))["sales"]
runs = {"Silver": 501, "Blue": 269, "Red": 49, "Gold": 10, "Green": 5, "Black": 1}
scrub = {"Silver": 3, "Blue": 2, "Red": 4, "Gold": 6, "Green": 8, "Black": 12}
N = 960
known = {}
for o in off["offers_gt3"]:
    known[(o["a"], o["p"])] = max(known.get((o["a"], o["p"]), 0), o["offer"] or 0)
for s in sorted(sal, key=lambda x: x["date"]):
    if not s["premium"]:
        known[(s["a"], s["p"])] = max(known.get((s["a"], s["p"]), 0), s["price"])
uplift = lambda r: 1.0 if r == 1 else 1 + 3 / r
avg = {}
for p in runs:
    ks = [k for k in known if k[1] == p]
    tot = (sum(max(known[k], scrub[p]) for k in ks) + (N - len(ks)) * scrub[p]) * uplift(runs[p])
    avg[p] = tot / N
non = sum(N * runs[p] for p in runs if p != "Silver")
hit_ev = sum(avg[p] * N * runs[p] for p in runs if p != "Silver") / non
book = 3 * avg["Silver"] + 2 * hit_ev
st_hits = sorted([{"c": a, "s": p, "r": runs[p], "u": None, "p": v} for (a, p), v in known.items() if v >= 20],
                 key=lambda h: -h["p"])[:40]
render("stickers.html", "stickers", "2026 World Cup Sticker Pack", "#5ed68a", {
    "eyebrow": "2026 Panini NFT Prizm FIFA World Cup Stickers",
    "h1": "World Cup <span class=\"accent\">Stickers</span>",
    "updated": "Modeled 2026-10-26 · 160,320 packs · $8 mint",
    "disclaimer": "<strong>How this pack works.</strong> 5 stickers: <strong>3 Base Silver #/501</strong> + <strong>2 non-Silver</strong> (Blue /269 · Red /49 · Gold /10 · Green /5 · Black 1/1). Silvers are <strong>burnable for 10 block points</strong> (100 BP buys a 2022 Prizm WC pack), which is why every Silver carries a $3 bid &mdash; that floor is most of the book. Values: highest of the latest normal-serial sale, the best live offer, or the parallel's scrub level, plus the expected special-serial bump (#1 3&times;, last 2&times;). Special serials (#1, perfect mint) are kept out of normal prices. Scrub Blues (80% of hit slots) have no sales or bids yet &mdash; book ranges $14.39&ndash;$17.63 across a $1&ndash;$3 Blue. Not financial advice.",
    "book": round(book, 2),
    "book_sub": f"3 Silver at {money(avg['Silver'])} + 2 hits at {money(hit_ev)} · range $14.39–$17.63",
    "mkt_label": "Pack market (Oct 26)",
    "mkt_value": "$13.00",
    "mkt_sub": "floor · avg sale $13.17 · top sale $20 · mint $8",
    "slots": [{"n": 5, "d": "Stickers<br>per pack"}, {"n": 3, "d": "Silver<br>#/501 (burnable)"},
              {"n": 2, "d": "Non-Silver<br>/269 to 1/1", "hit": True}, {"n": "$8", "d": "Mint<br>price"}],
    "hits_sub": "Best live offer or latest normal sale, $20+ (pulled 2026-10-26). Pack-level counts not tracked yet for this set.",
    "hits": st_hits,
    "break_label": "Each parallel",
    "break_sub": "Odds are per hit slot (by print run). Average card value includes the expected special-serial bump.",
    "break_cols": ["Parallel", "Run", "Odds / hit slot", "Avg card value"],
    "breakdown": [[p, f"/{runs[p]}", "3 per pack" if p == "Silver" else f"{runs[p] * N / non:.1%}", money(avg[p])] for p in runs],
    "foot": "Data: data/stickers26-offers.json (live offers) · data/stickers26-sales.json (airdrop sales, serials tracked).",
})
