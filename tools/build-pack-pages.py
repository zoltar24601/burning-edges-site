#!/usr/bin/env python3
# ============================================================
# Render the static pack pages for the three packs priced 2026-10:
#   prizmwc22.html  -- 2022 Prizm FIFA WC (block-point store pack)
#   mosaic22.html   -- 2022 Mosaic Road to World Cup (Spend Promo reward pack)
#   stickers.html   -- 2026 Prizm FIFA WC Stickers
# Fills tools/packpage-template.html from the committed value files (stickers via
# tools/stickers-model.mjs, also run hourly live). Market
# figures (floors/avg sales) are snapshots typed in below -- update them here.
# Run from repo root:  python tools/build-pack-pages.py
# ============================================================
import json, os
from collections import defaultdict
from datetime import datetime, timedelta

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
    "mkt_label": "Pack floor (Oct 31)",
    "mkt_value": "$25.00",
    "mkt_sub": "latest sale $27 · avg sale $36.27 · 916 listed · top sale $415",
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
# The model lives in tools/stickers-model.mjs, shared with the hourly refresh
# (netlify/functions/stickers-refresh.mjs -> /api/stickers-data). This bakes its
# output into stickers.html as the fallback the page shows until live data loads.
# Edit rules/overrides/copies in data/stickers26-checklist.json.
import subprocess
render("stickers.html", "stickers", "2026 World Cup Sticker Pack", "#5ed68a", json.loads(subprocess.run(
    ["node", P("tools", "stickers-build.mjs")], capture_output=True, encoding="utf-8", check=True).stdout))
