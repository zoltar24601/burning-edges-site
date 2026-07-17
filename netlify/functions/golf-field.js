// Burning Edges - Golf live field feed. Route: /api/golf-field
// Returns the raw DataGolf in-play field (positions, scores, cut/win/top-N
// odds) for the current event. Falls back to pre-tournament odds when the
// event is not live (live-only fields come back null).
// Throttle: module-scope cache serves repeat calls for CACHE_MIN minutes so
// public traffic never hits the 45 req/min DataGolf limit. Deliberately NOT
// cached in golf_distribution - golf-cut.js reads that table's latest row
// and a field row there would break its own cache lookup.
// Env: DATAGOLF_KEY
const CACHE_MIN = 5;

// Survives across invocations while the function container stays warm.
// Cold starts just refetch, which is fine for the rate limit.
let memCache = null; // { key, fetched_at, payload }

export async function handler(event) {
  const params = event.queryStringParameters || {};
  const force = params.force === "1";
  const tour = (params.tour || "pga").toLowerCase().replace(/[^a-z]/g, "");
  const DG_KEY = process.env.DATAGOLF_KEY;
  if (!DG_KEY) return json(500, { error: "Server not fully configured (missing DATAGOLF_KEY)." });

  const cacheKey = "field_" + tour;
  if (memCache && memCache.key === cacheKey && !force) {
    const ageMin = (Date.now() - memCache.fetched_at) / 60000;
    if (ageMin < CACHE_MIN) {
      return json(200, { ...memCache.payload, cached: true, age_min: Math.round(ageMin * 10) / 10 });
    }
  }

  try {
    const payload = await fetchField(DG_KEY, tour);
    memCache = { key: cacheKey, fetched_at: Date.now(), payload };
    return json(200, { ...payload, cached: false });
  } catch (err) {
    // Serve a stale copy rather than an error if we have one.
    if (memCache && memCache.key === cacheKey) {
      return json(200, { ...memCache.payload, cached: true, stale: true, note: "DataGolf fetch failed; serving last copy." });
    }
    return json(500, { error: String(err && err.message || err) });
  }
}

// Same source pattern as golf-cut.js fetchDataGolf: try in-play first,
// fall back to pre-tournament baseline when the event is not live.
async function fetchField(key, tour) {
  for (const source of ["in-play", "pre-tournament"]) {
    const url = source === "in-play"
      ? `https://feeds.datagolf.com/preds/in-play?tour=${tour}&dead_heat=no&odds_format=percent&file_format=json&key=${key}`
      : `https://feeds.datagolf.com/preds/pre-tournament?tour=${tour}&odds_format=percent&file_format=json&key=${key}`;
    try {
      const r = await fetch(url); if (!r.ok) continue;
      const p = await r.json();
      let rows = [], info = {};
      if (Array.isArray(p.data)) { rows = p.data; info = p.info || {}; }
      else if (Array.isArray(p.baseline)) { rows = p.baseline; info = { event_name: p.event_name, last_update: p.last_updated }; }
      const players = [];
      for (const row of rows) {
        if (row.player_name == null) continue;
        players.push({
          player_name: row.player_name,
          current_pos: row.current_pos != null ? row.current_pos : null,
          current_score: row.current_score != null ? row.current_score : null,
          thru: row.thru != null ? row.thru : null,
          today: row.today != null ? row.today : null,
          make_cut: row.make_cut != null ? Number(row.make_cut) : null,
          win: row.win != null ? Number(row.win) : null,
          top_5: row.top_5 != null ? Number(row.top_5) : null,
          top_10: row.top_10 != null ? Number(row.top_10) : null,
          top_20: row.top_20 != null ? Number(row.top_20) : null,
        });
      }
      if (players.length) {
        return {
          players,
          source: source === "in-play" ? "inplay" : "pretournament",
          event_name: info.event_name || "",
          last_update: info.last_update || "",
        };
      }
    } catch (e) {}
  }
  throw new Error("DataGolf returned no usable data (event may not be live).");
}

function json(s, b) {
  return {
    statusCode: s,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
    },
    body: JSON.stringify(b),
  };
}
