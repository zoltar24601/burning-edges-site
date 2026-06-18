// Burning Edges - "Find my lineup" lookup. Route: /api/golf-lookup?user=NAME
// Finds a DK username's entries in the stored event, computes each lineup's
// cut-survival odds against the cached DataGolf make-cut probabilities,
// returns them ranked by expected survivors (desc).
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, DATAGOLF_KEY

export async function handler(event) {
  const params = event.queryStringParameters || {};
  const user = (params.user || "").trim();
  if (!user) return json(400, { error: "No username provided" });

  const SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY, DG_KEY = process.env.DATAGOLF_KEY;
  if (!SB_URL || !SB_KEY || !DG_KEY) return json(500, { error: "Server not configured." });

  try {
    const ev = await sbLatest(SB_URL, SB_KEY, "golf_event", "uploaded_at");
    if (!ev || !Array.isArray(ev.contests) || !ev.contests.length) {
      return json(200, { found: false, note: "No contest data uploaded yet." });
    }

    // collect this user's entries across all contests (case-insensitive exact match)
    // Compact form: entry = {n:name, l:[indices]} + shared ev.dict.
    // Legacy form: entry = {name, lineup:[names]}.
    const dict = Array.isArray(ev.dict) ? ev.dict : null;
    const target = user.toLowerCase();
    const matches = [];
    for (const c of ev.contests) {
      for (const e of (c.entries || [])) {
        const nm = e.n != null ? e.n : e.name;
        if ((nm || "").toLowerCase() === target) {
          const lineup = Array.isArray(e.lineup) ? e.lineup
                        : (dict && Array.isArray(e.l)) ? e.l.map(i => dict[i]) : [];
          matches.push({ contest: c.label, lineup });
        }
      }
    }
    if (!matches.length) {
      // gather a few sample names to help the user see the format
      return json(200, { found: false, user, note: "No lineups found for that username." });
    }

    // get cached make-cut odds (reuse the cached distribution's source pull)
    const dg = await fetchDataGolf(DG_KEY, ev.tour || "pga");
    const lookup = buildLookup(dg.players);

    // compute each lineup
    const results = matches.map(m => {
      const golfers = m.lineup.map(name => {
        const mc = resolve(lookup, name);
        return { name, make_cut: mc, matched: mc != null };
      });
      const probs = golfers.map(g => g.make_cut != null ? g.make_cut : 0);
      const expected = +probs.reduce((a, b) => a + b, 0).toFixed(2);
      const dist = poissonBinomial(probs).map(v => +(v * 100).toFixed(1));
      return { contest: m.contest, golfers, expected, dist };
    });

    // rank by expected survivors, desc
    results.sort((a, b) => b.expected - a.expected);

    return json(200, {
      found: true, user, event_name: dg.event_name || ev.event_name || "",
      count: results.length, dg_last_update: dg.last_update || "",
      lineups: results,
    });
  } catch (err) {
    return json(500, { error: String(err && err.message || err) });
  }
}

// ---- DataGolf (same as golf-cut) ----
async function fetchDataGolf(key, tour) {
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
        let mc = row.make_cut; if (row.player_name == null || mc == null) continue;
        mc = Number(mc); if (mc > 1.5) mc = mc / 100;
        players.push({ player_name: row.player_name, make_cut: mc });
      }
      if (players.length) return { players, source: source === "in-play" ? "inplay" : "pretournament", event_name: info.event_name || "", last_update: info.last_update || "" };
    } catch (e) {}
  }
  throw new Error("DataGolf returned no usable data (event may not be live).");
}

// ---- name matching (same as golf-cut) ----
function stripAccents(s){ return (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,""); }
function nameTokens(name){ let s=stripAccents(name||"").toLowerCase().replace(/,/g," ").replace(/[^a-z ]/g," "); return s.split(/\s+/).filter(Boolean).filter(x=>!["jr","sr","ii","iii","iv"].includes(x)); }
function normKey(name){ return nameTokens(name).sort().join(" "); }
function lastInitialKeys(name){ const raw=(name||""); const hasComma=raw.includes(","); const toks=nameTokens(name); if(toks.length<2)return []; let last,first; if(hasComma){last=toks[0];first=toks[1];}else{last=toks[toks.length-1];first=toks[0];} const altLast=toks[toks.length-1],altFirst=toks[0]; const keys=new Set(); keys.add(last+" "+first[0]); keys.add(altLast+" "+altFirst[0]); return [...keys]; }
function buildLookup(players){ const primary=new Map(); const secondary=new Map(); for(const p of players){ const mc=p.make_cut; primary.set(normKey(p.player_name),mc); for(const lk of lastInitialKeys(p.player_name)){ const cur=secondary.get(lk); if(cur){cur.count++;}else secondary.set(lk,{mc,count:1}); } } return {primary,secondary}; }
function resolve(lookup,name){ const fk=normKey(name); if(lookup.primary.has(fk))return lookup.primary.get(fk); for(const lk of lastInitialKeys(name)){ const hit=lookup.secondary.get(lk); if(hit&&hit.count===1)return hit.mc; } return null; }
function poissonBinomial(probs){ let dist=[1.0]; for(let p of probs){ p=Math.max(0,Math.min(1,p)); const nx=new Array(dist.length+1).fill(0); for(let k=0;k<dist.length;k++){ nx[k]+=dist[k]*(1-p); nx[k+1]+=dist[k]*p; } dist=nx; } return dist; }

async function sbLatest(url, key, table, orderCol){ const r=await fetch(`${url}/rest/v1/${table}?select=*&order=${orderCol}.desc&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`}}); if(!r.ok)throw new Error(`Supabase select ${table} ${r.status}`); const rows=await r.json(); return rows[0]||null; }
function json(s, b){ return { statusCode:s, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Cache-Control":"public, max-age=120"}, body:JSON.stringify(b) }; }
