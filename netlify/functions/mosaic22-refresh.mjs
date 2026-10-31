// ============================================================
// HOURLY live pricing for the 2022 Mosaic Road to World Cup pack (/mosaic22), on the shared
// engine (tools/live-pack.mjs): new own-set chain sales reprice the cards, new
// chain pulls reduce copies left from the collection report.
// Model: tools/card-pack-model.mjs. Cards/copies: data/mosaic22-cards.json.
// Env (Netlify): SUPABASE_URL, SUPABASE_SERVICE_KEY. Table: stickers_snapshots.
// ============================================================
import { runLivePack, respond } from "../../tools/live-pack.mjs";
import { cardPackPage } from "../../tools/card-pack-model.mjs";
import deck from "../../data/mosaic22-cards.json";
import seed from "../../data/mosaicrtwc22-sales.json";

export const config = { schedule: "@hourly" };

export default async () => {
  try {
    return respond(await runLivePack({
      product: "mosaic22", prefix: "packcard-1605", pullsFrom: deck.pulls_from,
      seedLog: () => seed.map(s => ({ k: s.sku_base, serial: s.serial, run: s.run, price: Number(s.price), date: s.ts.slice(0, 19) })),
      saleKey: x => [x.k, x.serial, x.date].join("|"),
      mapSale: e => ({ k: e.sku_base, serial: e.serial, run: e.run, price: Number(e.price), date: e.ts.slice(0, 19) }),
      compute: (st, pricedAt) => cardPackPage("mosaic22", deck.cards, st.log, { pulled: st.pulled, pricedAt,
        liveNote: `report ${deck.report_date} minus chain pulls since Oct 28` }),
    }));
  } catch (e) { return respond({ status: 500, body: { error: String(e) } }); }
};
