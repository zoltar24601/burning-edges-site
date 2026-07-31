#!/usr/bin/env python3
# ============================================================
# BURNING EDGES — PBC PRICING ENGINE  (portable, self-contained)
# 2026 Panini NFT Prizm World Cup Soccer
#
# Usage:
#   python3 pbc_engine.py <sales_db.json> <report.csv> <base_packs> <fotl_packs>
#
# Inputs:
#   sales_db.json : {"sales":[{"a","s","run","serial","price","premium"}...]}  (raw, may contain transfers)
#   report.csv    : Panini collection report (uses the UNCLAIMED column)
#   base_packs    : integer you type in each update (NOT derived from report)
#   fotl_packs    : integer you type in each update
#
# Outputs (written next to this script):
#   calc_data.json         -> the DATA block for packs.html
#   valuer_data_v2.json    -> the DATA block for value.html {cards, comps}
#   pbc_snapshot_insert.sql-> Supabase snapshot insert
#
# Then a separate builder injects calc_data.json into packs.html and
# valuer_data_v2.json into value.html (see build_pages.py).
# ============================================================
import csv, json, sys
from datetime import date
from collections import defaultdict

SALES_JSON = sys.argv[1] if len(sys.argv) > 1 else 'burning_edges_sales_db.json'
REPORT_CSV = sys.argv[2] if len(sys.argv) > 2 else 'report.csv'
BASE_PACKS = int(sys.argv[3]) if len(sys.argv) > 3 else 18476
FOTL_PACKS = int(sys.argv[4]) if len(sys.argv) > 4 else 5365

# ---------- LOAD SALES ----------
_raw = json.load(open(SALES_JSON))['sales']
allsales = [{'athlete': s['a'], 'cardset': s['s'], 'run': s['run'],
             'serial': (s['serial'], s['run']), 'price': s['price'],
             'premium': s['premium']} for s in _raw]

# ---------- GLOBAL DEDUP ----------
# Rolling-window sales files overlap heavily. Key on identifying fields.
_seen = set(); _dd = []
for s in allsales:
    kk = (s['athlete'], s['cardset'], s['serial'][0] if s.get('serial') else None,
          round(s['price']), s['premium'])
    if kk in _seen: continue
    _seen.add(kk); _dd.append(s)
allsales = _dd

# ---------- TRANSFER FILTER ----------
# Panini has a 7-day gift lock, so people do $1 "sales" to move cards between
# their own accounts. These pollute medians on high-floor chase cards. Drop them.
def _is_transfer(s):
    p = s['price']; run = s['run']; cs = s['cardset'].lower()
    if p <= 5: return True                                  # near-zero = transfer
    chase = ('black' in cs or 'nebula' in cs or 'gold' in cs)
    if run == 1 and chase and p < 30: return True           # a 1/1 chase under $30
    if run <= 5 and chase and p < 15: return True           # low-run chase, absurdly cheap
    return False
allsales = [s for s in allsales if not _is_transfer(s)]

# Optional offers file (5th arg). The 6-22 snapshot is stale; sales beat offers for
# all but mega 1/1s. Include it only if you want to reproduce the pre-July live numbers.
# Without it, EV is ~$18 lower and (arguably) more honest.
offer_lk = {}
OFFERS_JSON = sys.argv[5] if len(sys.argv) > 5 else None
if OFFERS_JSON:
    for o in json.load(open(OFFERS_JSON))['offers']:
        k = (o['a'], o['s'], o['run']); offer_lk[k] = max(offer_lk.get(k, 0), o['best'])

# ---------- TIERS & OVERRIDES ----------
MEGA  = {'Lamine Yamal', 'Lionel Messi'}
ELITE = {'Cristiano Ronaldo', 'Diego Maradona', 'Kylian Mbappe', 'Erling Haaland', 'Michael Olise'}

# Megastar base-parallel ladder — anchored to real sales (regular copies)
MEGA_BASE_LADDER = {
    ('Lionel Messi', 'Base Prizms Silver', 259): 190,
    ('Lionel Messi', 'Base Prizms Red', 124): 325,
    ('Lionel Messi', 'Base Prizms Blue', 49): 1200,
    ('Lamine Yamal', 'Base Prizms Silver', 259): 210,
    ('Lamine Yamal', 'Base Prizms Red', 124): 675,
    ('Lamine Yamal', 'Base Prizms Blue', 49): 1000,
}

# Per-serial insert chase cards: regular price + named premium serials
SPECIAL_SERIALS = {
    ('Lionel Messi', 'Base Prizms Cracked Ice', 25): {'reg': 4000, 'specials': {1: 10000, 10: 10000}},
    ('Lamine Yamal', 'Base Prizms Cracked Ice', 25): {'reg': 3750, 'specials': {1: 10000, 19: 10000, 25: 10000}},
    ('Kylian Mbappe', 'Base Prizms Cracked Ice', 25): {'reg': 1150, 'specials': {10: 5000, 25: 5000}},
    ('Lionel Messi', 'Manga', 25): {'reg': 4500, 'specials': {1: 12000, 10: 12000}},
    ('Lamine Yamal', 'Manga', 25): {'reg': 4300, 'specials': {1: 10000, 19: 10000, 25: 10000}},
    ('Cristiano Ronaldo', 'Manga', 25): {'reg': 2100, 'specials': {7: 5000}},
    ('Lionel Messi', 'Color Blast', 25): {'reg': 2000, 'specials': {1: 7000, 10: 7000}},
    ('Lamine Yamal', 'Color Blast', 25): {'reg': 1700, 'specials': {1: 6000, 25: 6000}},
    ('Cristiano Ronaldo', 'National Landmarks Prizms Gold', 10): {'reg': 3000, 'specials': {7: 7777}},
}

GOLD_OVERRIDE   = {('Lamine Yamal', 'Base Prizms Gold', 10): 36000,
                   ('Lionel Messi', 'Base Prizms Gold', 10): 50000}
PERCOPY_OVERRIDE = {('Mohamed Salah', 'Base Prizms Black', 1): 10000,
                    ('Kylian Mbappe', 'Base Prizms Black', 1): 60000,
                    ('Kylian Mbappe', 'Base Choice Prizms Nebula', 1): 60000}

# Gold /10 tier floor: only NAMED stars get a floor; role players fall to normal floor.
def gold_floor(a):
    return 8000 if a in MEGA else (3000 if a in ELITE else None)

# Sanity caps so no single card runs away
def sane_cap(a, cs, run, val):
    ibc = cs in ('Base Prizms Black', 'Base Choice Prizms Nebula')
    if run == 1 and ibc: return min(val, 250000)
    if run == 1:  return min(val, 25000 if a in MEGA else 12000)
    if run <= 7:  return min(val, 15000)
    if run <= 10: return min(val, 40000 if a in MEGA else 15000)
    if run <= 25: return min(val, 12000 if a in MEGA else 6000)
    if run <= 49: return min(val, 3000)
    if run <= 124:return min(val, 1500)
    return min(val, 800)

# ---------- SALES INDEXES ----------
sales_reg = defaultdict(list); sales_prem = defaultdict(list); sales_by_card = defaultdict(list)
for s in allsales:
    sales_by_card[(s['athlete'], s['cardset'], s['run'])].append(s)
    if not s['premium']:
        sales_reg[(s['athlete'], s['cardset'], s['run'])].append(s['price'])
    else:
        sales_prem[(s['athlete'], s['cardset'], s['run'])].append(s['price'])
sales_med      = {k: sorted(v)[len(v)//2] for k, v in sales_reg.items()}
sales_prem_med = {k: sorted(v)[len(v)//2] for k, v in sales_prem.items()}

# ---------- POOLS ----------
FOTL_EXCLUSIVE = {'Base Choice Prizms Nebula', 'Base Prizms Aguila', 'Base Prizms Maple Leaf', 'Base Prizms Old Glory'}
SILVER         = {'Base Prizms Silver'}
NONSILVER_BASE = {'Base Prizms Black', 'Base Prizms Gold', 'Base Prizms Blue', 'Base Prizms Red',
                  'Base Prizms Cracked Ice', 'Base Choice Prizms Zebra'}
def pool_of(cs):
    if cs in FOTL_EXCLUSIVE: return 'fotl'
    if cs in SILVER:         return 'silver'
    if cs in NONSILVER_BASE: return 'nonsilver'
    return 'insert'

# ---------- THE PRICING CASCADE ----------
# Returns (value, method_code, detail_dict). Order matters — first match wins.
def value_with_reason(a, cs, run):
    k = (a, cs, run); csl = cs.lower()

    if k in MEGA_BASE_LADDER:
        return MEGA_BASE_LADDER[k], 'ladder', {'note': 'Consistent recent sales for this base parallel'}

    if k in SPECIAL_SERIALS:
        sp = SPECIAL_SERIALS[k]
        rs = [s for s in sales_by_card.get(k, []) if not s['premium']]
        return sp['reg'], 'serial', {'reg': sp['reg'], 'specials': sp['specials'],
            'sales': [{'n': s['serial'][0], 'p': round(s['price'])}
                      for s in sorted(rs, key=lambda x: -x['price'])[:3]]}

    if k in PERCOPY_OVERRIDE:
        return PERCOPY_OVERRIDE[k], 'manual', {'note': 'Set from recent confirmed sales'}

    if 50 <= run <= 124 and cs == 'Base Prizms Red':
        v = (675.0 if a == 'Lamine Yamal' else 325.0 if a == 'Lionel Messi'
             else 165.0 if a == 'Cristiano Ronaldo' else 2.0)
        return v, ('ladder' if a in MEGA else 'common_unc'), ({'note': 'Recent sales'} if a in MEGA else {})

    if 50 <= run <= 124:
        return (200.0 if a in MEGA else 2.0), ('mega_unc' if a in MEGA else 'common_unc'), {}

    if k in GOLD_OVERRIDE:
        return GOLD_OVERRIDE[k], 'manual', {'note': 'Regular-copy price (premium serials excluded as outliers)'}

    # mega-player 1/1s: sales there are premium-only/thin; skip straight to offer/premest
    mega_top = (a in MEGA and run == 1)

    if k in sales_med and not mega_top:
        v = sane_cap(a, cs, run, sales_med[k])
        if 'gold' in csl and run <= 10 and gold_floor(a): v = max(v, gold_floor(a))
        return v, 'sale', {'median': round(sales_med[k]), 'n': len(sales_reg[k])}

    if k in offer_lk:                       # empty in portable engine, kept for parity
        raw = offer_lk[k]; capped = sane_cap(a, cs, run, raw * 1.25)
        if 'gold' in csl and run <= 10 and gold_floor(a): capped = max(capped, gold_floor(a))
        return capped, 'offer', {'offer': round(raw), 'capped': capped < raw * 1.25}

    if k in sales_med:
        v = sane_cap(a, cs, run, sales_med[k])
        if 'gold' in csl and run <= 10 and gold_floor(a): v = max(v, gold_floor(a))
        return v, 'sale', {'median': round(sales_med[k]), 'n': len(sales_reg[k])}

    # premium-sale fallback: only premium serials sold. For /1, that sale IS the market
    # (a 1/1 is inherently "premium"), so no haircut; for run>1 discount toward regular (x0.66).
    if k in sales_prem_med:
        factor = 1.0 if run == 1 else 0.66
        v = sane_cap(a, cs, run, sales_prem_med[k] * factor)
        if 'gold' in csl and run <= 10 and gold_floor(a): v = max(v, gold_floor(a))
        return (v, ('sale' if run == 1 else 'premest'),
                ({'median': round(sales_prem_med[k]), 'n': len(sales_prem[k])} if run == 1
                 else {'premmed': round(sales_prem_med[k]), 'n': len(sales_prem[k])}))

    # gold /10 tier floor for named stars (before generic floors)
    if 'gold' in csl and run <= 10 and gold_floor(a):
        return float(gold_floor(a)), 'goldfloor', {'tier': 'mega' if a in MEGA else 'elite'}

    # generic rarity floors
    ins = cs not in FOTL_EXCLUSIVE and cs not in SILVER and cs not in NONSILVER_BASE
    neb = 'nebula' in csl; blk = 'black' in csl and 'nebula' not in csl
    if run == 1 and cs == 'Base Prizms Black': return 400.0, 'floor1', {'kind': 'baseblack'}
    if run == 1 and blk: return 200.0, 'floor1', {'kind': 'insertblack'}
    if run == 1:  return float(90 if neb else 18 if ins else 35), 'floor', {}
    if run <= 5:  return float(12 if ins else 22), 'floor', {}
    if run <= 7:  return float(10 if ins else 18), 'floor', {}
    if run <= 10: return float(6 if ins else 12), 'floor', {}
    if run <= 25: return float(5 if ins else 7), 'floor', {}
    if run <= 49: return 3.0, 'floor', {}
    return 1.2, 'floor', {}

def tier(a):      return 'M' if a in MEGA else 'E' if a in ELITE else 'S'
def per_copy(a, cs, run): return value_with_reason(a, cs, run)[0]

# ---------- READ REPORT (UNCLAIMED column) ----------
rows = []
for r in csv.DictReader(open(REPORT_CSV)):
    cs = r['CARD SET'] if 'CARD SET' in r else r['CARDSET']
    rows.append({'a': r['ATHLETE'], 's': cs, 'r': int(r['MINT RUN']), 'u': int(r['UNCLAIMED'])})

# ---------- BUILD PACK DATA (calc_data.json) ----------
# poolCopiesTotal and tail come STRAIGHT from UNCLAIMED — no scaling.
poolc_total = defaultdict(int); allc = []
for r in rows:
    if r['u'] <= 0: continue
    p = pool_of(r['s']); pcv = per_copy(r['a'], r['s'], r['r'])
    poolc_total[p] += r['u']
    allc.append({'a': r['a'], 's': r['s'], 'r': r['r'], 'u': r['u'], 'p': round(pcv, 2), 'pool': p})
allc.sort(key=lambda x: -x['p'] * x['u'])
TOP = 120
top = allc[:TOP]; tail = allc[TOP:]
tail_agg = defaultdict(lambda: {'copies': 0, 'value': 0.0})
for c in tail:
    tail_agg[c['pool']]['copies'] += c['u']; tail_agg[c['pool']]['value'] += c['p'] * c['u']

calc = {'updated': date.today().isoformat(),
        'release': '2026 Panini NFT Prizm World Cup Soccer',
        'mint': 25, 'fotlMint': 150, 'multiplier': 2.5,
        'basePacks': BASE_PACKS, 'fotlPacks': FOTL_PACKS, 'insertOdds': 35,
        'poolCopiesTotal': dict(poolc_total), 'top': top,
        'tail': {k: {'copies': v['copies'], 'value': round(v['value'], 2)} for k, v in tail_agg.items()}}
json.dump(calc, open('calc_data.json', 'w'))

# ---------- BUILD VALUER DATA (valuer_data_v2.json) ----------
cards = []; seen = set()
for r in rows:
    k = (r['a'], r['s'], r['r'])
    if k in seen: continue
    seen.add(k)
    v, method, detail = value_with_reason(r['a'], r['s'], r['r'])
    if v < 5 and tier(r['a']) == 'S': continue     # hide sub-$5 commons of no-name players
    cards.append({'a': r['a'], 's': r['s'], 'r': r['r'], 'v': round(v),
                  't': tier(r['a']), 'm': method, 'd': detail})

# comps: dedup by (athlete,set,run,serial) keeping highest price, keep >= $50
seen2 = {}
for s in allsales:
    kk = (s['athlete'], s['cardset'], s['run'], s['serial'][0])
    if kk not in seen2 or s['price'] > seen2[kk]['price']: seen2[kk] = s
comps = [{'a': s['athlete'], 's': s['cardset'], 'r': s['run'], 'n': s['serial'][0],
          'p': round(s['price']), 'x': 1 if s['premium'] else 0}
         for s in seen2.values() if s['price'] >= 50]
comps.sort(key=lambda x: -x['p'])
json.dump({'cards': cards, 'comps': comps}, open('valuer_data_v2.json', 'w'), separators=(',', ':'))

# ---------- POOL EV MATH ----------
def ev():
    v = defaultdict(float); c = defaultdict(int)
    for card in top:
        v[card['pool']] += card['p'] * card['u']; c[card['pool']] += card['u']
    for p, info in tail_agg.items():
        v[p] += info['value']; c[p] += info['copies']
    per = {k: (v[k] / c[k] if c[k] else 0) for k in ['silver', 'nonsilver', 'insert', 'fotl']}
    base = 2 * per['silver'] + per['nonsilver'] + (0.65 * per['nonsilver'] + 0.35 * per['insert'])
    fotl = v['fotl'] / FOTL_PACKS + base
    return base, fotl
base_book, fotl_book = ev()

# ---------- SNAPSHOT SQL ----------
def esc(s): return json.dumps(s).replace("'", "''")
sql = f"""-- PBC snapshot ({BASE_PACKS} base / {FOTL_PACKS} FOTL, {calc['updated']}). Run in Supabase.
insert into pbc_snapshots
  (release, base_packs, fotl_packs, base_book, fotl_book, base_mint, fotl_mint, multiplier, payload, valuer)
values (
  '2026 Panini NFT Prizm World Cup Soccer',
  {BASE_PACKS}, {FOTL_PACKS}, {round(base_book,2)}, {round(fotl_book,2)},
  25, 150, 2.5,
  '{esc(calc)}'::jsonb, '{esc({'cards':cards,'comps':comps})}'::jsonb
);
"""
open('pbc_snapshot_insert.sql', 'w').write(sql)

print(f"BASE book ${base_book:.2f} -> predicted ~${base_book*2.5:.0f}")
print(f"FOTL book ${fotl_book:.2f} -> predicted ~${fotl_book*2.5:.0f}")
print(f"Cards: {len(cards)} | Comps: {len(comps)} | Sales used: {len(allsales)}")
print("Wrote: calc_data.json, valuer_data_v2.json, pbc_snapshot_insert.sql")
