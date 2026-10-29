#!/usr/bin/env node
/* PinDeck: the front, which is what `pindeck` starts.

   pindeck [deck-dir | deck.html] [--port 5180] [--provider claude|codex] [--model <name>] [--asset-root <dir>]
   pindeck login [deck-dir | deck.html]

   One port and one login for several decks. Each deck that is open runs its own deck server (server.mjs, on
   a private port of 127.0.0.1 with a token of its own) and is reached here as /d/<deck key>/: the front logs
   the browser in, then passes each request on with that deck's token. A deck starts when it is first asked
   for (from the editor's deck menu, or a bookmark), so its chat, Claude session and undo stay while it is
   open, and Claude can go on working in one deck while you edit another. A deck with no editor open for
   PINDECK_IDLE_MS (30 minutes) is closed; it opens again when asked for.

   The menu lists the decks in the start folder and the asset roots, and in their folders one level down
   (lib/deck-list.mjs). Only those can be opened: there is no free path entry. */

import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isSupportedPlatform, detectCapabilities, publicCapabilities, parsePort } from "./lib/capabilities.mjs";
import { deckTarget, homeDir } from "./lib/deck-target.mjs";
import { goodHost, LOGIN_PAGE, createLogin } from "./lib/login.mjs";
import { listDecks } from "./lib/deck-list.mjs";
import { USAGE } from "./lib/usage.mjs";

const EDITOR_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(EDITOR_DIR, "server.mjs");
const HOME_DIR = homeDir();
const IDLE_MS = Number(process.env.PINDECK_IDLE_MS) || 30 * 60000;

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) { console.log(USAGE); process.exit(0); }
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : dflt; };
const portArg = opt("--port", process.env.PORT || 5180);
const PASS = [];   // what every deck server gets: the backend and the asset roots
for (const name of ["--provider", "--model"]) { const v = opt(name); if (v !== undefined) PASS.push(name, v); }
const assetArgs = [];
for (let a; (a = opt("--asset-root")) !== undefined;) { assetArgs.push(a); PASS.push("--asset-root", a); }
let PORT = parsePort(portArg);   // the port actually bound once listening (--port 0 picks a free one)
if (PORT === null) { console.error(`Invalid port "${portArg}": use a number from 1 to 65535.\n\n${USAGE}`); process.exit(2); }
if (!isSupportedPlatform(process.platform)) {
  const { showPlatformNotice } = await import("./lib/platform-notice.mjs");
  await showPlatformNotice(PORT);
  process.exit(0);
}

/* pindeck login: a new one-time login link from the running front, asked with the token in its server file
   (readable only by this user). With a deck, the link opens that deck. A deck server started on its own
   (node server.mjs) for that deck answers instead, as before the front. */
const SERVER_FILE = path.join(HOME_DIR, "server.json");
if (argv[0] === "login") {
  const deck = argv[1] ? deckTarget(argv[1]) : null;
  let info = null;
  for (const f of [...(deck ? [path.join(HOME_DIR, "decks", deck.key, "server.json")] : []), SERVER_FILE]) {
    try { info = JSON.parse(fs.readFileSync(f, "utf8")); break; } catch {}
  }
  if (!info) { console.error("No PinDeck is running."); process.exit(1); }
  const next = deck && info.front ? `/d/${deck.key}/` : "/";
  try {
    const res = await fetch(`${info.url}/api/login-link?` + new URLSearchParams({ next }), { headers: { "x-editor-token": info.token } });
    if (!res.ok) throw new Error(res.status);
    console.log(`PinDeck (${deck ? path.join(deck.dir, deck.file) : info.deckDir}): ${(await res.json()).url}`);
    process.exit(0);
  } catch {
    console.error(`The PinDeck at ${info.url} does not answer. Is it still running?`);
    process.exit(1);
  }
}

/* The start deck, and the folders whose decks the menu offers. A folder without index.html opens the list
   of its decks; if it has none, its deck server says why, as for any deck that cannot be opened. */
const START = deckTarget(argv[0] || process.cwd());
const expandHome = (p) => (p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p);
let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(path.join(HOME_DIR, "config.json"), "utf8")); } catch {}
const ROOTS = [START.dir, ...assetArgs, ...(Array.isArray(fileConfig.assetRoots) ? fileConfig.assetRoots : [])]
  .map((r) => path.resolve(expandHome(String(r))))
  .filter((r, i, all) => all.indexOf(r) === i && (() => { try { return fs.statSync(r).isDirectory(); } catch { return false; } })());
const decksNow = () => listDecks(ROOTS);
const chooser = !START.named && !fs.existsSync(path.join(START.dir, START.file)) && decksNow().some((d) => !d.problem);

const TOKEN = crypto.randomBytes(16).toString("hex");
let ORIGIN = `http://127.0.0.1:${PORT}`;   // set again from the bound port once listening
const { loginCode, loginUrl, authed, login } = createLogin({ token: TOKEN, port: () => PORT, origin: () => ORIGIN });
const CAPS = detectCapabilities();

/* ---- Deck servers -------------------------------------------------------------------------------- */
const decks = new Map();   // key -> { key, dir, file, label, proc, url, token, ready, exited, sse, last }
const labelOf = (d) => (d.file === "index.html" ? path.basename(d.dir) : d.file);
let quitting = false;

/* Its output goes to this terminal, each line marked with the deck. hold(): keep the lines back for now */
function forward(stream, label, to, keep, hold = () => false) {
  let rest = "";
  const put = (l) => { keep?.(l + "\n"); if (!hold()) to.write(`[${label}] ${l}\n`); };
  stream.on("data", (chunk) => {
    const lines = (rest + chunk).split("\n");
    rest = lines.pop();
    lines.forEach(put);
  });
  stream.on("end", () => { if (rest) put(rest); });
}

/* The deck's server, started once: the promise resolves when it listens, or rejects with what it printed.
   The start deck's complaints are printed by the front as they are, like those of PinDeck before the front. */
function openDeck(entry, start = false) {
  const known = decks.get(entry.key);
  if (known) return known.ready;
  const d = { key: entry.key, dir: entry.dir, file: entry.file, label: labelOf(entry), sse: 0, last: Date.now() };
  decks.set(d.key, d);
  // its own process group: Ctrl+C reaches the front only, which then ends every deck once
  d.proc = spawn(process.execPath, [SERVER, entry.file === "index.html" ? entry.dir : path.join(entry.dir, entry.file),
    "--port", "0", ...PASS], { env: { ...process.env, PINDECK_FRONT: "1" }, stdio: ["ignore", "pipe", "pipe", "ipc"], detached: true });
  let said = "";
  forward(d.proc.stdout, d.label, process.stdout);
  forward(d.proc.stderr, d.label, process.stderr, (l) => { said += l; }, () => start && !d.url);
  d.exited = new Promise((r) => d.proc.once("exit", r));
  d.ready = new Promise((resolve, reject) => {
    d.proc.on("message", (m) => {
      if (!m?.ready) return;
      Object.assign(d, { url: m.ready.url, token: m.ready.token });
      if (!start) console.log(`[${d.label}] opened: ${path.join(d.dir, d.file)}`);
      resolve(d);
    });
    d.proc.once("exit", (code, signal) => {
      if (decks.get(d.key) === d) decks.delete(d.key);
      if (d.url && !quitting) console.log(`[${d.label}] closed`);
      reject(Object.assign(new Error(said.trim() || `The deck server stopped (${code ?? signal}).`), { exitCode: code || 1 }));
    });
  });
  d.ready.catch(() => {});
  return d.ready;
}

function stopDeck(d) {
  try { d.proc.kill("SIGTERM"); } catch {}
}

/* A deck with no editor open (no event stream) and nothing to do for IDLE_MS is closed */
setInterval(async () => {
  for (const d of decks.values()) {
    if (!d.url || d.sse > 0 || Date.now() - d.last < IDLE_MS) continue;
    try {
      const res = await fetch(`${d.url}/api/status`, { headers: { "x-editor-token": d.token } });
      const st = await res.json();
      if (st.busy || d.sse > 0 || Date.now() - d.last < IDLE_MS) continue;
    } catch { continue; }
    console.log(`[${d.label}] no editor open for ${Math.round(IDLE_MS / 60000)} min: closing it (it opens again when asked for)`);
    stopDeck(d);
  }
}, Math.min(60000, IDLE_MS / 2)).unref();

/* The request, without the front's cookie and with the deck's token, to the deck's server; the answer
   streamed back (event streams, media ranges and large uploads included) */
function proxy(req, res, d, rest, anonymous = false) {
  d.last = Date.now();
  const headers = { ...req.headers, host: new URL(d.url).host, ...(anonymous ? {} : { "x-editor-token": d.token }) };
  if (anonymous) delete headers["x-editor-token"];
  delete headers.cookie;
  delete headers.origin;   // checked here against the front's address; the deck server checks its own
  const up = http.request(d.url + rest, { method: req.method, headers }, (r) => {
    res.writeHead(r.statusCode, r.headers);
    r.pipe(res);
  });
  up.on("error", () => { if (!res.headersSent) page(res, 502, "This deck stopped answering", "Reload the page to open it again."); else res.destroy(); });
  if (rest.split("?")[0] === "/api/events") {
    d.sse++;
    res.on("close", () => { d.sse--; d.last = Date.now(); });
  }
  res.on("close", () => { if (!res.writableFinished) up.destroy(); });
  req.pipe(up);
}

/* ---- HTTP ------------------------------------------------------------------------------------- */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const text = (res, code, s) => { res.writeHead(code, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); res.end(s); };
const json = (res, code, o) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(o)); };
function page(res, code, title, body) {
  res.writeHead(code, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(`<!doctype html><meta charset="utf-8"><title>${esc(title)} · PinDeck</title>
<link rel="icon" href="/editor/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/editor/front.css">
<main class="front"><h1>${esc(title)}</h1>${body}</main>`);
}
/* The decks for the menu (and the start page without a start deck), with which are open and working */
const deckList = () => decksNow().map((e) => ({ key: e.key, rel: e.rel, root: e.root, problem: e.problem,
  open: !!decks.get(e.key)?.url }));
function chooserPage(res) {
  const list = deckList(), groups = new Map(ROOTS.map((r) => [r, list.filter((d) => d.root === r)]).filter(([, l]) => l.length));
  const body = [...groups].map(([root, list]) => `<h2>${esc(root)}</h2><ul>${list.map((d) => d.problem
    ? `<li class="off" title="${esc(d.problem)}">${esc(d.rel)}<small>${esc(d.problem)}</small></li>`
    : `<li><a href="/d/${esc(d.key)}/">${esc(d.rel)}</a>${d.open ? " <small>open</small>" : ""}</li>`).join("")}</ul>`).join("");
  page(res, 200, "Decks", body || "<p>No decks here.</p>");
}
const MIME = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  svg: "image/svg+xml", png: "image/png" };
function serveEditorFile(res, rel) {
  const base = path.join(EDITOR_DIR, "public");
  const f = path.resolve(base, "." + path.posix.normalize("/" + decodeURIComponent(rel)));
  if (!f.startsWith(base + path.sep)) return text(res, 403, "Forbidden");
  fs.readFile(f, (err, data) => {
    if (err) return text(res, 404, "Not found");
    res.writeHead(200, { "content-type": MIME[path.extname(f).slice(1)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const host = String(req.headers.host || "").toLowerCase();
  if (!goodHost(host)) return text(res, 403, "Bad host");
  try {
    const url = new URL(req.url, ORIGIN);
    const p = url.pathname;
    if (req.method === "GET" && p === "/login") return login(res, url);
    // the editor's own scripts and styles hold nothing secret; the deck page loads bridge.js from here
    if (req.method === "GET" && p.startsWith("/editor/")) return serveEditorFile(res, p.slice(8));
    /* A deck's pages and files under /d/<deck>/v/<token>/: asked for by the deck itself, which runs sandboxed
       without the login cookie (see VIEW in server.mjs). Passed on without the token, so the deck server's own
       check of the path is all they get; only to a deck that is open, so they never start one. */
    const view = /^\/d\/([\w.-]+)(\/v\/.*)$/.exec(p);
    if (view && !authed(req)) {
      const d = decks.get(view[1]);
      if (!d?.url || (req.method !== "GET" && req.method !== "HEAD")) return text(res, 403, "Not logged in");
      return proxy(req, res, d, view[2] + url.search, true);
    }
    if (!authed(req)) {
      if (req.method === "GET" && /^\/(d\/[^/]+\/(index\.html)?)?$/.test(p)) {
        res.writeHead(403, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(LOGIN_PAGE);
      }
      return text(res, 403, "Not logged in");
    }
    const origin = req.headers.origin;
    if (req.method === "POST" && origin && origin.toLowerCase() !== `http://${host}`) return text(res, 403, "Bad origin");

    if (p === "/") {
      if (chooser) return chooserPage(res);
      res.writeHead(302, { location: `/d/${START.key}/`, "cache-control": "no-store" });
      return res.end();
    }
    if (p === "/api/ping") return json(res, 200, { ok: true, front: true });
    if (p === "/api/login-link") return json(res, 200, { url: loginUrl(loginCode(3600000), url.searchParams.get("next") || "/") });
    if (p === "/api/decks") return json(res, 200, { decks: deckList() });

    const m = /^\/d\/([\w.-]+)(\/.*)?$/.exec(p);
    if (!m) return text(res, 404, "Not found");
    if (!m[2]) {
      res.writeHead(301, { location: `/d/${m[1]}/${url.search}` });
      return res.end();
    }
    let d = decks.get(m[1]);
    if (!d) {
      // only a deck from the list, and only one PinDeck can open
      const entry = START.key === m[1] && !chooser ? { key: START.key, dir: START.dir, file: START.file }
        : decksNow().find((e) => e.key === m[1]);
      if (!entry) return page(res, 404, "No such deck", `<p>It is not in the deck folder or an asset root (any more).</p><p><a href="/">All decks</a></p>`);
      if (entry.problem) return page(res, 409, "PinDeck cannot open this deck", `<p>${esc(entry.problem)}</p><p><a href="/">All decks</a></p>`);
      d = entry;
    }
    try { d = await openDeck(d); }
    catch (e) { return page(res, 502, "PinDeck could not open this deck", `<pre>${esc(e.message)}</pre><p><a href="/">All decks</a></p>`); }
    return proxy(req, res, d, m[2] + url.search);
  } catch (e) {
    if (!res.headersSent) text(res, 500, String(e.message || e));
  }
});

/* ---- Start ----------------------------------------------------------------------------------------
   The port is bound first, then the start deck opens (its server checks it before writing anything). If it
   cannot, the front says why and stops: as before the front, nothing is written. */
function writeServerInfo() {
  fs.mkdirSync(HOME_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SERVER_FILE, JSON.stringify({ url: ORIGIN, token: TOKEN, deckDir: START.dir, pid: process.pid, front: true }, null, 2), { mode: 0o600 });
  fs.chmodSync(SERVER_FILE, 0o600);
}
function removeServerInfo() {
  try { if (JSON.parse(fs.readFileSync(SERVER_FILE, "utf8")).token === TOKEN) fs.rmSync(SERVER_FILE, { force: true }); } catch {}
}
let listening = false;
server.on("error", (e) => {
  if (listening) return console.error(e);
  console.error(e.code === "EADDRINUSE"
    ? `Port ${PORT} is in use (another PinDeck, or an SSH tunnel?). Choose another with --port, the same on both ends of a tunnel.`
    : `Cannot listen on 127.0.0.1:${PORT}: ${e.message}`);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", async () => {
  listening = true;
  PORT = server.address().port;
  ORIGIN = `http://127.0.0.1:${PORT}`;
  if (!chooser) {
    try { await openDeck({ key: START.key, dir: START.dir, file: START.file }, true); }
    catch (e) {
      console.error(e.message.replace(/\n+$/, ""));
      process.exit(e.exitCode);   // 2 for a bad argument, as the deck server says
    }
  }
  writeServerInfo();
  console.log(`PinDeck: ${loginUrl(loginCode(3600000))}`);
  console.log("  (a one-time login link, valid for an hour; for a new one: pindeck login)");
  console.log(chooser ? `Decks: ${START.dir}` : `Deck: ${START.dir}`);
  console.log(`Server: ${CAPS.label}`);
  for (const [name, c] of Object.entries(publicCapabilities(CAPS)))
    if (c && c.available === false) console.log(`  ${name}: off (${c.reason})`);
});

/* Ctrl+C or SIGTERM: every deck ends as it does on its own (its assistant gets end of input; at most 6 s),
   then the front. A second Ctrl+C ends them at once. */
async function quit() {
  if (quitting) {
    for (const d of decks.values()) try { process.kill(-d.proc.pid, "SIGKILL"); } catch {}
    process.exit(1);
  }
  quitting = true;
  server.close();
  server.closeAllConnections?.();
  removeServerInfo();
  const all = [...decks.values()];
  all.forEach(stopDeck);
  await Promise.race([Promise.all(all.map((d) => d.exited)), new Promise((r) => setTimeout(r, 7000))]);
  for (const d of all) if (d.proc.exitCode === null && d.proc.signalCode === null) try { process.kill(-d.proc.pid, "SIGKILL"); } catch {}
  process.exit(0);
}
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
