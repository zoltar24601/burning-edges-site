# Burning Edges - Site (burningedgesdfs.com)

Multi-sport DFS analytics site. Vanilla HTML/CSS/JS, no build step, no framework.

## Deploy
- Netlify continuous deploy from this repo's main branch (site: eclectic-tapioca-1cf6a9).
- Every push to main auto-deploys in ~10s. There is NO manual zip/drag-drop deploy.
- Serverless functions live in netlify/functions/ (must have .js extension or Netlify ignores them).
- Routes/redirects are in netlify.toml (includes /mlb, /golf, /uploads, /api/* function routes, and DK/odds proxies - preserve these).

## Pages
- index.html - splash/landing (two cards: golf + MLB)
- mlb.html - the full MLB DFS app (~7,000+ lines, single file). Edit surgically; never truncate.
- golf.html - public golf cut-probability page (50/50 split: field graphic + Find My Lineup calculator)
- uploads.html - private hub for DK golf CSV uploads (dictionary-encodes + gzips large uploads)
- fg-upload.html / fd-upload.html / admin.html - private tools

## Backend
- Supabase project rklfzqqusainitumsvta.supabase.co
- Golf tables: golf_event (compact dict+index lineup storage), golf_distribution (cached field dists), golf_lookups (private analytics log)
- MLB tables read by app: edge_matchup_cache, edge_hot_history, edge_pitcher_cache, edge_catcher_cache, edge_player_status, edge_park_factors, edge_projection_log, edge_prop_bets
- Netlify env vars: DATAGOLF_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY (functions only; never expose in client code)
- DataGolf rate limit: 45 req/min. Public golf page NEVER calls DataGolf directly - golf-cut function throttles with a 30-min cache.

## Style
- Pine-green theme (--bg #061F18, --panel #0A2B21, --neon #B8F04A), Barlow Condensed headers
- Logo: red flag + baseball on cup

## Working rules
- Fix root causes, not band-aids. QA before declaring done. One feature at a time; confirm before proceeding.
- Keep code ASCII-only in comments (em-dashes have corrupted pastes before).
- mlb.html is huge: prefer targeted edits over full rewrites; verify file ends with </html> after any large edit.
