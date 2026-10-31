#!/usr/bin/env python3
# ============================================================
# Render the static pack pages for the three packs priced 2026-10:
#   prizmwc22.html  -- 2022 Prizm FIFA WC (block-point store pack)
#   mosaic22.html   -- 2022 Mosaic Road to World Cup (Spend Promo reward pack)
#   stickers.html   -- 2026 Prizm FIFA WC Stickers
# Fills tools/packpage-template.html with each pack's model output as the BAKED
# fallback. The models are JS (tools/stickers-model.mjs, tools/card-pack-model.mjs)
# and also run hourly live (netlify/functions/*-refresh.mjs, tools/live-pack.mjs).
# Market snapshots: data/stickers26-checklist.json (pack) + data/pack-markets.json.
# Run from repo root:  python tools/build-pack-pages.py
# ============================================================
import json, os, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = lambda *a: os.path.join(ROOT, *a)
TEMPLATE = open(P("tools", "packpage-template.html"), encoding="utf-8").read()
money = lambda n: "$" + (f"{n:,.0f}" if n >= 100 else f"{n:,.2f}")


def render(fname, nav_key, title, accent, data):
    html = TEMPLATE.replace("__TITLE__", title).replace("__ACCENT__", accent)
    for k in ("prizmwc22", "mosaic22", "stickers"):
        html = html.replace(f"__NAV_{k}__", ' class="active"' if k == nav_key else "")
    html = html.replace("__DATA__", json.dumps(data, ensure_ascii=True))
    open(P(fname), "w", encoding="utf-8").write(html)
    print("wrote", fname, "| book", money(data["book"]))


# ---------- 2022 Prizm WC (BP store) + 2022 Mosaic Road to World Cup ----------
# Model lives in tools/card-pack-model.mjs, shared with the hourly refreshes
# (netlify/functions/{prizmwc22,mosaic22}-refresh.mjs -> /api/pack-live). This
# bakes its output as the fallback the pages show until live data loads.
# Cards/copies: data/<product>-cards.json; market snapshot: data/pack-markets.json.
node_payload = lambda *a: json.loads(subprocess.run(["node", *a], capture_output=True, encoding="utf-8", check=True).stdout)
render("prizmwc22.html", "prizmwc22", "2022 Prizm World Cup Pack", "#e8c468", node_payload(P("tools", "card-pack-build.mjs"), "prizmwc22"))
render("mosaic22.html", "mosaic22", "2022 Mosaic Road to World Cup Pack", "#b89be0", node_payload(P("tools", "card-pack-build.mjs"), "mosaic22"))

# ---------- 2026 Prizm FIFA WC Stickers ----------
# The model lives in tools/stickers-model.mjs, shared with the hourly refresh
# (netlify/functions/stickers-refresh.mjs -> /api/stickers-data). This bakes its
# output into stickers.html as the fallback the page shows until live data loads.
# Edit rules/overrides/copies in data/stickers26-checklist.json.
render("stickers.html", "stickers", "2026 World Cup Sticker Pack", "#5ed68a", node_payload(P("tools", "stickers-build.mjs")))
