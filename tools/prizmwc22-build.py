#!/usr/bin/env python3
# ============================================================
# Build the 2022 Panini NFT Prizm FIFA World Cup value map
# (tools/prizmwc22-values.json) + sealed-count seed
# (data/prizmwc22-remaining.json). Reproducible, repo-relative.
#
# Pack = 3 cards: 2 Base #/1399 + 1 hit (#/149 or less). Chain prefix packcard-1733.
# UNCLAIMED in the collection report = cards still sealed in packs.
#
# Per-card value priority (John's calls, 2026-10-12):
#   1) common mint (run>=10) with a 2026 WC comp -> 1.5x the 2026 median
#      (a 2022 card of a player is worth ~1.5x his 2026 equivalent; validated:
#       Messi 2026 Gold $100k x1.5 = $150k == 2022 historicals).
#   2) grail / illiquid-star overrides (OVR) from real recent sales.
#   3) exact (athlete, cardset) 2022 recent clear (our chain ledger).
#   4) SCRUB cap: common players priced at a true scrub level, so one star
#      sale in a cardset no longer prices every scrub at that median.
#   5) stars w/o comp or sale: scrub level * player-tier multiplier.
# avg_sale is deliberately NOT used: the market spiked this year, so the
# lifetime average reads low. Floors/offers are a sanity check only.
#
# Inputs (all in-repo):
#   data/prizmwc22-collection-report.csv  (supply + checklist)
#   data/prizmwc22-sales.json             (recent packcard-1733 chain sales)
#   burning_edges_sales_db.json           (2026 WC sales -> cross-set comps)
# ============================================================
import csv, json, os, statistics as st
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REP = os.path.join(ROOT, "data", "prizmwc22-collection-report.csv")
SALES22 = os.path.join(ROOT, "data", "prizmwc22-sales.json")
DB26 = os.path.join(ROOT, "burning_edges_sales_db.json")
UPLIFT = 1.5

rows = list(csv.DictReader(open(REP, encoding="utf-8-sig", errors="replace")))
sales22 = json.load(open(SALES22))
d26 = json.load(open(DB26, encoding="utf-8"))["sales"]

# 2026 cross-set comps (median price per athlete/cardset[/run])
c26, c26_as = defaultdict(list), defaultdict(list)
for x in d26:
    c26[(x["a"], x["s"], x.get("run"))].append(x["price"]); c26_as[(x["a"], x["s"])].append(x["price"])
c26 = {k: st.median(v) for k, v in c26.items()}; c26_as = {k: st.median(v) for k, v in c26_as.items()}

MESSI = {"Lionel Messi"}
T2 = {"Neymar", "Karim Benzema", "Vinicius Junior", "Kevin De Bruyne", "Luka Modric",
      "Harry Kane", "Robert Lewandowski", "Heung-min Son", "Pedri", "Gavi",
      "Jude Bellingham", "Jamal Musiala", "Bukayo Saka", "Luis Suarez"}
def pmult(a):
    return 18.0 if a in MESSI else 11.0 if a == "Kylian Mbappe" else 13.0 if a == "Cristiano Ronaldo" else 5.0 if a in T2 else 1.0

# 2022 recent sales (exact-card medians + scrub-only cardset medians)
meta = {r["PSKU"]: (r["ATHLETE"], r["CARDSET"], int(r["MINT RUN"]) if r["MINT RUN"].isdigit() else 0) for r in rows}
rec_ac = defaultdict(list); rec_cs_scrub = defaultdict(list)
for s in sales22:
    m = meta.get(s["sku_base"])
    if not m: continue
    rec_ac[(m[0], m[1])].append(s["price"])
    if pmult(m[0]) == 1.0: rec_cs_scrub[m[1]].append(s["price"])
rec_ac = {k: st.median(v) for k, v in rec_ac.items()}
rec_cs_scrub = {k: st.median(v) for k, v in rec_cs_scrub.items()}

def scrub_floor(run):
    return (2 if run >= 99 else 3 if run >= 75 else 4 if run >= 49 else 6 if run >= 25 else
            12 if run >= 11 else 25 if run == 10 else 50 if run >= 5 else 80 if run >= 2 else 120)
def scrub_val(cs, run):
    return rec_cs_scrub.get(cs, scrub_floor(run))

# explicit overrides (real recent sales for illiquid stars / grails)
OVR = {
    ("Lionel Messi", "Base Choice Prizms Nebula"): 80000,
    ("Lionel Messi", "Base Choice Prizms Zebra"): 42000,
    ("Lionel Messi", "Base Prizms Black"): 35000,
    ("Lionel Messi", "Global Reach Prizms Gold"): 1000,
}

valueMap, remaining, src = {}, {}, defaultdict(int)
for r in rows:
    a, cs, psku = r["ATHLETE"], r["CARDSET"], r["PSKU"]
    run = int(r["MINT RUN"]) if r["MINT RUN"].isdigit() else 1399
    uncl = int(r["UNCLAIMED"] or 0)
    sl = "base" if cs == "Base" else "hit"
    comp = c26.get((a, cs, run)) or c26_as.get((a, cs))
    if run >= 10 and comp is not None:   val, s = UPLIFT * comp, "1.5x26"
    elif (a, cs) in OVR:                 val, s = float(OVR[(a, cs)]), "grail"
    elif (a, cs) in rec_ac:              val, s = rec_ac[(a, cs)], "rec22"
    elif pmult(a) == 1.0:                val, s = scrub_val(cs, run), "scrub"
    else:                                val, s = scrub_val(cs, run) * pmult(a), "star_est"
    valueMap[psku] = {"v": round(val, 2), "cs": cs, "a": a, "r": run, "slot": sl}
    remaining[psku] = uncl
    if uncl > 0: src[s] += uncl

json.dump(valueMap, open(os.path.join(ROOT, "tools", "prizmwc22-values.json"), "w"), separators=(",", ":"))
json.dump(remaining, open(os.path.join(ROOT, "data", "prizmwc22-remaining.json"), "w"), separators=(",", ":"))
print("wrote", len(valueMap), "cards; sealed-value source:", dict(src))
