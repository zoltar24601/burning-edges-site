// Prints a 2022 pack page payload (baked fallback) as JSON: node card-pack-build.mjs <prizmwc22|mosaic22>
// Called by tools/build-pack-pages.py; the live pages get the same model hourly.
import { readFileSync } from "node:fs";
import { cardPackPage } from "./card-pack-model.mjs";
const load = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));
const product = process.argv[2];
const seed = load(product === "prizmwc22" ? "prizmwc22-sales.json" : "mosaicrtwc22-sales.json");
process.stdout.write(JSON.stringify(cardPackPage(product, load(`${product}-cards.json`).cards,
  seed.map(s => ({ k: s.sku_base, price: s.price })), { market: load("pack-markets.json")[product] })));
