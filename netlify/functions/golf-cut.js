// Burning Edges — Golf cut-survival. Route: /api/golf-cut
// Computes a field distribution PER CONTEST (up to 3) against shared DataGolf
// make-cut odds. Throttled so public traffic never hits the DataGolf rate limit.
// Env: DATAGOLF_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
const THROTTLE_MIN = 30;

export async function handler(event) {
  const params = event.queryStringParameters || {};
  const force = params.force === "1";
  const mode = (params.mode || "predicted").toLowerCase();
  const DG_KEY = process.env.DATAGOLF_KEY, SB_URL = process.env.SUPABASE_URL, SB_KEY = process.env.SUPABASE_SERVICE_KEY;
  if (!DG_KEY || !SB_URL || !SB_KEY) return json(500, { error: "Server not fully configured (missing env vars)." });

  try {
    const latest = await sbLatest(SB_URL, SB_KEY, "golf_distribution", "computed_at");
    const latestHasData = latest && Array.isArray(latest.dists) && latest.dists.some(d => d.n > 0);
    if (latest && latestHasData && !force) {
      const ageMin = (Date.now() - new Date(latest.computed_at).getTime()) / 60000;
      if (ageMin < THROTTLE_MIN && latest.mode === mode) return json(200, { ...latest, cached: true, age_min: Math.round(ageMin) });
    }
    const ev = await sbLatest(SB_URL, SB_KEY, "golf_event", "uploaded_at");
    if (!ev || !Array.isArray(ev.contests) || !ev.contests.length) {
      if (latest) return json(200, { ...latest, cached: true, note: "no lineups; serving last result" });
      return json(200, { dists: [], event_name: "", mode, note: "No lineups uploaded yet." });
    }
    const dg = await fetchDataGolf(DG_KEY, ev.tour || "pga");
    const lookup = buildLookup(dg.players);

    const allUnmatched = new Set();
    const dists = ev.contests.map(c => {
      const r = (mode === "final") ? fieldFinal(c.entries, lookup) : fieldPredicted(c.entries, lookup);
      r.unmatched.forEach(u => allUnmatched.add(u));
      return { label: c.label, dist: r.dist, n: r.n };
    });

    const row = {
      event_name: dg.event_name || ev.event_name || "",
      mode, dists,
      dg_source: dg.source, dg_last_update: dg.last_update || "",
      unmatched: [...allUnmatched].slice(0, 50),
      computed_at: new Date().toISOString(),
    };
    await sbInsert(SB_URL, SB_KEY, "golf_distribution", row);
    return json(200, { ...row, cached: false });
  } catch (err) {
    return json(500, { error: String(err && err.message || err) });
  }
}

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

function stripAccents(s){ return (s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,""); }
// tokens of a name, lowercased, de-accented, punctuation removed, suffixes dropped
function nameTokens(name){
  let s=stripAccents(name||"").toLowerCase().replace(/,/g," ").replace(/[^a-z ]/g," ");
  return s.split(/\s+/).filter(Boolean).filter(x=>!["jr","sr","ii","iii","iv"].includes(x));
}
// full normalized key (sorted tokens) — order-independent so "Last, First" == "First Last"
function normKey(name){ return nameTokens(name).sort().join(" "); }
// last name + first initial key. DataGolf is "Last, First" so last name is the
// token before the comma; DK is "First Last" so last name is the final token.
// We compute BOTH possible (initial+last) forms and index/lookup on the set.
function lastInitialKeys(name){
  const raw=(name||"");
  const hasComma=raw.includes(",");
  const toks=nameTokens(name);
  if(toks.length<2) return [];
  let last, first;
  if(hasComma){
    // "Last, First [Mid]" -> first token is last name
    last=toks[0]; first=toks[1];
  } else {
    // "First [Mid] Last" -> last token is last name
    last=toks[toks.length-1]; first=toks[0];
  }
  // also produce the reverse interpretation as a safety net (covers odd orderings)
  const altLast=toks[toks.length-1], altFirst=toks[0];
  const keys=new Set();
  keys.add(last+" "+first[0]);
  keys.add(altLast+" "+altFirst[0]);
  return [...keys];
}

// Build a lookup from DataGolf players. primary: full-key -> mc.
// secondary: lastInitial-key -> {mc, count} (count tracks collisions).
function buildLookup(players){
  const primary=new Map();
  const secondary=new Map();
  for(const p of players){
    const mc=p.make_cut;
    primary.set(normKey(p.player_name), mc);
    for(const lk of lastInitialKeys(p.player_name)){
      const cur=secondary.get(lk);
      if(cur){ cur.count++; /* collision — keep first mc but mark ambiguous */ }
      else secondary.set(lk, {mc, count:1});
    }
  }
  return {primary, secondary};
}

// Resolve a DK lineup name to a make-cut prob. Returns {mc} or null (unmatched).
function resolve(lookup, name){
  const fk=normKey(name);
  if(lookup.primary.has(fk)) return lookup.primary.get(fk);
  // fallback: last name + first initial, only if unambiguous (count===1)
  for(const lk of lastInitialKeys(name)){
    const hit=lookup.secondary.get(lk);
    if(hit && hit.count===1) return hit.mc;
  }
  return null;
}

function poissonBinomial(probs){ let dist=[1.0]; for(let p of probs){ p=Math.max(0,Math.min(1,p)); const nx=new Array(dist.length+1).fill(0); for(let k=0;k<dist.length;k++){ nx[k]+=dist[k]*(1-p); nx[k+1]+=dist[k]*p; } dist=nx; } return dist; }
function fieldPredicted(entries, lookup){ const unmatched=new Set(); const acc=new Array(7).fill(0); let n=0; for(const e of entries){ const lu=e.lineup; if(!Array.isArray(lu)||lu.length!==6)continue; const ps=lu.map(name=>{const mc=resolve(lookup,name);if(mc!=null)return mc;unmatched.add(name);return 0;}); const d=poissonBinomial(ps); for(let k=0;k<7;k++)acc[k]+=d[k]; n++; } if(n===0)return{dist:new Array(7).fill(0),unmatched,n:0}; return{dist:acc.map(v=>+(v/n*100).toFixed(2)),unmatched,n}; }
function fieldFinal(entries, lookup){ const unmatched=new Set(); const counts=new Array(7).fill(0); let n=0; for(const e of entries){ const lu=e.lineup; if(!Array.isArray(lu)||lu.length!==6)continue; let s=0; for(const name of lu){const mc=resolve(lookup,name);if(mc==null){unmatched.add(name);continue;}if(mc>=0.5)s++;} counts[s]++; n++; } if(n===0)return{dist:new Array(7).fill(0),unmatched,n:0}; return{dist:counts.map(v=>+(v/n*100).toFixed(2)),unmatched,n}; }

async function sbLatest(url, key, table, orderCol){ const r=await fetch(`${url}/rest/v1/${table}?select=*&order=${orderCol}.desc&limit=1`,{headers:{apikey:key,Authorization:`Bearer ${key}`}}); if(!r.ok)throw new Error(`Supabase select ${table} ${r.status}`); const rows=await r.json(); return rows[0]||null; }
async function sbInsert(url, key, table, row){ const r=await fetch(`${url}/rest/v1/${table}`,{method:"POST",headers:{apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json",Prefer:"return=minimal"},body:JSON.stringify(row)}); if(!r.ok){const t=await r.text();throw new Error(`Supabase insert ${table} ${r.status} ${t}`);} }
function json(s, b){ return { statusCode:s, headers:{"Content-Type":"application/json","Access-Control-Allow-Origin":"*","Cache-Control":"public, max-age=60"}, body:JSON.stringify(b) }; }
