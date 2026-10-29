/* Who may read the editor, the deck and the API: shared by the front (pindeck) and each deck server.

   The token never appears in a page or on a command line, where other users of a shared server could read
   it (ps, curl). A browser logs in once with a one-time code (printed at start, or by `pindeck login`) and
   then holds the token in an HttpOnly cookie; the CLI, Claude and the front send it in a header. Browsers
   share cookies across all ports of a host, so the cookie name carries the server's port. */

import crypto from "node:crypto";

/* Pages opened as 127.0.0.1 or localhost only, on any port: an SSH tunnel may use another local port.
   Another site's name pointed at 127.0.0.1 (DNS rebinding) must not read the editor page, its token or the deck. */
export const goodHost = (h) => /^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(h);

export const LOGIN_PAGE = `<!doctype html><meta charset="utf-8"><title>PinDeck</title>
<body style="font:16px system-ui,sans-serif;max-width:36em;margin:4em auto;padding:0 1em">
<h1>Log in to PinDeck</h1><p>Open the login link that PinDeck printed when it started. Links work once;
for a new one, run <code>pindeck login</code> in the deck folder (or <code>node front.mjs login</code> in a
PinDeck checkout).</p>`;

export function cookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/* port() and origin() are read on use: --port 0 learns the port only once listening */
export function createLogin({ token, port, origin }) {
  const loginCodes = new Map();   // code -> expiry (ms)
  function loginCode(ttl) {
    const now = Date.now();
    for (const [c, exp] of loginCodes) if (exp < now) loginCodes.delete(c);
    const code = crypto.randomBytes(16).toString("hex");
    loginCodes.set(code, now + ttl);
    return code;
  }
  const loginUrl = (code, next = "/") => `${origin()}/login?` + new URLSearchParams({ code, ...(next !== "/" ? { next } : {}) });
  const cookieName = () => `pindeck-${port()}`;
  const sameSecret = (a) => typeof a === "string" && a.length === token.length &&
    crypto.timingSafeEqual(Buffer.from(a), Buffer.from(token));
  const authed = (req) => sameSecret(req.headers["x-editor-token"]) || sameSecret(cookie(req, cookieName()));
  /* A one-time code: set the cookie, then go on with a same-origin navigation (a redirect from a cross-site
     start, such as a file:// page or a link in a terminal, would not carry a SameSite=Strict cookie). */
  function login(res, url) {
    const code = url.searchParams.get("code") || "";
    const exp = loginCodes.get(code);
    loginCodes.delete(code);
    if (!exp || exp < Date.now()) {
      res.writeHead(403, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(LOGIN_PAGE.replace("<p>", "<p>This login link has expired or was used already. "));
    }
    // a path on this server only: browsers drop tabs and line breaks from a URL, so "/\t/site" means "//site"
    let next = url.searchParams.get("next") || "/";
    if (!next.startsWith("/") || /[\\\x00-\x1f\x7f]/.test(next) || next.startsWith("//") ||
        new URL(next, "http://127.0.0.1").host !== "127.0.0.1") next = "/";
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
      "set-cookie": `${cookieName()}=${token}; HttpOnly; SameSite=Strict; Path=/` });
    const to = JSON.stringify(next).replace(/</g, "\\u003c");
    res.end(`<!doctype html><meta charset="utf-8"><title>PinDeck</title><script>location.replace(${to})</script>`);
  }
  return { loginCode, loginUrl, cookieName, authed, login };
}
