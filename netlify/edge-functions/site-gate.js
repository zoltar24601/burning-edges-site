// ============================================================
// Site-wide access gate. Makes burningedgesdfs.com private: every request
// is blocked unless it carries the correct HTTP Basic Auth credentials, so
// the site is visible only to someone who knows the password.
//
// - Username is fixed ("edges"); password comes from the SITE_PASSWORD env
//   var set in the Netlify dashboard. No secret is committed to the repo.
// - Fails CLOSED: if SITE_PASSWORD is not set, everyone is denied (never
//   accidentally public). Set the env var in Netlify before this helps you in.
// - Scheduled refresh functions and the external chain poller talk to Supabase
//   directly (not through an inbound HTTP request), so they are unaffected.
// - Once the browser authenticates, it auto-attaches the Authorization header
//   to same-origin page + /api/* fetches, so the data functions keep working.
//
// Declared for path "/*" in netlify.toml.
// ============================================================
const USER = "edges";

export default async (request) => {
  const pass = Netlify.env.get("SITE_PASSWORD");
  const header = request.headers.get("authorization") || "";

  if (pass) {
    const expected = "Basic " + btoa(USER + ":" + pass);
    if (header === expected) return; // authenticated -> continue to the site
  }

  return new Response("This site is private.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Burning Edges (private)", charset="UTF-8"',
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
    },
  });
};

export const config = { path: "/*" };
