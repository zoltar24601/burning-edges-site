#!/usr/bin/env python3
# ============================================================
# Build the 2022 Panini NFT Mosaic Road to World Cup value map + pack EV.
# Chain prefix packcard-1605. Packs are being given out as Spend Promo rewards.
#
# Pack = 3 cards: 2 Base + 1 hit (Parallel / Insert / Auto, 40-cardset pool).
# UNCLAIMED in the collection report = cards still sealed in packs.
# Packs remaining = total unclaimed / 3 (John's rule; also = base/2 = hits).
#
# Pricing (John, 2026-10-20): 2026 prices only -- anything older is irrelevant.
#   1) exact (athlete, cardset) 2026 chain sale (our ledger is Aug-Oct 2026)
#   2) OVR: John's pasted 2026 sales + Haaland debut Base Mosaic Black 1/1 = $100k
#   3) scrub cap: common players at the cardset's 2026 scrub median, else run floor
#   4) stars w/o data: scrub level * player-tier multiplier
#
# Inputs (in-repo): data/mosaicrtwc22-collection-report.csv, data/mosaicrtwc22-sales.json
# ============================================================
import csv, json, os, statistics as st
from collections import defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REP = os.path.join(ROOT, "data", "mosaicrtwc22-collection-report.csv")
SALES = os.path.join(ROOT, "data", "mosaicrtwc22-sales.json")

rows = list(csv.DictReader(open(REP, encoding="utf-8-sig", errors="replace")))
sales = json.load(open(SALES)) if os.path.exists(SALES) else []

TIER = {"Lionel Messi": 18.0, "Cristiano Ronaldo": 13.0, "Kylian Mbappe": 11.0, "Erling Haaland": 11.0}
T2 = {"Neymar Jr", "Neymar", "Karim Benzema", "Vinicius Junior", "Kevin De Bruyne", "Luka Modric",
      "Harry Kane", "Robert Lewandowski", "Pedri", "Gavi", "Jude Bellingham", "Jamal Musiala",
      "Bukayo Saka", "Florian Wirtz", "Zlatan Ibrahimovic"}
def pmult(a):
    return TIER.get(a, 5.0 if a in T2 else 1.0)

meta = {r["PSKU"]: (r["ATHLETE"], r["CARDSET"]) for r in rows}
rec_ac = defaultdict(list); rec_cs_scrub = defaultdict(list)
for s in sales:
    m = meta.get(s["sku_base"])
    if not m: continue
    rec_ac[m].append(s["price"])
    if pmult(m[0]) == 1.0: rec_cs_scrub[m[1]].append(s["price"])
rec_ac = {k: st.median(v) for k, v in rec_ac.items()}
rec_cs_scrub = {k: st.median(v) for k, v in rec_cs_scrub.items()}

def scrub_floor(run):
    return (1 if run >= 1000 else 2 if run >= 99 else 3 if run >= 75 else 4 if run >= 49 else
            6 if run >= 25 else 12 if run >= 11 else 20 if run == 10 else 40 if run >= 5 else 60 if run >= 2 else 100)
def scrub_val(cs, run):
    return rec_cs_scrub.get(cs, scrub_floor(run))

# John's 2026 sales (normal-copy values; premium serials noted) + the Haaland grail
OVR = {
    ("Erling Haaland", "Base Mosaic Black"): 100000,          # debut 1/1, John's call
    ("Erling Haaland", "Base Mosaic Gold"): 7000,             # 6/10 sold $7,000 May-26
    ("Lionel Messi", "Montage Mosaic Gold"): 3500,            # 7/10 $3,500 Jul-26
    ("Lionel Messi", "Breakaway Mosaic Gold Fluorescent"): 1500,  # 8/10 $1,500 Jul-26
    ("Lionel Messi", "Base Mosaic Purple"): 500,              # $400/$400/$800 May-Jun-26
    ("Erling Haaland", "Base Mosaic Blue"): 400,              # 19/75 $400 Jul-26
    ("Cristiano Ronaldo", "Autographs Mosaic Choice Fusion Red"): 700,  # 7/88 jersey mint $999 Apr-26
    ("Luka Modric", "Base Mosaic Gold"): 600,                 # 10/10 jersey+perfect $850 Oct-26
    # sealed grails with no 2026 sale -- John's values (2026-10-20)
    ("Lionel Messi", "Base Mosaic Black"): 50000,
    ("Erling Haaland", "Pitch Masters Mosaic Black"): 25000,
    ("Lionel Messi", "Base Mosaic Gold"): 10000,
    ("Kylian Mbappe", "Base Mosaic Gold"): 5000,
    ("Cristiano Ronaldo", "Base Mosaic Gold"): 5000,
    # proposed by Claude, not objected to
    ("Erling Haaland", "Pitch Masters Mosaic Gold"): 1500,
    ("Erling Haaland", "Breakaway Mosaic Gold Fluorescent"): 1500,
    ("Cristiano Ronaldo", "Autographs Mosaic Gold"): 800,
    ("Cristiano Ronaldo", "Breakaway Mosaic Gold Fluorescent"): 600,
    ("Neymar", "Base Mosaic Gold"): 400,
}

valueMap, remaining, src = {}, {}, defaultdict(int)
for r in rows:
    a, cs, psku = r["ATHLETE"], r["CARDSET"], r["PSKU"]
    run = int(r["MINT RUN"]) if r["MINT RUN"].isdigit() else 1649
    uncl = int(r["UNCLAIMED"] or 0)
    sl = "base" if cs == "Base" else "hit"
    if (a, cs) in OVR:            val, s = float(OVR[(a, cs)]), "ovr26"
    elif (a, cs) in rec_ac:       val, s = rec_ac[(a, cs)], "chain26"
    elif pmult(a) == 1.0:         val, s = scrub_val(cs, run), "scrub"
    else:                         val, s = scrub_val(cs, run) * pmult(a), "star_est"
    valueMap[psku] = {"v": round(val, 2), "cs": cs, "a": a, "r": run, "slot": sl}
    remaining[psku] = uncl
    if uncl > 0: src[s] += uncl

json.dump(valueMap, open(os.path.join(ROOT, "tools", "mosaicrtwc22-values.json"), "w"), separators=(",", ":"))
json.dump(remaining, open(os.path.join(ROOT, "data", "mosaicrtwc22-remaining.json"), "w"), separators=(",", ":"))

tot = sum(remaining.values())
slot = {"base": [0, 0.0], "hit": [0, 0.0]}
for k, i in valueMap.items():
    u = remaining[k]
    if u: slot[i["slot"]][0] += u; slot[i["slot"]][1] += u * i["v"]
aB = slot["base"][1] / slot["base"][0]; aH = slot["hit"][1] / slot["hit"][0]
print(f"cards in packs {tot:,} -> packs {tot // 3:,} | sales used {len(sales):,} | source {dict(src)}")
print(f"BASE ${aB:,.2f}  HIT ${aH:,.2f}  PACK EV ${2 * aB + aH:,.2f}")
hits = sorted([(i["a"], i["cs"], i["r"], remaining[k], i["v"]) for k, i in valueMap.items()
               if remaining[k] > 0 and i["slot"] == "hit"], key=lambda x: -x[4])
print("top sealed hits:")
for a, cs, r, u, v in hits[:15]:
    print(f"  {a[:20]:20} {cs[:34]:34} /{r:<4} x{u:<3} ${v:>9,.0f}")
