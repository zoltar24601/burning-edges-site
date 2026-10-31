// Prints the sticker page payload (baked fallback for stickers.html) as JSON.
// Called by tools/build-pack-pages.py; the live page gets the same model hourly
// from netlify/functions/stickers-refresh.mjs.
import { readFileSync } from "node:fs";
import { stickersModel } from "./stickers-model.mjs";
const load = f => JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), "utf8"));
const sales = load("stickers26-sales.json");
process.stdout.write(JSON.stringify(stickersModel(load("stickers26-checklist.json"), sales.sales, sales.window_from)));
