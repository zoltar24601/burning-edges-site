// ============================================================
// HOURLY live pricing for the 2026 WC Sticker pack (/stickers), on the shared
// engine (tools/live-pack.mjs): new chain sales reprice it, new chain pulls
// reduce copies left from Panini's collection report (ck.report_ts).
// Model: tools/stickers-model.mjs. Rules, overrides, copies and the pack market
// snapshot: data/stickers26-checklist.json (updated by hand, then pushed).
// Env (Netlify): SUPABASE_URL, SUPABASE_SERVICE_KEY. Table: migrations/011.
// ============================================================
import { runLivePack, respond } from "../../tools/live-pack.mjs";
import { stickersModel, applyPulls } from "../../tools/stickers-model.mjs";
import ck from "../../data/stickers26-checklist.json";
import seed from "../../data/stickers26-sales.json";
import cards from "../../data/stickers26-cards.json";

export const config = { schedule: "@hourly" };
const KEEP_MS = 72 * 3600 * 1000;   // prune: last 72h + newest 10 per card + post-burn Silvers
const notable = new Set(ck.cards.map(c => c.a + "|" + c.p));

export default async () => {
  try {
    return respond(await runLivePack({
      product: "stickers26", prefix: "packcard-850180", pullsFrom: ck.report_ts,
      seedLog: () => seed.sales.map(({ a, p, serial, run, price, date, tags }) => ({ a, p, serial, run, price, date: date.slice(0, 19), tags })),
      saleKey: x => [x.a, x.p, x.serial, x.date].join("|"),
      mapSale: e => {
        const m = cards[e.sku_base.replace("packcard-850180_", "")];
        if (!m || (m[1] !== "Silver" && !notable.has(m[0] + "|" + m[1]))) return null;   // the model only reads these
        return { a: m[0], p: m[1], serial: e.serial, run: e.run, price: Number(e.price), date: e.ts.slice(0, 19),
                 tags: e.run > 1 && e.serial === 1 ? "number 1" : e.run > 1 && e.serial === e.run ? "perfect mint" : "" };
      },
      prune: log => {
        const keepFrom = new Date(Date.now() - KEEP_MS).toISOString().slice(0, 19);
        const sbSince = ck.rules?.silver_burn?.since || "9999", perCard = {};
        return log.sort((a, b) => b.date.localeCompare(a.date)).filter(x => {
          const k = x.a + "|" + x.p; perCard[k] = (perCard[k] || 0) + 1;
          return x.date >= keepFrom || perCard[k] <= 10 || (x.p === "Silver" && x.date >= sbSince);
        });
      },
      compute: (st, pricedAt) => stickersModel(applyPulls(ck, st, cards), st.log, seed.window_from, pricedAt, true),
    }));
  } catch (e) { return respond({ status: 500, body: { error: String(e) } }); }
};
