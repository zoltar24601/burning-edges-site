// Burning Edges — Golf lineup uploader (private). Route: /api/golf-upload (POST)
// Stores up to 3 labeled contests (each with entries: {name, lineup[6]}).
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return json(500, { error: "Server not configured." });

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return json(400, { error: "Invalid JSON body" }); }

  const contests = body.contests;
  if (!Array.isArray(contests) || !contests.length) return json(400, { error: "No contests provided" });

  // validate/normalize each contest
  const clean = [];
  for (const c of contests.slice(0, 3)) {
    const entries = (c.entries || []).filter(e => Array.isArray(e.lineup) && e.lineup.length === 6);
    if (entries.length) clean.push({ label: c.label || "Contest", entries });
  }
  if (!clean.length) return json(400, { error: "No valid 6-golfer lineups found" });

  const row = {
    event_name: body.event_name || "",
    tour: body.tour || "pga",
    cut_rule: body.cut_rule || "TOP 65 & TIES",
    contests: clean,
    uploaded_at: new Date().toISOString(),
  };

  try {
    const r = await fetch(`${SB_URL}/rest/v1/golf_event`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!r.ok) { const t = await r.text(); throw new Error(`${r.status} ${t}`); }
    return json(200, { ok: true, contests: clean.map(c => ({ label: c.label, n: c.entries.length })) });
  } catch (err) {
    return json(500, { error: String(err && err.message || err) });
  }
}
function json(s, b){ return { statusCode:s, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}, body:JSON.stringify(b) }; }
