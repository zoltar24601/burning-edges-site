// Burning Edges — Golf lineup uploader (private). Route: /api/golf-upload (POST)
// Accepts a gzipped, dictionary-encoded payload (handles 100K+ lineups).
// Stores the COMPACT encoded form in Supabase (dict + index arrays) to keep
// the row small; the cut/lookup functions decode in-memory.
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY
import { gunzipSync } from "zlib";

export async function handler(event) {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!SB_URL || !SB_KEY) return json(500, { error: "Server not configured." });

  let body;
  try {
    // Body may be gzipped (large uploads) or plain JSON (small/legacy).
    // Detect gzip by magic bytes (0x1f 0x8b) rather than trusting headers,
    // since proxies can rewrite Content-Encoding.
    let raw = event.body || "";
    let buf = event.isBase64Encoded ? Buffer.from(raw, "base64")
            : Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
    const isGzip = buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b;
    if (isGzip) {
      body = JSON.parse(gunzipSync(buf).toString("utf8"));
    } else {
      body = JSON.parse(buf.toString("utf8"));
    }
  } catch (e) {
    return json(400, { error: "Could not read payload: " + e.message });
  }

  // New compact form: body.encoded = { dict:[names], contests:[{label, entries:[{n,l:[6 idx]}]}] }
  const encoded = body.encoded;
  if (!encoded || !Array.isArray(encoded.dict) || !Array.isArray(encoded.contests)) {
    return json(400, { error: "Missing encoded contest data" });
  }
  // light validation: ensure each entry has 6 indices
  let totalValid = 0;
  const contests = encoded.contests.slice(0, 3).map(c => {
    const entries = (c.entries || []).filter(e => Array.isArray(e.l) && e.l.length === 6);
    totalValid += entries.length;
    return { label: c.label || "Contest", entries };
  }).filter(c => c.entries.length);
  if (!totalValid) return json(400, { error: "No valid 6-golfer lineups found" });

  const row = {
    event_name: body.event_name || "",
    tour: body.tour || "pga",
    cut_rule: body.cut_rule || "TOP 65 & TIES",
    contests,                 // compact: entries are {n, l:[idx]}
    dict: encoded.dict,       // shared golfer-name dictionary
    uploaded_at: new Date().toISOString(),
  };

  try {
    const r = await fetch(`${SB_URL}/rest/v1/golf_event`, {
      method: "POST",
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!r.ok) { const t = await r.text(); throw new Error(`${r.status} ${t}`); }
    return json(200, { ok: true, contests: contests.map(c => ({ label: c.label, n: c.entries.length })) });
  } catch (err) {
    return json(500, { error: String(err && err.message || err) });
  }
}
function json(s, b){ return { statusCode:s, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*"}, body:JSON.stringify(b) }; }
