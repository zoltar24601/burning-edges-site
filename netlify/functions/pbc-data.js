// ============================================================
//  Burning Edges — PBC data serverless function
//  Route: /api/pbc-data
// ============================================================
// Serves the latest pack snapshot + valuer data from Supabase
// so packs.html and value.html can fetch live instead of having
// data baked in.
//
// Query params:
//   type = calc   (default) → pack analytics payload
//        = valuer          → value-my-card cards + comps
//        = both            → { calc, valuer }
//
// Env vars required (Netlify dashboard → Environment variables):
//   SUPABASE_URL          https://rklfzqqusainitumsvta.supabase.co
//   SUPABASE_SERVICE_KEY  service_role key (server-side only)

export async function handler(event) {
  const SB_URL = process.env.SUPABASE_URL;
  const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) {
    return json(500, { error: "Server not configured (missing Supabase env vars)." });
  }

  const type = (event.queryStringParameters?.type || "calc").toLowerCase();

  try {
    // pull the newest snapshot row
    const url = `${SB_URL}/rest/v1/pbc_snapshots?select=payload,valuer,computed_at&order=computed_at.desc&limit=1`;
    const res = await fetch(url, {
      headers: {
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
      },
    });
    if (!res.ok) return json(502, { error: "Supabase read failed", status: res.status });
    const rows = await res.json();
    if (!rows.length) return json(404, { error: "No snapshot found." });

    const snap = rows[0];
    if (type === "calc")   return json(200, snap.payload);
    if (type === "valuer") return json(200, snap.valuer);
    return json(200, { calc: snap.payload, valuer: snap.valuer, computed_at: snap.computed_at });
  } catch (e) {
    return json(500, { error: String(e) });
  }
}

function json(status, body) {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300", // 5-min CDN cache
    },
    body: JSON.stringify(body),
  };
}
