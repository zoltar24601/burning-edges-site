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
# Priced on what is STILL IN PACKS. data/stickers26-checklist.json is Panini's
# pack checklist (getStorePackCheckList): per card unclaimed count, best offer,
# floor, and the status of every special serial (#1, last, jersey). Notable cards
# are listed one by one; every other card is rolled up per parallel at scrub.
# Card value (normal serial): John's override > median of the last 3 normal-serial
# sales since window_from > best offer capped at floor > never below scrub.
# Each unclaimed special serial is valued on its own (special_mult below).
ck = json.load(open(P("data", "stickers26-checklist.json"), encoding="utf-8"))
sales = json.load(open(P("data", "stickers26-sales.json"), encoding="utf-8"))
scrub = ck["scrub"]
OVR = {(k.split("|")[0], k.split("|")[1]): v for k, v in ck["overrides"].items()}
PAR = ["Silver", "Blue", "Red", "Gold", "Green", "Black"]
SPECIAL = ("number 1", "perfect mint", "jersey mint")


def special_mult(tags, run):
    if run == 1:
        return 1.0
    hi = run >= 49
    m = {"number 1": 5 if hi else 3, "perfect mint": 5 if hi else 2, "jersey mint": 8 if hi else 2}
    return max([m[t] for t in SPECIAL if t in tags] or [1])


recent = defaultdict(list)
for x in sales["sales"]:
    if x["date"] >= sales["window_from"]:
        recent[(x["a"], x["p"])].append(x)


RULES = ck.get("rules", {})
_last = max(datetime.fromisoformat(x["date"][:19]) for x in sales["sales"] if "T" in x["date"])
CUT24 = (_last - timedelta(hours=24)).isoformat()


# rules.since {parallel: utc cutoff}: that parallel is priced ONLY on normal-serial
# sales after the cutoff (John: Silvers after the burn, from 9pm ET 10/30); a card
# with no sale since is $0. Covers every card of the parallel, notable or not.
SINCE = RULES.get("since", {})


def since_median(k):
    ps = sorted(x["price"] for x in recent.get(k, [])
                if x["date"] >= SINCE[k[1]] and not any(t in x["tags"] for t in SPECIAL))
    return ps[len(ps) // 2] if ps else 0.0


def card_value(c):
    k = (c["a"], c["p"])
    if k in OVR:
        return OVR[k]
    if c["p"] in SINCE:
        return since_median(k)
    if c["p"] in RULES.get("zero", []):
        return 0.0  # John: price this parallel at $0 (burn-dead), even named cards
    ss = sorted(recent.get(k, []), key=lambda x: x["date"], reverse=True)
    norm = [x for x in ss if c["run"] == 1 or not any(t in x["tags"] for t in SPECIAL)]
    if RULES.get("window24"):
        # liquid cards: median of the last 24h of normal sales; thin ones: last 5
        day = [x["price"] for x in norm if x["date"] >= CUT24]
        norm = day if len(day) >= 3 else [x["price"] for x in norm[:5]]
    else:
        norm = [x["price"] for x in norm[:3]]
    if norm:
        v = sorted(norm)[len(norm) // 2]
    else:
        v = c["offer"] or 0
        if RULES.get("mid") and v and c["floor"] > v:
            v = (v + c["floor"]) / 2  # no sales: bid/ask midpoint
        elif c["floor"] and v > c["floor"]:
            v = c["floor"]  # a bid above the floor is for one specific serial
    return max(v, scrub[c["p"]])


VAL = {(c["a"], c["p"]): card_value(c) for c in ck["cards"]}
if RULES.get("ladder"):
    # a rarer parallel of the same player is never worth less than a commoner one
    for a in {c["a"] for c in ck["cards"]}:
        best = 0
        for p in PAR:
            k = (a, p)
            if k in VAL:
                if VAL[k] < best and k not in OVR:
                    VAL[k] = best
                best = max(best, VAL[k])

tot = {p: [0, 0.0] for p in PAR}       # in-pack copies, in-pack value
hits = []
for c in ck["cards"]:
    v = VAL[(c["a"], c["p"])]
    sp = [t for t in c["spec"]]
    val = (c["u"] - len(sp)) * v + sum(v * special_mult(t, c["run"]) for t in sp)
    tot[c["p"]][0] += c["u"]; tot[c["p"]][1] += val
    if c["u"] and v >= 50:
        lab = {"number 1": "#1", "perfect mint": f"#{c['run']} (last)", "jersey mint": "jersey #"}
        left = [" / ".join(lab[x] for x in t.split(",")) for t in sp if c["run"] > 1]
        hits.append({"c": c["a"], "s": c["p"] + (" &middot; still sealed: " + ", ".join(left) if left else ""),
                     "r": c["run"], "u": c["u"], "p": v})
NOTABLE = {(c["a"], c["p"]) for c in ck["cards"]}
rest_val = {}
for p, r in ck["rest"].items():
    # un-listed cards: scrub, or for a `since` parallel the average over all r["cards"]
    # of each card's post-cutoff median (cards that haven't sold count $0)
    rest_val[p] = (sum(since_median(k) for k in recent if k[1] == p and k not in NOTABLE) / r["cards"]
                   if p in SINCE else scrub[p])
    run = r["run"]
    nspec = sum(r["spec"].values())
    tot[p][0] += r["u"]
    tot[p][1] += (r["u"] - nspec) * rest_val[p] + sum(n * rest_val[p] * special_mult(t, run) for t, n in r["spec"].items())
avg = {p: tot[p][1] / tot[p][0] for p in PAR}
non_u = sum(tot[p][0] for p in PAR if p != "Silver")
hit_ev = sum(tot[p][1] for p in PAR if p != "Silver") / non_u
book = 3 * avg["Silver"] + 2 * hit_ev
hits.sort(key=lambda h: -h["p"])
mk = ck["pack"]
runs = {"Silver": 501, "Blue": 269, "Red": 49, "Gold": 10, "Green": 5, "Black": 1}
render("stickers.html", "stickers", "2026 World Cup Sticker Pack", "#5ed68a", {
    "eyebrow": "2026 Panini NFT Prizm FIFA World Cup Stickers",
    "h1": "World Cup <span class=\"accent\">Stickers</span>",
    "updated": f"Modeled {ck['pulled']} · {ck['unopened']:,} unopened packs · $8 mint",
    "disclaimer": "<strong>How this pack works.</strong> 5 stickers: <strong>3 Base Silver #/501</strong> + <strong>2 non-Silver</strong> (Blue /269 · Red /49 · Gold /10 · Green /5 · Black 1/1). Silvers are <strong>burnable for 10 block points</strong> (100 BP buys a 2022 Prizm WC pack); burning is capped at half of each card's copies. Priced on <strong>only the stickers still sealed in packs</strong>, from Panini's own pack checklist. A card's value is its recent normal-serial sales first, then its best offer capped at its floor, never below scrub. Every special serial still in a pack (#1, last serial, jersey number) is valued on its own. " + "".join(f"<strong>{p}s are priced only on sales since {SINCE[p][5:10]} {SINCE[p][11:16]} UTC</strong> (after the burn): each card's median normal-serial sale, $0 if it hasn't sold. " for p in SINCE) + "Scrub levels: " + " · ".join(f"{p} ${scrub[p]:g}" for p in PAR if p not in SINCE) + ". Not financial advice.",
    "book": round(book, 2),
    "book_sub": f"3 Silver at {money(avg['Silver'])} + 2 hits at {money(hit_ev)}",
    "mkt_label": f"Pack floor ({mk.get('pulled', ck['pulled'])[5:10]})",  # market can be refreshed apart from the checklist
    "mkt_value": money(mk["floor"]),
    "mkt_sub": f"latest sale ${mk['recent']:g} · avg sale ${mk['avg']:.2f} · {mk['listings']:,} listed · mint $8",
    "slots": [{"n": 5, "d": "Stickers<br>per pack"}, {"n": 3, "d": "Silver<br>#/501 (burnable)"},
              {"n": 2, "d": "Non-Silver<br>/269 to 1/1", "hit": True}, {"n": f"{ck['unopened']:,}", "d": "Unopened<br>packs"}],
    "hits_sub": f"Every sticker worth $50+ that is still sealed, with copies left in packs (pulled {ck['pulled']}). Special serials still in packs are noted.",
    "hits": hits[:60],
    "break_label": "Each parallel",
    "break_sub": "Copies still in packs, odds per hit slot from those copies, and average value of a pulled copy (special serials included).",
    "break_cols": ["Parallel", "Run", "In packs", "Odds / hit slot", "Avg value"],
    "breakdown": [[p, f"/{runs[p]}", f"{tot[p][0]:,}", "3 per pack" if p == "Silver" else f"{tot[p][0] / non_u:.1%}", money(avg[p])] for p in PAR],
    "foot": "Data: data/stickers26-checklist.json (Panini pack checklist) + data/stickers26-sales.json (sales with serials).",
})
