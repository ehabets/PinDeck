#!/usr/bin/env node
/* PinDeck: local server.

   pindeck [deck-dir] [--port 5180] [--model <name>]      (or: node server.mjs ...)

   - serves the editor UI and the deck (with a bridge script injected in edit mode)
   - pushes file changes to the browser (server-sent events) for live reload
   - runs one long-lived Claude Code process for the chat sidebar
   - snapshots files around every Claude turn for diffs and undo
   - answers `cli.mjs layout|shot|slides|pdf|pdf-figure` for Claude's self-checks, exports and PDF figures
   - exports the deck as a PDF handout or a PDF presentation (build steps on separate pages)
   - stores figures and audio attached to chat messages in <deck>/figures/ for Claude to use, and attached
     PDFs (papers, reports, figures) in ~/.pindeck, outside the deck
   - imports slides from PowerPoint files in the deck's own layouts
   Listens on 127.0.0.1 only; the editor, the deck and every API call need the per-run token (a login
   cookie in the browser, a header for the CLI).
   Runtime files (chat, screenshots, backups) live in ~/.pindeck, never in the deck or the package. */

import http from "node:http";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { assignEids, parse, findSlides, slideSelector, deckSize, setStyles, getInner, setInner, insertAfter, removeElement, deleteTarget, fileRefs, insertSlide, moveSlide, getNotes, setNotes, setAttr, elementEnd } from "./lib/eids.mjs";
import { unifiedDiff } from "./lib/diff.mjs";
import { ClaudeSession } from "./lib/claude.mjs";
import { formatLayout, formatPin } from "./lib/layout.mjs";
import { printLayout, printPdf, PDF_HEAD_TAG, PDF_PAGE_TAG } from "./lib/pdf.mjs";
import { readPptx } from "./lib/pptx.mjs";
import { exportPdf as pptxToPdf, renderJobs, renderAvailable, pdfInfo } from "./lib/pptx-render.mjs";
import { buildImport, planSlides } from "./lib/pptx-import.mjs";
import { isSupportedPlatform, detectCapabilities, publicCapabilities, capabilityPrompt, parsePort, cliCommand, findExecutable } from "./lib/capabilities.mjs";
import { unsupportedMessage } from "./lib/frameworks.mjs";
import { readInstructions } from "./lib/instructions.mjs";
import { writeAtomic, sameContent, revision, scanFiles, scanChanges } from "./lib/deck-files.mjs";

/* ---- Config ------------------------------------------------------------------ */
const USAGE = `Usage: pindeck [deck-folder | deck-file.html] [--port 5180] [--model <name>] [--asset-root <folder>]...
       pindeck login [deck-folder | deck-file.html]

Opens a reveal.js deck in PinDeck: a deck file such as talk.html, or a folder (default: the current
folder), which then opens its index.html. A deck made otherwise names its slides in its <head> with
<meta name="pindeck:slides" content="<CSS selector>"> and <meta name="pindeck:size" content="1440x1080">.
login prints a new one-time login link for the PinDeck running for that deck
(without a deck: for the PinDeck started last).
--asset-root lets the deck use files outside its folder: a folder that contains the deck (paths such as
../shared/style.css then work), or one that symlinks in the deck may point to. Repeatable; also
"assetRoots" in ~/.pindeck/config.json.`;
const EDITOR_DIR = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) { console.log(USAGE); process.exit(0); }
const opt = (name, dflt) => { const i = argv.indexOf(name); return i >= 0 ? argv.splice(i, 2)[1] : dflt; };
const portArg = opt("--port", process.env.PORT || 5180);
const assetArgs = [];
for (let a; (a = opt("--asset-root")) !== undefined;) assetArgs.push(a);
let PORT = parsePort(portArg);   // the port actually bound once listening (--port 0 picks a free one)
if (PORT === null) { console.error(`Invalid port "${portArg}": use a number from 1 to 65535.\n\n${USAGE}`); process.exit(2); }
if (!isSupportedPlatform(process.platform)) {
  const { showPlatformNotice } = await import("./lib/platform-notice.mjs");
  await showPlatformNotice(PORT);
  process.exit(0);
}
const LOGIN = argv[0] === "login";
if (LOGIN) argv.shift();
const MODEL = opt("--model", process.env.CLAUDE_MODEL || "");
/* The deck: a file (talk.html), or a folder, which means its index.html. A path ending in .html or .htm
   that is not a folder is a file, so a missing file gets a clear message. */
const TARGET = path.resolve(argv[0] || process.cwd());
const isFolder = (() => { try { return fs.statSync(TARGET).isDirectory(); } catch { return false; } })();
const DECK_DIR = isFolder || !/\.html?$/i.test(TARGET) ? TARGET : path.dirname(TARGET);
const DECK_FILE = DECK_DIR === TARGET ? "index.html" : path.basename(TARGET);
const NAMED = DECK_FILE !== "index.html";             // a deck file with its own name; several can share a folder
const DECK_NAME = NAMED ? DECK_FILE.replace(/\.html?$/i, "") : path.basename(DECK_DIR);   // for exports and titles
const EDITABLE = [DECK_FILE, "theme.css"];         // Claude may edit these
const LOCKED = ["brand.css"];                      // never, enforced twice
const HOME_DIR = process.env.PINDECK_HOME || path.join(os.homedir(), ".pindeck");
/* State per deck file. A folder's index.html keeps the key it always had, so existing chats and undo
   histories stay; a named file gets its own, so two decks in one folder never share chat or undo. */
const deckKey = (NAMED ? `${path.basename(DECK_DIR)}-${DECK_NAME}` : path.basename(DECK_DIR)).replace(/[^\w.-]+/g, "_") + "-" +
  crypto.createHash("sha1").update(NAMED ? path.join(DECK_DIR, DECK_FILE) : DECK_DIR).digest("hex").slice(0, 8);
const STATE_DIR = path.join(HOME_DIR, "decks", deckKey);
const SHOT_DIR = path.join(STATE_DIR, "shots");
const PDF_DIR = path.join(STATE_DIR, "attachments");   // attached PDFs: reading material, not part of the deck
/* pindeck login: a new one-time login link from the running server, asked with the token in its server
   file (readable only by this user) */
if (LOGIN) {
  const files = [path.join(STATE_DIR, "server.json"), ...(argv[0] ? [] : [path.join(HOME_DIR, "server.json")])];
  let info = null;
  for (const f of files) { try { info = JSON.parse(fs.readFileSync(f, "utf8")); break; } catch {} }
  if (!info) { console.error(`No PinDeck is running${argv[0] ? ` for ${DECK_DIR}` : ""}.`); process.exit(1); }
  try {
    const res = await fetch(`${info.url}/api/login-link`, { headers: { "x-editor-token": info.token } });
    if (!res.ok) throw new Error(res.status);
    console.log(`PinDeck (${info.deckDir}): ${(await res.json()).url}`);
    process.exit(0);
  } catch {
    console.error(`The PinDeck for ${info.deckDir} at ${info.url} does not answer. Is it still running?`);
    process.exit(1);
  }
}
const TOKEN = crypto.randomBytes(16).toString("hex");
let ORIGIN = `http://127.0.0.1:${PORT}`;   // set again from the bound port once listening
const CLI_REL = path.relative(DECK_DIR, path.join(EDITOR_DIR, "cli.mjs")).split(path.sep).join("/");
const CLI_CMD = cliCommand(CLI_REL);
const CAPS = detectCapabilities();

/* Checks before anything is written: a deck that cannot be opened or saved is left exactly as it is. */
function checkDeck() {
  const file = path.join(DECK_DIR, DECK_FILE);
  if (!fs.existsSync(file)) return `No ${DECK_FILE} in ${DECK_DIR}`;
  try { fs.accessSync(file, fs.constants.R_OK | fs.constants.W_OK); }
  catch { return `${file} cannot be read and written (check its permissions).`; }
  // saving replaces the file through a temporary file next to it, so the folder must be writable too
  try { fs.accessSync(DECK_DIR, fs.constants.W_OK); }
  catch { return `${DECK_DIR} is not writable: PinDeck saves the deck through a temporary file in that folder.`; }
  return null;
}
const deckProblem = checkDeck();
if (deckProblem) {
  console.error(`${deckProblem}\n\n${USAGE}`);
  process.exit(1);
}
// reveal.js, or a deck that names its slides: another framework's deck is left exactly as it is (no ids, no state)
const deckAtStart = fs.readFileSync(path.join(DECK_DIR, DECK_FILE), "utf8");
const frameworkProblem = unsupportedMessage(deckAtStart, DECK_FILE);
if (frameworkProblem) {
  console.error(frameworkProblem);
  process.exit(1);
}
/* A deck made without reveal.js names its slides with <meta name="pindeck:slides"> (null for reveal.js);
   headless Chrome then opens it at the slide size, so a screenshot is the slide itself. */
const DECK_SELECTOR = slideSelector(parse(deckAtStart));
const SLIDE_SIZE = (DECK_SELECTOR && deckSize(parse(deckAtStart))) || { width: 1280, height: 720 };
/* Runtime files hold the token, the chat and attachments: private to the user. Written only after the
   port is bound (see Start), so a failed start leaves no state behind. */
const SERVER_FILES = [path.join(STATE_DIR, "server.json"), path.join(HOME_DIR, "server.json")];   // the second: the CLI's fallback
function writeServerInfo() {
  for (const d of [HOME_DIR, STATE_DIR, SHOT_DIR]) fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const info = JSON.stringify({ url: ORIGIN, token: TOKEN, deckDir: DECK_DIR, pid: process.pid }, null, 2);
  for (const f of SERVER_FILES) {
    fs.writeFileSync(f, info, { mode: 0o600 });
    fs.chmodSync(f, 0o600);
  }
}
/* On exit: only our own server files, never those of a PinDeck started since for this or another deck. */
function removeServerInfo() {
  for (const f of SERVER_FILES) {
    try { if (JSON.parse(fs.readFileSync(f, "utf8")).token === TOKEN) fs.rmSync(f, { force: true }); } catch {}
  }
}

/* ---- Small helpers --------------------------------------------------------------- */
const MIME = { html: "text/html; charset=utf-8", css: "text/css; charset=utf-8", js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8", json: "application/json", svg: "image/svg+xml", png: "image/png",
  jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", ico: "image/x-icon",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", wav: "audio/wav", mp3: "audio/mpeg",
  ogg: "audio/ogg", oga: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac", flac: "audio/flac",
  mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime", pdf: "application/pdf", md: "text/plain; charset=utf-8" };
const hash = (s) => crypto.createHash("sha1").update(s).digest("hex");
const readDeck = (f) => { try { return fs.readFileSync(path.join(DECK_DIR, f), "utf8"); } catch { return null; } };
const ourWrites = new Map(); // file -> { hash, manual } of what we wrote, to tell our writes from others
function writeDeck(f, content, manual = false) {
  ourWrites.set(f, { hash: hash(content), manual });
  writeAtomic(path.join(DECK_DIR, f), content);
}
/* Other files PinDeck writes into the deck (uploads, imported pictures, undo/redo of deleted files) */
function writeDeckFile(rel, data, manual = true) {
  const abs = path.join(DECK_DIR, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  ourWrites.set(rel, { hash: hash(data.toString("utf8")), manual });   // manual: no slide reload for a new file
  writeAtomic(abs, data);
}
const snapshot = (files) => Object.fromEntries(files.map((f) => [f, readDeck(f)]));
/* A change (a Claude turn or a hand edit) keeps each file it touched as it was before and after: text as
   a string, or as a Buffer from a scan of the whole deck (null: the file did not exist). */
const changeFiles = (t) => [...new Set([...Object.keys(t.before), ...Object.keys(t.after)])];
const isText = (v) => v == null || typeof v === "string" || !v.includes(0);
const asText = (v) => (v == null ? "" : String(v));
const isAs = (rel, v) => sameContent(path.join(DECK_DIR, rel), v ?? null);
function putDeckFile(rel, v) {   // undo and redo: back to v (null: remove the file)
  if (v == null) return fs.rmSync(path.join(DECK_DIR, rel), { force: true });
  fs.mkdirSync(path.dirname(path.join(DECK_DIR, rel)), { recursive: true });
  writeDeck(rel, v);
}
function fileChange(rel, before, after) {
  if (!isText(before) || !isText(after)) return { file: rel, added: 0, removed: 0, binary: true };
  const d = unifiedDiff(asText(before), asText(after), rel);
  return { file: rel, added: d.added, removed: d.removed };
}
const fileDiff = (rel, before, after) => (!isText(before) || !isText(after)
  ? `Binary file ${rel} ${before == null ? "added" : after == null ? "deleted" : "changed"}`
  : unifiedDiff(asText(before), asText(after), rel).text);
/* The revision of the editable files: sent with every API answer, checked on the editor's changes */
const deckRev = () => revision(DECK_DIR, EDITABLE);
const json = (res, code, obj) => {
  res.writeHead(code, { "content-type": "application/json", "x-deck-rev": deckRev() });
  res.end(JSON.stringify(obj));
};
/* A change from the editor made on files that have changed since it loaded them: refused (409), nothing
   written. The editor keeps the user's text and reloads. Requests without a revision (older tabs, the
   notes sent while the tab closes) are not checked. */
function staleEdit(res, b) {
  if (b.rev == null || b.rev === deckRev()) return false;
  json(res, 409, { code: "stale", rev: deckRev(),
    error: "The deck changed outside PinDeck since this slide was shown, so your change was not saved. The slide has been reloaded." });
  return true;
}
const text = (res, code, s) => { res.writeHead(code, { "content-type": "text/plain; charset=utf-8" }); res.end(s); };
async function body(req) {
  let s = "";
  for await (const c of req) { s += c; if (s.length > 5e6) throw new Error("body too large"); }
  return s ? JSON.parse(s) : {};
}
function safeJoin(base, rel) {
  const p = path.resolve(base, "." + path.posix.normalize("/" + decodeURIComponent(rel)));
  return p === base || p.startsWith(base + path.sep) ? p : null;
}

/* ---- Server-sent events ------------------------------------------------------------ */
const clients = new Set();
function broadcast(type, data) {
  const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(msg);
}
setInterval(() => { for (const res of clients) res.write(": ping\n\n"); }, 20000);

/* ---- Element ids ----------------------------------------------------------------------- */
let backedUp = false;
function runEidPass() {
  const html = readDeck(DECK_FILE);
  if (html == null) return { changed: false, assigned: [] };   // being replaced by another program: next time
  const r = assignEids(html);
  if (r.changed) {
    if (!backedUp) {
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      fs.mkdirSync(path.join(STATE_DIR, "backups"), { recursive: true, mode: 0o700 });
      fs.writeFileSync(path.join(STATE_DIR, "backups", `index-${ts}.html`), html, { mode: 0o600 });
      backedUp = true;
    }
    writeDeck(DECK_FILE, r.html);
    refreshGit();
  }
  return r;
}

/* With the "pindeck-ids" git filter (`node cli.mjs git-setup`) git strips the ids from commits and
   diffs. But git lists a file as modified whenever its size differs from what it recorded, without
   comparing contents, and adding ids changes the size. So after adding ids PinDeck re-records the file
   in git (`git add`), but only when that changes nothing: its content without ids must equal what git
   already has staged. A file with real edits is left alone and shows as modified, as it should. */
let gitFilter = null;   // null: not checked yet
const git = (args, cb) => execFile("git", ["-C", DECK_DIR, ...args], { encoding: "utf8" }, (err, out) => cb(err, (out || "").trim()));
function refreshGit() {
  // another git command (an IDE's `git status`) may hold the index lock: try again a few times, checking afresh
  const run = (tries = 3) => git(["hash-object", `--path=${DECK_FILE}`, DECK_FILE], (e1, cleaned) => {
    if (e1 || !cleaned) return;
    git(["ls-files", "-s", "--", DECK_FILE], (e2, entry) => {
      const staged = entry.split(/\s+/)[1];
      if (!e2 && staged === cleaned) git(["add", "--", DECK_FILE], (e3) => { if (e3 && tries > 1) setTimeout(() => run(tries - 1), 300); });
    });
  });
  if (gitFilter === null) {
    git(["check-attr", "filter", "--", DECK_FILE], (err, out) => {
      gitFilter = !err && /: filter: pindeck-ids$/.test(out);
      if (gitFilter) run();
    });
  } else if (gitFilter) run();
}
function slideList() {
  const html = readDeck(DECK_FILE);
  return findSlides(parse(html)).map((s, index) => ({ index, eid: s.attrs["data-eid"]?.value || null }));
}
function resolveSlide(spec) {
  const slides = slideList();
  if (!spec || spec === "current") return slides[state.current?.index ?? 0] || slides[0];
  if (/^\d+$/.test(spec)) return slides[+spec - 1];
  return slides.find((s) => s.eid === spec) || slides.find((s) => s.eid && s.eid.startsWith(spec));
}

/* ---- Headless Chrome (screenshots, and layout when no editor tab is open) --------------- */
const CHROME = CAPS.chromePath;   // null when Chrome features are unavailable (see lib/capabilities.mjs)
/* Headless Chrome on macOS often lingers long after it has written its output, so we
   watch the output and stop Chrome as soon as `done(stdout, stderr)` says we have it. */
let chromeSeq = 0;
function chrome(args, done) {
  if (!CHROME) return Promise.reject(new Error(`Screenshots are not available: ${CAPS.screenshot.reason}.`));
  return new Promise((resolve, reject) => {
    // a profile per run: concurrent runs must not share one
    const profile = path.join(STATE_DIR, "chrome", `p${process.pid}-${++chromeSeq}`);
    const proc = spawn(CHROME, ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
      "--no-default-browser-check", "--disable-extensions", "--mute-audio", `--user-data-dir=${profile}`,
      `--window-size=${SLIDE_SIZE.width},${SLIDE_SIZE.height}`, "--force-device-scale-factor=1", "--virtual-time-budget=5000",
      ...args.map((a) => a.startsWith(ORIGIN + "/") ? chromeStart(profile, a) : a)]);
    let out = "", err = "", finished = false;
    const finish = (fn, v) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      proc.kill("SIGKILL");
      setTimeout(() => fs.rm(profile, { recursive: true, force: true }, () => {}), 500);
      fn(v);
    };
    const check = () => { if (done(out, err)) finish(resolve, out); };
    proc.stdout.on("data", (d) => { out += d; check(); });
    proc.stderr.on("data", (d) => { err += d; check(); });
    proc.on("error", (e) => finish(reject, e));
    // "close", not "exit": at exit Chrome's last output (the line saying the file is written) may still be unread
    proc.on("close", () => (done(out, err) ? finish(resolve, out) : finish(reject, new Error("Chrome exited without output."))));
    const timer = setTimeout(() => finish(reject, new Error("Chrome timed out.")), 25000);
  });
}
const deckUrl = (mode, params = {}) =>
  `${ORIGIN}${DECK_PAGE}?` + new URLSearchParams({ editor: mode, showHiddenSlides: "true", ...params });
async function takeShot(slide) {
  const pins = state.pins.filter((p) => p.slide.eid === slide.eid).map((p) => ({ n: p.n, eid: p.eid, at: p.at, point: p.point }));
  const out = path.join(SHOT_DIR, `${slide.eid.replace(/[^\w-]/g, "_")}-${Date.now()}.png`);
  await chrome([`--screenshot=${out}`, deckUrl("shot", { slide: slide.eid, pins: JSON.stringify(pins) })],
    (_o, err) => /bytes written to file/.test(err) && fs.existsSync(out));
  if (!fs.existsSync(out)) throw new Error("Chrome did not write the screenshot.");
  // keep the folder small
  const old = fs.readdirSync(SHOT_DIR).map((f) => path.join(SHOT_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs).slice(40);
  old.forEach((f) => fs.rmSync(f, { force: true }));
  return out;
}
async function measureHeadless(slide) {
  const dom = await chrome(["--dump-dom", deckUrl("dump", { slide: slide.eid })], (o) => /<\/html>\s*$/i.test(o));
  const m = /<script id="__editor_layout" type="application\/json">([\s\S]*?)<\/script>/.exec(dom);
  if (!m) throw new Error("Headless layout measurement failed.");
  const r = JSON.parse(m[1]);
  if (r.error) throw new Error(r.error);
  return r;
}

/* Measuring in the editor tab is fast and is exactly what the user sees. */
const pending = new Map();
let measureSeq = 0;
function measureInEditor(slide) {
  if (!clients.size) return Promise.reject(new Error("no editor tab"));
  const id = ++measureSeq;
  broadcast("measure", { id, index: slide.index, eid: slide.eid });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error("editor did not answer")); }, 8000);
    pending.set(id, { resolve, reject, t });
  });
}
const measure = (slide) => measureInEditor(slide).catch((e) => {
  if (CAPS.headlessLayout.available) return measureHeadless(slide);
  throw Object.assign(new Error(`Layout needs the editor open in a browser (${e.message}); ` +
    `headless layout is not available: ${CAPS.headlessLayout.reason}.`), { status: 503 });
});

/* PDF export. handout: one page per slide, build steps in their final state.
   presentation: one page per build step (a slide with two clicks gives three pages).
   Files go to <deck>/export/. One export at a time. */
let exportQueue = Promise.resolve(), snapSeq = 0;
const snapshots = new Map();   // id -> static print layout, served next to the deck page as __pindeck-print-<id>.html
function exportPdf(kind, includeHidden = false) {
  if (!CAPS.pdfExport.available) return Promise.reject(Object.assign(new Error(`PDF export is not available: ${CAPS.pdfExport.reason}.`), { status: 501 }));
  const split = kind === "presentation";
  const name = `${DECK_NAME}-${split ? "presentation" : "handout"}.pdf`;
  const out = path.join(DECK_DIR, "export", name);
  const profile = (step) => path.join(STATE_DIR, "chrome", `pdf-${process.pid}-${Date.now()}-${step}`);
  const run = async () => {
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const layoutProfile = profile("layout"), printProfile = profile("print");
    const html = await printLayout(CHROME, chromeStart(layoutProfile,
      `${ORIGIN}${DECK_PAGE}?editor=pdf&print-pdf&pdfSeparateFragments=${split}&showHiddenSlides=${!!includeHidden}`), layoutProfile);
    const id = `${process.pid}-${++snapSeq}`;
    snapshots.set(id, html);
    try { await printPdf(CHROME, chromeStart(printProfile, `${ORIGIN}${DECK_BASE}__pindeck-print-${id}.html`), out, printProfile); }
    finally { snapshots.delete(id); }
    return { kind: split ? "presentation" : "handout", path: out, rel: path.relative(DECK_DIR, out),
      url: `/deck/export/${encodeURIComponent(name)}`, bytes: fs.statSync(out).size };
  };
  const job = exportQueue.then(run, run);
  exportQueue = job.catch(() => {});
  return job;
}

/* ---- Chat state and the Claude Code session --------------------------------------------- */
const CHAT_FILE = path.join(STATE_DIR, "chat.json");
const state = {
  chat: [], seq: 0, busy: false, model: MODEL || null, sessionId: null,
  turns: [], redo: [], turn: null, notes: [], pins: [], current: null,
  uploads: new Set(),   // files uploaded for the next message; removable until it is sent
  pdfFigures: new Set(),   // figures/ files written by pdf-figure, which it may overwrite
};
try {
  const saved = JSON.parse(fs.readFileSync(CHAT_FILE, "utf8"));
  Object.assign(state, { chat: saved.chat || [], seq: saved.seq || 0, sessionId: saved.sessionId || null });
} catch {}
/* Saved shortly after the last change, in one atomic write: overlapping writes could leave a broken file. */
let chatTimer = null;
function writeChat() {
  clearTimeout(chatTimer);
  chatTimer = null;
  try { writeAtomic(CHAT_FILE, JSON.stringify({ chat: state.chat.slice(-400), seq: state.seq, sessionId: state.sessionId })); }
  catch (e) { console.error(e.message); }
}
const saveChat = () => { chatTimer ??= setTimeout(writeChat, 100); };
function addEntry(entry) {
  entry.id = ++state.seq;
  entry.time = Date.now();
  state.chat.push(entry);
  broadcast("chat", entry);
  saveChat();
  return entry;
}
const liveTurns = () => state.turns.filter((t) => !t.undone);
const changeLabel = (t) => (t ? (t.kind === "manual" ? t.label : "Claude's change") : null);
/* Model and effort for the Claude Code session. ~/.pindeck/config.json holds them: PinDeck creates it
   with the defaults below, you can edit it, and a choice in the chat header's menu is saved there too,
   so the file always shows what PinDeck uses. --model on the command line applies to one run only. */
const MODELS = ["opus", "sonnet"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const DEFAULTS = { model: "sonnet", effort: "medium" };
const CONFIG_FILE = path.join(HOME_DIR, "config.json");
const settings = { ...DEFAULTS };
let fileConfig = {};
try { fileConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); }
catch (e) { if (e.code !== "ENOENT") console.warn(`${CONFIG_FILE} is not valid JSON; using the defaults.`); }
if (MODELS.includes(fileConfig.model)) settings.model = fileConfig.model;
else if (fileConfig.model !== undefined) console.warn(`config.json: unknown model "${fileConfig.model}" (use ${MODELS.join(" or ")}); using ${DEFAULTS.model}.`);
if (EFFORTS.includes(fileConfig.effort)) settings.effort = fileConfig.effort;
else if (fileConfig.effort !== undefined) console.warn(`config.json: unknown effort "${fileConfig.effort}" (use ${EFFORTS.join(", ")}); using ${DEFAULTS.effort}.`);
/* Asset roots (--asset-root, and "assetRoots" in config.json): folders outside the deck whose files the
   deck may use. The outermost one that contains the deck is served at /files/, with the deck page inside
   it, so a relative path such as ../shared/style.css reaches its file. Every file served, from the deck
   or from /files/, must really lie (after following symlinks) inside the deck folder or an asset root:
   a symlink that leads anywhere else is refused. */
const expandHome = (p) => (p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p);
const ASSET_ROOTS = [...assetArgs, ...(Array.isArray(fileConfig.assetRoots) ? fileConfig.assetRoots : [])].map((r) => {
  const abs = path.resolve(expandHome(String(r)));
  let st = null;
  try { st = fs.statSync(abs); } catch {}
  if (!st?.isDirectory()) { console.error(`Asset root ${abs} is not a folder.\n\n${USAGE}`); process.exit(2); }
  return abs;
});
const within = (dir, p) => p === dir || p.startsWith(dir + path.sep);
const realOr = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const SERVE_ROOT = ASSET_ROOTS.filter((r) => within(r, DECK_DIR)).sort((a, b) => a.length - b.length)[0] || null;
const ALLOWED_REAL = [DECK_DIR, ...ASSET_ROOTS].map(realOr);
const encPath = (rel) => rel.split(path.sep).filter(Boolean).map(encodeURIComponent).join("/");
/* The deck page's URL, and the folder URL its relative paths resolve against */
const DECK_PAGE = SERVE_ROOT ? `/files/${[encPath(path.relative(SERVE_ROOT, DECK_DIR)), encodeURIComponent(DECK_FILE)].filter(Boolean).join("/")}`
  : `/deck/${encodeURIComponent(DECK_FILE)}`;
const DECK_BASE = DECK_PAGE.slice(0, DECK_PAGE.lastIndexOf("/") + 1);
/* A file to serve: inside its base by path, and inside the deck or an asset root once symlinks are
   followed. null: refuse. A missing file passes, and is answered 404. */
function servable(base, rel) {
  const f = safeJoin(base, rel);
  if (!f) return null;
  let real;
  try { real = fs.realpathSync(f); } catch { return f; }
  return ALLOWED_REAL.some((d) => within(d, real)) ? f : null;
}
const saveSettings = () => fs.writeFile(CONFIG_FILE, JSON.stringify({ ...fileConfig, model: settings.model, effort: settings.effort }, null, 2) + "\n", () => {});
const completeSettings = () => {   // create or complete the file (at start, once the port is bound)
  if (fileConfig.model !== settings.model || fileConfig.effort !== settings.effort) saveSettings();
};
if (MODEL) settings.model = MODEL;   // --model on the command line: this run only, not saved

const status = () => ({ busy: state.busy, model: state.model, sessionId: state.sessionId, settings: { ...settings },
  running: session.running, deck: DECK_DIR, deckFile: DECK_FILE, chrome: CAPS.screenshot.available,
  capabilities: publicCapabilities(CAPS), rev: deckRev(),
  undo: changeLabel(liveTurns().at(-1)), redo: changeLabel(state.redo.at(-1)) });
const pushStatus = () => broadcast("status", status());

const systemPrompt = fs.readFileSync(path.join(EDITOR_DIR, "lib/system-prompt.md"), "utf8")
  .replaceAll("{{CLI}}", CLI_CMD).replaceAll("{{DECK}}", DECK_FILE) + capabilityPrompt(CAPS, CLI_CMD) +
  // a template's own notes usually say index.html; other decks may share this folder
  (NAMED ? `\n\n## This deck's file\nThe slides are in ${DECK_FILE}. Where the deck's notes below say index.html, they mean ` +
    `${DECK_FILE}. Other .html files in this folder are other decks: do not edit them.\n` : "") +
  (ASSET_ROOTS.length ? `\n\n## Files outside the deck folder\nThe deck may use files in ${ASSET_ROOTS.join(", ")}: refer to ` +
    `them with paths relative to ${DECK_FILE} (such as ../shared/style.css). You can read them; do not edit them, ` +
    `other decks may use them too.\n` : "") +
  (DECK_SELECTOR ? `\n\n## Slides of this deck\nThis deck is not made with reveal.js: its slides are the elements matching the ` +
    `CSS selector \`${DECK_SELECTOR}\` (<meta name="pindeck:slides">), and the deck's own script shows them. Where these ` +
    `instructions say <section> or reveal.js, read an element matching that selector, and that script. A new slide is ` +
    `a new such element next to the others; keep the pindeck meta tags. Hidden slides (data-visibility="hidden") are ` +
    `left out of PinDeck's PDF exports; whether presenting skips them depends on the deck's script.\n` : "");
/* What Claude may never change, whatever the edit rules allow: the locked brand files, vendored libraries,
   git's own files, and other decks in this folder (a named deck shares its folder with them). Deny rules
   win over allow rules; a locked file changed anyway is restored after the turn (lock 2 in finishTurn). */
function lockedPaths() {
  let others = [];
  try { others = fs.readdirSync(DECK_DIR).filter((f) => /\.html?$/i.test(f) && f !== DECK_FILE); } catch {}
  return [...LOCKED, "vendor/**", ".git/**", ...others];
}
/* Claude Code loads no settings files (--setting-sources ""): an allow rule in the user's, the deck's
   or a parent repo's settings would let Claude run more than PinDeck grants (and the user's hooks and
   MCP servers have no place in a slide editor). That also skips CLAUDE.md files, so the deck's own go
   into the system prompt instead, read afresh at each session start: CLAUDE.md and AGENTS.md (the name
   other coding agents read), with their @path imports (lib/instructions.mjs). Parent folders' files are
   not loaded; a deck imports shared rules explicitly. Decks copied from the example call the CLI as
   `node ../cli.mjs`, which is right only next to PinDeck: that becomes this server's command. */
function deckInstructions() {
  return ["CLAUDE.md", "AGENTS.md"].map((name) => {
    const s = readInstructions(path.join(DECK_DIR, name));
    return s ? `\n\n## The deck's ${name}\n${s.replace(/node \.\.\/cli\.mjs\b/g, () => CLI_CMD)}\n` : "";
  }).join("");
}
let stderrTail = "";
const session = new ClaudeSession({
  cwd: DECK_DIR,
  env: () => ({ DECK_EDITOR_URL: ORIGIN, DECK_EDITOR_TOKEN: TOKEN }),
  args: () => [
    "--append-system-prompt", systemPrompt + deckInstructions(),
    "--setting-sources", "", "--strict-mcp-config",   // no settings files, no MCP servers or connectors
    "--permission-mode", "default",
    // any file in the deck folder (Edit rules cover Write too; Write is named as well, to be explicit)
    "--allowedTools", "Read", "Glob", "Grep", "Edit(./**)", "Write(./**)", `Bash(${CLI_CMD}:*)`,
    "--disallowedTools", ...lockedPaths().flatMap((f) => [`Edit(./${f})`, `Write(./${f})`]),
    ...(settings.model ? ["--model", settings.model] : []),
    ...(settings.effort ? ["--effort", settings.effort] : []),
  ],
  onStderr: (s) => { stderrTail = (stderrTail + s).slice(-2000); },
  onEvent: handleEvent,
  onExit: (code, signal, { stale } = {}) => {
    if (state.busy && state.turn && !stale) {
      const why = code == null && signal == null ? "could not start" : `stopped (${signal || "exit " + code})`;
      const hint = /ENOENT/.test(stderrTail) ? " Is the claude command installed and on the PATH (or set CLAUDE_BIN)?" : "";
      finishTurn({ error: `Claude Code ${why}. ${stderrTail.trim().split("\n").pop() || ""}${hint}` });
    }
    pushStatus();
  },
});
function ensureSession() {
  if (session.running || quitting || !detectCapabilities().claude.available) return;
  stderrTail = "";
  session.start(state.sessionId);
  pushStatus();
}

function toolSummary(name, input = {}) {
  // files outside the deck (screenshots, attached PDFs) by their name only
  const base = (p) => {
    if (!p) return "";
    const r = path.relative(DECK_DIR, p);
    return !r || r.startsWith("..") ? path.basename(p) : r;
  };
  switch (name) {
    case "Read": return { name: "Read", detail: base(input.file_path) };
    case "Edit": case "MultiEdit": case "Write": return { name: "Edit", detail: base(input.file_path) };
    case "Bash": {
      // a PinDeck command only when the whole command is one: a script that ends in `cli.mjs layout`
      // must show as the script, or a refused script looks like a refused layout check
      const cmd = String(input.command || "").trim();
      const m = cmd.startsWith(CLI_CMD + " ") && cmd.slice(CLI_CMD.length).match(/^\s+([\w-]+)\s*([^\n;&|<>`$]*)$/);
      const names = { shot: "Screenshot", layout: "Check layout", "pdf-figure": "PDF figure" };
      return m ? { name: names[m[1]] || m[1], detail: m[1] === "pdf-figure" ? m[2].trim().replace(/^\S*\//, "") : m[2].trim() }
               : { name: "Run", detail: cmd.split("\n")[0].slice(0, 80) };
    }
    case "Glob": case "Grep": return { name, detail: input.pattern || "" };
    default: return { name, detail: "" };
  }
}
const toolEntries = new Map(); // tool_use_id -> entry
function handleEvent(ev) {
  if (ev.type === "system" && ev.subtype === "init") {
    state.model = ev.model || state.model;
    state.sessionId = ev.session_id;
    saveChat();
    pushStatus();
  } else if (ev.type === "assistant" && state.turn) {
    for (const b of ev.message?.content || []) {
      if (b.type === "text" && b.text.trim()) addEntry({ kind: "assistant", text: b.text.trim() });
      if (b.type === "tool_use") toolEntries.set(b.id, addEntry({ kind: "tool", ...toolSummary(b.name, b.input) }));
    }
  } else if (ev.type === "user" && state.turn) {
    for (const b of ev.message?.content || []) {
      if (b.type === "tool_result" && b.is_error) {
        const e = toolEntries.get(b.tool_use_id);
        const msg = (Array.isArray(b.content) ? b.content.map((c) => c.text || "").join(" ") : String(b.content || "")).slice(0, 200);
        if (e) { e.error = msg; broadcast("chat-update", e); }
      }
    }
  } else if (ev.type === "result" && state.turn) {
    finishTurn({
      error: ev.is_error && ev.subtype !== "success" ? (ev.subtype === "error_during_execution" ? "Stopped." : ev.result || ev.subtype) : null,
      cost: ev.total_cost_usd, duration: ev.duration_ms,
      denials: (ev.permission_denials || []).map((d) => toolSummary(d.tool_name, d.tool_input)),
    });
  }
}

function startTurn(promptText, userEntry) {
  // every deck file as it is now: Claude may change any of them (not brand.css or vendor/), and undo
  // takes back all it changed
  state.turn = { id: userEntry.id, before: snapshot([...EDITABLE, ...LOCKED]), scan: scanFiles(DECK_DIR) };
  state.busy = true;
  pushStatus();
  ensureSession();
  if (!session.running) return finishTurn({ error: detectCapabilities().claude.reason || "Claude Code could not be started." });
  session.send([{ type: "text", text: promptText }]);
}

function finishTurn({ error, cost, duration, denials = [] }) {
  const turn = state.turn;
  state.turn = null;
  state.busy = false;
  if (!turn) return pushStatus();
  // Lock 2: restore any locked file that changed during the turn
  const restored = [];
  for (const f of LOCKED) {
    const now = readDeck(f);
    if (now === turn.before[f]) continue;
    if (turn.before[f] != null) writeDeck(f, turn.before[f]);
    else fs.rmSync(path.join(DECK_DIR, f), { force: true });   // a locked file that Claude created
    restored.push(f);
  }
  toolEntries.clear();
  const eid = runEidPass();
  const { changed, tooLarge } = scanChanges(turn.scan, scanFiles(DECK_DIR));
  const before = {}, after = {};
  for (const [rel, c] of Object.entries(changed)) { before[rel] = c.before; after[rel] = c.after; }
  // the deck file and theme.css first, then the rest by name
  const order = (rel) => (EDITABLE.includes(rel) ? EDITABLE.indexOf(rel) : EDITABLE.length);
  const files = Object.keys(changed).sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map((rel) => fileChange(rel, before[rel], after[rel]));
  // after a hand-off: imported pictures that Claude replaced (nothing refers to them any more) are
  // deleted; undo brings them back with the turn
  const deletedFiles = [];
  for (const rel of turn.importedFiles || []) {
    const abs = path.join(DECK_DIR, rel);
    if (!fs.existsSync(abs) || EDITABLE.some((f) => (after[f] || "").includes(rel))) continue;
    deletedFiles.push({ rel, data: fs.readFileSync(abs) });
    fs.rmSync(abs, { force: true });
  }
  const t = { id: turn.id, kind: "claude", before, after, files, deletedFiles, undone: false };
  if (files.length) { state.turns.push(t); state.redo = []; }
  addEntry({ kind: "turn", turnId: files.length ? t.id : null, files, error, cost, duration,
    denials, restored, newIds: eid.assigned.length });
  if (deletedFiles.length) addEntry({ kind: "notice", text: `Removed ${deletedFiles.map((f) => f.rel).join(", ")}: replaced, and no longer used.` });
  if (tooLarge.length) addEntry({ kind: "notice", text: `${tooLarge.join(", ")} changed in this turn but ${tooLarge.length > 1 ? "are" : "is"} ` +
    `too large to keep a copy of (over 2 MB): Undo leaves ${tooLarge.length > 1 ? "them" : "it"} as ${tooLarge.length > 1 ? "they are" : "it is"}.` });
  pushStatus();
}

/* ---- Attachments: figures, audio and PDFs added to a chat message ------------------------------------
   Figures and audio go into <deck>/figures/ (paths relative to the deck). PDFs are reading material for
   Claude (a paper, a report, a figure or table to take over) and stay outside the deck, in PDF_DIR
   (absolute paths); `cli.mjs pdf-figure` renders a page or part of one into figures/ when it is needed. */
const ATTACH_TYPES = {
  image: ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif"],
  audio: ["wav", "mp3", "ogg", "oga", "m4a", "aac", "flac", "opus"],
  pdf: ["pdf"],
};
const uploadFile = (p) => (path.isAbsolute(p) ? p : path.join(DECK_DIR, p));
const ATTACH_MAX = 100 * 1024 * 1024;
const attachKind = (name) => {
  const ext = path.extname(name).slice(1).toLowerCase();
  return Object.keys(ATTACH_TYPES).find((k) => ATTACH_TYPES[k].includes(ext)) || null;
};
/* A clean, unused file name in figures/ (or in dir): "My Figure (2).PNG" -> "figures/my-figure-2.png" */
const slug = (name) => name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "file";
function attachPath(original, dir = "figures") {
  const ext = path.extname(original).toLowerCase();
  const base = slug(path.basename(original, path.extname(original)));
  let rel = `${dir}/${base}${ext}`, k = 2;
  while (fs.existsSync(uploadFile(rel))) rel = `${dir}/${base}-${k++}${ext}`;
  return rel;
}
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);
function formatAttachment(a) {
  if (a.kind === "pdf")
    return `- ${a.path}: PDF, ${a.pages ? `${a.pages} page${a.pages > 1 ? "s" : ""}${a.pageSize ? ` (${a.pageSize[0]} × ${a.pageSize[1]} pt)` : ""}, ` : ""}${kb(a.bytes)}. ` +
      `Read it directly${a.pages > 10 ? ' with pages (e.g. "1-5"), at most 20 per Read' : ""}; for a figure or table from it, see "Attached PDFs".`;
  if (a.kind === "image")
    return `- ${a.path}: image${a.width ? `, ${a.width} × ${a.height} px` : ""}, ${kb(a.bytes)}` +
      (/\.(png|jpe?g|gif|webp)$/i.test(a.path) ? ". Read it directly to see it (no resizing needed)." : a.path.endsWith(".svg") ? " (SVG, readable as text)." : ".");
  const meta = [a.duration ? `${a.duration.toFixed(1)} s` : "", a.sampleRate ? `${Math.round(a.sampleRate / 1000)} kHz` : "",
    a.channels ? (a.channels === 1 ? "mono" : `${a.channels} channels`) : "", kb(a.bytes)].filter(Boolean).join(", ");
  return `- ${a.path}: audio, ${meta}` + (a.waveform ? `; waveform image ${a.waveform} (bars, viewBox 1000 × 120) for an audio player with waveform.` : ".");
}
const formatDrop = (a) => (a.droppedAt?.slide ? ` Dropped onto slide ${a.droppedAt.slide.index + 1} (${a.droppedAt.slide.eid}) at ` +
  `x=${a.droppedAt.point.x} y=${a.droppedAt.point.y}${a.droppedAt.eid ? `, over ${a.droppedAt.eid}` : ""}: probably where the user wants it.` : "");

function buildPrompt({ text: userText, pins = [], selection, layouts = [], current, screenshot, attachments = [] }) {
  const ctx = [];
  if (current) ctx.push(`The user is looking at slide ${current.index + 1} (${current.eid}).`);
  if (state.notes.length) {
    const notes = state.notes.slice(-15);
    if (state.notes.length > notes.length) ctx.push(`Note: ${state.notes.length - notes.length} earlier changes are not listed; re-read the files.`);
    ctx.push(...notes.map((n) => "Note: " + n));
    state.notes = [];
  }
  if (selection) ctx.push(`Selected element (what "this" or "it" most likely refers to): ${selection.eid} (${selection.tag}), ` +
    `box x=${selection.box.x} y=${selection.box.y} w=${selection.box.w} h=${selection.box.h} on slide ${selection.slide.index + 1}.`);
  if (pins.length) ctx.push("Pins (numbered clicks; the user refers to them by number):\n" + pins.map(formatPin).join("\n"));
  for (const L of layouts) ctx.push("Layout:\n" + formatLayout(L));
  if (screenshot) ctx.push(`Screenshot of slide ${screenshot.slide} with the pin markers: ${screenshot.path} (Read it).`);
  if (attachments.length) ctx.push("Attached files (the user added them to this message; they are saved in the deck folder, " +
    `use these paths relative to ${DECK_FILE}):\n` + attachments.map((a) => formatAttachment(a) + formatDrop(a)).join("\n"));
  return (ctx.length ? `<editor-context>\n${ctx.join("\n\n")}\n</editor-context>\n\n` : "") + userText;
}

/* `cli.mjs pdf-figure <pdf> <page> [x,y,w,h] [figures/name.png] [--width px]`: renders a PDF page, or a box
   of it given as fractions of the page from the top left, to PNG. Without a figures/ name it goes to the
   screenshots folder, for Claude to look at before choosing; with one, into the deck. */
async function pdfFigure({ file = "", page = "1", box = "", out = "", width = "" }) {
  const bad = (t, status = 400) => ({ status, text: t });
  if (!CAPS.pdfPages.available) return bad(CAPS.pdfPages.reason, 501);
  const abs = [path.isAbsolute(file) ? file : path.join(DECK_DIR, file), path.join(PDF_DIR, path.basename(file))]
    .map((f) => path.resolve(f)).find((f) => /\.pdf$/i.test(f) && fs.existsSync(f) &&
      [DECK_DIR, PDF_DIR].some((d) => f.startsWith(d + path.sep)));
  if (!abs) return bad(`No PDF "${file}": use the path from the attached files, or a .pdf in the deck folder.`, 404);
  const info = await pdfInfo(abs, STATE_DIR);
  const n = Number(page);
  if (!(Number.isInteger(n) && n >= 1 && n <= info.pages)) return bad(`No page ${page}: the PDF has ${info.pages} page${info.pages > 1 ? "s" : ""}.`);
  const f = box ? box.split(",").map(Number) : [0, 0, 1, 1];
  if (f.length !== 4 || f.some((v) => !(v >= 0 && v <= 1)) || !f[2] || !f[3] || f[0] + f[2] > 1.001 || f[1] + f[3] > 1.001)
    return bad("The box is x,y,w,h as fractions of the page (0 to 1, from the top left), e.g. 0.1,0.25,0.8,0.3.");
  const [pw, ph] = info.sizes[n - 1];
  const pts = [f[0] * pw, f[1] * ph, Math.min(f[2], 1 - f[0]) * pw, Math.min(f[3], 1 - f[1]) * ph];
  const scale = Math.min(8, Math.max(100, Math.min(4000, Number(width) || 1600)) / pts[2]);   // output px per point
  if (out && !/^figures\/[a-z0-9][a-z0-9._-]*\.png$/i.test(out)) return bad("The output is a PNG in figures/, e.g. figures/paper-fig3.png.");
  if (out && fs.existsSync(path.join(DECK_DIR, out)) && !state.pdfFigures.has(out)) return bad(`${out} exists already; choose another name.`, 409);
  const tmp = path.join(SHOT_DIR, `pdf-${slug(path.basename(abs, ".pdf"))}-p${n}-${Date.now()}.png`);
  await renderJobs(abs, [{ page: n, out: tmp, box: pts, scale }], STATE_DIR, { slideWidth: pw });
  if (!fs.existsSync(tmp)) return bad("The PDF page could not be rendered.", 500);
  const size = `${Math.round(pts[2] * scale)} × ${Math.round(pts[3] * scale)} px`;
  if (!out) return { text: `${tmp} (${size}). Read it; add a figures/ name to save it into the deck.` };
  const buf = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  writeDeckFile(out, buf);
  state.pdfFigures.add(out);
  return { text: `${out} (${size})` };
}

/* ---- File watching --------------------------------------------------------------------------
   Changes are collected for 120 ms and sent to the editor with the deck's revision, so a tab that missed
   events (reconnect) can still tell that it shows an old state. Dot files (PinDeck's temporary files,
   editors' swap files), backups and export/ are ignored. If the watcher fails (folder replaced, too many
   files), it is started again and the editor told to reload everything. */
let changed = new Set(), flush = null, eidTimer = null, watcher = null;
function onFileEvent(_ev, file) {
  if (!file) { changed.add(DECK_FILE); return scheduleFlush(); }   // some systems omit the name: assume the deck
  file = String(file).split(path.sep).join("/");
  if (/(^|\/)\.|\.bak$|~$|^export\//.test(file)) return;
  changed.add(file);
  scheduleFlush();
}
function scheduleFlush() {
  clearTimeout(flush);
  flush = setTimeout(() => {
    const files = [...changed];
    changed = new Set();
    let external = false, manual = true;
    for (const f of files) {
      const c = readDeck(f);
      const w = ourWrites.get(f);
      if (c != null && w && w.hash === hash(c)) { if (!w.manual) manual = false; continue; }
      manual = false;
      if (EDITABLE.includes(f) && !state.busy) external = true;
    }
    if (external) {
      state.notes = [...new Set([...state.notes,
        "The deck files changed outside this chat since your last turn (edited by hand or by another tool). Re-read before editing."])];
      // new elements from a hand edit get ids once the file is quiet: unchanged for 800 ms and present
      clearTimeout(eidTimer);
      const seen = hash(readDeck(DECK_FILE) ?? "");
      const pass = () => {
        if (state.busy) return;
        const now = readDeck(DECK_FILE);
        if (now == null || hash(now) !== seen) return;   // still being written; its own event comes
        runEidPass();
      };
      eidTimer = setTimeout(pass, 800);
    }
    // manual: only drag/resize writes, which the browser already shows; no reload of the visible slide
    broadcast("files", { files, manual, rev: deckRev() });
  }, 120);
}
/* Linux: Node's recursive watch follows files by inode there, and loses a file once it is replaced by a
   rename, the way most editors and PinDeck itself save: later changes to index.html went unseen. Watching
   every folder (inotify on directories) keeps working; folders created later are added as they appear.
   Hidden folders (.git) and node_modules are skipped. */
function watchFolders(root, onEvent) {
  const watchers = new Map(), tree = new EventEmitter();
  const add = (dir) => {
    if (watchers.has(dir)) return;
    let w;
    try {
      w = fs.watch(dir, (ev, name) => {
        if (name == null) return onEvent(ev, null);
        const abs = path.join(dir, String(name));
        if (ev === "rename") { try { if (fs.statSync(abs).isDirectory()) scan(abs); } catch {} }
        onEvent(ev, path.relative(root, abs));
      });
    } catch (e) {
      if (dir === root) throw e;
      return;
    }
    w.on("error", (e) => {
      try { w.close(); } catch {}
      watchers.delete(dir);
      if (dir === root) tree.emit("error", e);   // a removed subfolder just drops out
    });
    watchers.set(dir, w);
  };
  const scan = (dir) => {
    add(dir);
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
    for (const d of entries) if (d.isDirectory() && !d.name.startsWith(".") && d.name !== "node_modules") scan(path.join(dir, d.name));
  };
  scan(root);
  tree.close = () => { for (const w of watchers.values()) try { w.close(); } catch {} watchers.clear(); };
  return tree;
}
function startWatcher() {
  watcher = process.platform === "linux" ? watchFolders(DECK_DIR, onFileEvent)
    : fs.watch(DECK_DIR, { recursive: true }, onFileEvent);
  watcher.on("error", (e) => {
    console.error(`Watching ${DECK_DIR} failed (${e.message}); starting again.`);
    try { watcher.close(); } catch {}
    setTimeout(() => {
      if (quitting) return;
      try { startWatcher(); } catch (e2) { console.error(`Cannot watch ${DECK_DIR}: ${e2.message}`); }
      broadcast("files", { files: [...EDITABLE], manual: false, rev: deckRev(), resync: true });
    }, 1000);
  });
}

/* ---- Hand edits ----------------------------------------------------------------------------------------- */
function recordHandEdit(before, html, label, note, { manual = true, deletedFiles = [], addedFiles = [], chat = true } = {}) {
  writeDeck(DECK_FILE, html, manual);
  const after = snapshot(EDITABLE);
  const d = unifiedDiff(before[DECK_FILE], after[DECK_FILE], DECK_FILE);
  const t = { id: state.seq + 1, kind: "manual", label, before, after, deletedFiles, addedFiles,
    files: [{ file: DECK_FILE, added: d.added, removed: d.removed }], undone: false };
  state.turns.push(t);
  state.redo = [];
  // chat: false keeps the edit out of the chat (it stays in the undo history and Claude is still told)
  if (chat) addEntry({ kind: "edit", turnId: t.id, label, files: t.files });
  else state.seq++;   // keep turn ids unique: they share the counter with chat entries
  state.notes.push(note);
  pushStatus();
  return t.id;
}

/* What deleting an element would remove, and which of its files nothing else uses. Files outside the
   deck folder, in vendor/, or still referenced elsewhere (index.html, theme.css) are never offered. */
function deletePlan(eid) {
  const html = readDeck(DECK_FILE);
  const target = deleteTarget(html, eid);
  if (!target) return null;
  const rest = removeElement(html, target.eid);
  const css = (readDeck("theme.css") || "") + (readDeck("brand.css") || "");
  const files = fileRefs(target.outer).flatMap((ref) => {
    const abs = path.resolve(DECK_DIR, ref);
    const rel = path.relative(DECK_DIR, abs).split(path.sep).join("/");
    if (rel.startsWith("..") || rel.startsWith("vendor/") || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) return [];
    const usedElsewhere = fileRefs(rest).some((r) => path.resolve(DECK_DIR, r) === abs) || css.includes(ref) || css.includes(rel);
    return [{ rel, bytes: fs.statSync(abs).size, usedElsewhere }];
  });
  return { ...target, html: rest, files };
}

/* ---- Undo (Claude's turns and hand edits share one history) ----------------------------------------
   Undo puts back the files as they were before a change, Redo as they were after it. Both first check that
   every file they touch is exactly as that change left it (or, for Redo, as the undo left it): the editable
   files, and the pictures or audio files they would delete or bring back. Anything else means the files
   were changed since, by hand or by another program, and going back would silently throw that work away.
   Then nothing is written and the answer is 409 with the files that differ. */
function undoConflicts(t, direction) {
  const expect = direction === "undo" ? t.after : t.before;
  const files = changeFiles(t).filter((rel) => !isAs(rel, expect[rel]));
  // undo brings deleted files back (their place must be free, or hold the same bytes) and removes added
  // ones (which must be unchanged); redo the other way round
  const comeBack = direction === "undo" ? t.deletedFiles || [] : t.addedFiles || [];
  const go = direction === "undo" ? t.addedFiles || [] : t.deletedFiles || [];
  for (const { rel, data } of comeBack) {
    const abs = path.join(DECK_DIR, rel);
    if (fs.existsSync(abs) && !sameContent(abs, data)) files.push(rel);
  }
  for (const { rel, data } of go) {
    const abs = path.join(DECK_DIR, rel);
    if (fs.existsSync(abs) && !sameContent(abs, data)) files.push(rel);
  }
  return files;
}
function conflict(res, direction, files) {
  json(res, 409, { code: "diverged", files,
    error: `${files.join(", ")} changed since then (edited outside PinDeck?), so ${direction === "undo" ? "Undo" : "Redo"} was not done: ` +
      `it would overwrite those changes. Reload to see the files as they are.` });
}
function undo(res) {
  if (state.busy) return json(res, 409, { error: "Wait until Claude has finished." });
  const t = liveTurns().at(-1);
  if (!t) return json(res, 409, { error: "Nothing to undo." });
  const diverged = undoConflicts(t, "undo");
  if (diverged.length) return conflict(res, "undo", diverged);
  for (const rel of changeFiles(t)) if (!isAs(rel, t.before[rel])) putDeckFile(rel, t.before[rel] ?? null);   // null: the change created it
  for (const { rel, data } of t.deletedFiles || []) writeDeckFile(rel, data, false);   // files deleted with an element come back too
  for (const { rel } of t.addedFiles || []) fs.rmSync(path.join(DECK_DIR, rel), { force: true });   // imported figures go
  t.undone = true;
  state.redo.push(t);
  state.notes.push(t.kind === "manual"
    ? `The user undid their hand edit (${t.label}); ${DECK_FILE} is back to the state before it.`
    : `The user undid your change from turn ${t.id}; ${t.files.map((f) => f.file).join(" and ")} are back to the state before it. Re-read before editing.`);
  broadcast("undone", { turnId: t.id, undone: true });
  pushStatus();
  return json(res, 200, {});
}

/* ---- PowerPoint import -----------------------------------------------------------------------------
   Upload: the file is read at once (slide list for the dialog); in the background PowerPoint or Keynote
   makes a PDF of it, from which come the thumbnails and, on import, the pictures of diagrams.
   Only the latest upload is kept, in ~/.pindeck/decks/<deck>/imports/. */
const IMPORT_DIR = path.join(STATE_DIR, "imports");
const IMPORT_MAX = 500 * 1024 * 1024;
let lastImport = null;   // { id, name, dir, model, render: Promise<pdf path | null>, renderError }

function startImport(name, buf) {
  const model = readPptx(buf);   // first: a file that cannot be read leaves the previous import as it was
  if (lastImport) fs.rm(lastImport.dir, { recursive: true, force: true }, () => {});
  const id = crypto.randomBytes(6).toString("hex");
  const dir = path.join(IMPORT_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "deck.pptx");
  fs.writeFileSync(file, buf);
  const imp = { id, name, dir, model, renderError: null };
  imp.render = !renderAvailable() ? Promise.resolve(null) : (async () => {
    try {
      const { pdf, app } = await pptxToPdf(file, dir);
      await renderJobs(pdf, model.slides.map((s) => ({ page: s.n, out: path.join(dir, `thumb-${s.n}.png`), width: 320 })), dir);
      if (lastImport === imp) broadcast("import", { id, thumbs: true, app });
      return pdf;
    } catch (e) {
      imp.renderError = String(e.message || e);
      if (lastImport === imp) broadcast("import", { id, error: imp.renderError });
      return null;
    }
  })();
  lastImport = imp;
  return imp;
}

async function applyImport(imp, numbers, afterEid, refine = false) {
  const pdf = await imp.render;
  const before = snapshot(EDITABLE);
  const html0 = before[DECK_FILE];
  const slides = findSlides(parse(html0));
  if (!slides.length) throw new Error("The deck has no slides to add to.");
  const found = slides.findIndex((s) => s.attrs["data-eid"]?.value === afterEid);
  const afterIdx = found < 0 ? slides.length - 1 : found;   // no such slide (any more): at the end
  const after = slides[afterIdx];
  const css = (readDeck("theme.css") || "") + (readDeck("brand.css") || "");
  const prefix = path.basename(imp.name, path.extname(imp.name)).normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").split("-").slice(0, 3).join("-") || "import";
  const r = await buildImport({ model: imp.model, numbers, pdf, workDir: imp.dir, deckDir: DECK_DIR, deckHtml: html0, css, after: afterIdx, prefix });
  // building takes a while (pictures are cut from the slides): a change made meanwhile must not be overwritten
  if (EDITABLE.some((f) => readDeck(f) !== before[f])) throw new Error("The deck changed during the import. Import again.");
  // the new slides go after the current one, at its indentation
  const end = elementEnd(html0, after);
  const ls = html0.lastIndexOf("\n", after.start - 1) + 1;
  const indent = /^\s*$/.test(html0.slice(ls, after.start)) ? html0.slice(ls, after.start) : "";
  const html = assignEids(html0.slice(0, end) + r.fragments.map((f) => `\n\n${indent}` + f).join("") + html0.slice(end)).html;
  for (const f of r.files) writeDeckFile(f.rel, f.data);   // manual: no reload for each new file
  const all = findSlides(parse(html));
  const first = afterIdx + 1, last = afterIdx + r.fragments.length;
  const eids = all.slice(first, last + 1).map((s) => s.attrs["data-eid"]?.value);
  const range = first === last ? `slide ${first + 1}` : `slides ${first + 1}–${last + 1}`;
  const cut = r.plans.flatMap((p) => p.figures.filter((f) => f.crop && !f.missing).map((f) => f.file));
  const lost = r.plans.reduce((n, p) => n + (p.lostSteps || 0), 0);
  const turnId = recordHandEdit(before, html, `Imported ${r.fragments.length} slide${r.fragments.length > 1 ? "s" : ""} from ${imp.name} (${range})`,
    `The user imported ${r.fragments.length} slide(s) from the PowerPoint file "${imp.name}" as ${range} (${eids.join(", ")}). ` +
    `Text and tables became HTML in the deck's layouts, build steps fragments, audio the deck's audio player; ` +
    (cut.length ? `diagrams, charts and other drawings are pictures cut from PowerPoint's rendering of the slide (${cut.join(", ")}). ` : "") +
    (lost ? `${lost} build step(s) on parts of a picture could not be kept. ` : "") +
    `Hidden PowerPoint slides are hidden here too. The layout is a first approximation: check it before relying on it.`,
    { manual: true, addedFiles: r.files });
  const refining = refine && !state.busy ? await refineImport(imp, pdf, r.plans, eids, first) : 0;
  return { turnId, index: first, eid: eids[0], count: r.fragments.length, refining,
    missing: r.plans.flatMap((p) => p.figures.filter((f) => f.missing)).length };
}

/* The hand-off: Claude gets the slides the import could only approximate, each with a picture of the
   original slide, and improves them in the deck's style. Returns the number of slides handed over. */
async function refineImport(imp, pdf, plans, eids, first) {
  const todo = plans.map((p, i) => ({ p, index: first + i, eid: eids[i] })).filter((x) => x.p.complex.length);
  if (!todo.length) return 0;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const original = (n) => path.join(SHOT_DIR, `import-${imp.id}-${n}.png`);
  if (pdf) {
    try { await renderJobs(pdf, todo.map((x) => ({ page: x.p.n, out: original(x.p.n), width: 1280 })), imp.dir); }
    catch (e) { console.error(e); }
  }
  const nums = todo.map((x) => x.index + 1);
  const list = nums.length === 1 ? `slide ${nums[0]}` : `slides ${nums.slice(0, -1).join(", ")} and ${nums.at(-1)}`;
  const visible = `Improve the imported ${list}: compare ${todo.length === 1 ? "it" : "each"} with the original PowerPoint slide and rebuild what the import could only approximate.`;
  const details = todo.map(({ p, index, eid }) => {
    const pics = p.figures.filter((f) => f.crop && !f.missing && f.labels?.length)
      .map((f) => `  ${f.file} (${f.table ? "table" : `${f.shapes} shapes`}); its texts: ${f.labels.map((l) => JSON.stringify(l)).join(", ")}`);
    return `- Slide ${index + 1} (${eid}), PowerPoint slide ${p.n}: ${p.complex.join("; ")}.` +
      (fs.existsSync(original(p.n)) ? `\n  Original slide: ${original(p.n)} (Read it).` : "") + (pics.length ? "\n" + pics.join("\n") : "");
  }).join("\n");
  const text = visible + "\n\n" +
    `How to work, slide by slide: Read the original picture, look at the imported slide (\`${CLI_CMD} shot <n>\`), then improve it ` +
    `in this deck's own style (theme.css):\n` +
    `- Diagrams of boxes, arrows and text that became a picture: rebuild them as inline SVG in the deck's diagram style, ` +
    `using the texts listed. Keep a picture if it is a plot, a photo or too intricate to redraw well. Do not delete a picture ` +
    `you replaced: PinDeck removes it after your turn once nothing refers to it.\n` +
    `- Equations that are pictures: write them as TeX (\\( \\) or \\[ \\]) if you can read them.\n` +
    `- Tables kept as pictures: make them HTML tables in the deck's table style, marking highlighted rows as the deck does.\n` +
    `- Build steps lost on parts of a diagram: add them back as fragments when you rebuild it.\n` +
    `- Layout: nothing may overflow or overlap; check with \`${CLI_CMD} layout ${nums.join(" ")} --issues\`.\n` +
    `Keep the wording of the text and the speaker notes.\n\n${details}`;
  const entry = addEntry({ kind: "user", text: visible });
  startTurn(buildPrompt({ text }), entry);
  state.turn.importedFiles = todo.flatMap(({ p }) => p.figures.filter((f) => f.crop && !f.missing).map((f) => f.file));
  return todo.length;
}

/* ---- HTTP ------------------------------------------------------------------------------------- */
const BRIDGE_TAG = `<script src="/editor/bridge.js"></script>\n</body>`;
/* Pages opened as 127.0.0.1 or localhost only, on any port: an SSH tunnel may use another local port.
   Another site's name pointed at 127.0.0.1 (DNS rebinding) must not read the editor page, its token or the deck. */
const goodHost = (h) => /^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(h);

/* Who may read the editor, the deck and the API. The token never appears in a page or on a command line,
   where other users of a shared server could read it (ps, curl). A browser logs in once with a one-time
   code (printed at start, or by `pindeck login`) and then holds the token in an HttpOnly cookie; the CLI
   and Claude send it in a header. Browsers share cookies across all ports of a host, so the cookie name
   carries this server's port. */
const loginCodes = new Map();   // code -> expiry (ms)
function loginCode(ttl) {
  const now = Date.now();
  for (const [c, exp] of loginCodes) if (exp < now) loginCodes.delete(c);
  const code = crypto.randomBytes(16).toString("hex");
  loginCodes.set(code, now + ttl);
  return code;
}
const loginUrl = (code, next = "/") => `${ORIGIN}/login?` + new URLSearchParams({ code, ...(next !== "/" ? { next } : {}) });
const cookieName = () => `pindeck-${PORT}`;
const sameSecret = (a) => typeof a === "string" && a.length === TOKEN.length &&
  crypto.timingSafeEqual(Buffer.from(a), Buffer.from(TOKEN));
function cookie(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
const authed = (req) => sameSecret(req.headers["x-editor-token"]) || sameSecret(cookie(req, cookieName()));
const LOGIN_PAGE = `<!doctype html><meta charset="utf-8"><title>PinDeck</title>
<body style="font:16px system-ui,sans-serif;max-width:36em;margin:4em auto;padding:0 1em">
<h1>Log in to PinDeck</h1><p>Open the login link that PinDeck printed when it started. Links work once;
for a new one, run <code>pindeck login</code> in the deck folder (or <code>node server.mjs login</code> in a
PinDeck checkout).</p>`;
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
  let next = url.searchParams.get("next") || "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) next = "/";
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store",
    "set-cookie": `${cookieName()}=${TOKEN}; HttpOnly; SameSite=Strict; Path=/` });
  const to = JSON.stringify(next).replace(/</g, "\\u003c");
  res.end(`<!doctype html><meta charset="utf-8"><title>PinDeck</title><script>location.replace(${to})</script>`);
}
/* Headless Chrome gets a start page in its own profile folder (0700) instead of a URL with a secret on
   its command line: the page sends it to a one-time login code, which leads on to the target. */
function chromeStart(profile, target) {
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  const start = path.join(profile, "pindeck-start.html");
  const to = loginUrl(loginCode(120000), target.slice(ORIGIN.length)).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  fs.writeFileSync(start, `<!doctype html><meta http-equiv="refresh" content="0;url=${to}">`, { mode: 0o600 });
  return pathToFileURL(start).href;
}

/* Files with a length and byte ranges: Safari plays audio and video only from servers that answer a
   Range request with 206, and seeking needs it everywhere. Transformed (HTML) files are sent whole. */
function serveFile(res, file, transform, req) {
  const type = MIME[path.extname(file).slice(1).toLowerCase()] || "application/octet-stream";
  if (transform) return fs.readFile(file, (err, data) => {
    if (err) return text(res, 404, "Not found");
    const out = Buffer.from(transform(String(data)));
    res.writeHead(200, { "content-type": type, "content-length": out.length, "cache-control": "no-store" });
    res.end(out);
  });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return text(res, 404, "Not found");
    const headers = { "content-type": type, "accept-ranges": "bytes", "cache-control": "no-store" };
    let start = 0, end = st.size - 1, code = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req?.headers.range || "").trim());   // one range only
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = +range[1]; if (range[2]) end = Math.min(+range[2], end); }
      else start = Math.max(0, st.size - +range[2]);   // suffix: the last n bytes
      if (start > end || start >= st.size) {
        res.writeHead(416, { ...headers, "content-range": `bytes */${st.size}` });
        return res.end();
      }
      code = 206;
      headers["content-range"] = `bytes ${start}-${end}/${st.size}`;
    }
    headers["content-length"] = st.size ? end - start + 1 : 0;
    res.writeHead(code, headers);
    if (!st.size) return res.end();
    const stream = fs.createReadStream(file, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  });
}

let ready = false;
const server = http.createServer(async (req, res) => {
  if (!ready) return text(res, 503, "PinDeck is starting. Reload in a moment.");
  const host = String(req.headers.host || "").toLowerCase();
  if (!goodHost(host)) return text(res, 403, "Bad host");
  const url = new URL(req.url, ORIGIN);
  const p = url.pathname;
  try {
    if (req.method === "GET" && p === "/login") return login(res, url);
    // UI and deck files (read-only); the editor's own scripts and styles hold nothing secret
    const ok = authed(req);
    if (req.method === "GET" && (p === "/" || p === "/index.html")) {
      if (!ok) { res.writeHead(403, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); return res.end(LOGIN_PAGE); }
      return serveFile(res, path.join(EDITOR_DIR, "public/index.html"), null, req);
    }
    if (req.method === "GET" && p.startsWith("/editor/")) {
      const f = safeJoin(path.join(EDITOR_DIR, "public"), p.slice(8));
      return f ? serveFile(res, f, null, req) : text(res, 403, "Forbidden");
    }
    if ((p.startsWith("/deck/") || p.startsWith("/files/")) && !ok) return text(res, 403, "Not logged in");
    let snap;
    if (req.method === "GET" && (snap = p.match(/^\/(?:deck|files)\/(?:.*\/)?__pindeck-print-([\w-]+)\.html$/))) {
      const html = snapshots.get(snap[1]);
      if (!html) return text(res, 404, "Not found");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      return res.end(html);
    }
    // /deck/: the deck folder; /deck/ alone is the deck page. With an asset root the page lives under
    // /files/, so that ../ paths reach the root: /deck/ alone redirects there.
    if (req.method === "GET" && p === "/deck/" && SERVE_ROOT) {
      res.writeHead(302, { location: DECK_PAGE + url.search, "cache-control": "no-store" });
      return res.end();
    }
    const deckPath = req.method === "GET" && (p.startsWith("/deck/") ? servable(DECK_DIR, p.slice(6) || DECK_FILE)
      : p.startsWith("/files/") && SERVE_ROOT ? servable(SERVE_ROOT, p.slice(7)) : undefined);
    if (deckPath === null) return text(res, 403, "Forbidden");
    if (deckPath) {
      const f = deckPath;
      const mode = url.searchParams.get("editor");
      if (!mode || !/\.html?$/i.test(f)) return serveFile(res, f, null, req);
      return serveFile(res, f, (s) => {
        // headless runs must not stream media, or Chrome never finishes the page
        if (mode === "shot" || mode === "dump" || mode === "pdf") s = s.replace(/\bpreload="(auto|metadata)"/g, 'preload="none"');
        if (mode === "pdf") {
          s = s.replace(/<\/head>/i, PDF_HEAD_TAG).replace(/<\/body>/i, PDF_PAGE_TAG);
          return DECK_SELECTOR ? s.replace(/<\/body>/i, BRIDGE_TAG) : s;   // reveal.js lays out its own print view
        }
        return s.replace(/<\/body>/i, BRIDGE_TAG);
      });
    }

    // API: token required (header or login cookie); POSTs must come from the editor page itself
    if (!p.startsWith("/api/")) return text(res, 404, "Not found");
    if (!ok) return text(res, 403, "Bad token");
    const origin = req.headers.origin;
    if (req.method === "POST" && origin && origin.toLowerCase() !== `http://${host}`)
      return text(res, 403, "Bad origin");

    if (p === "/api/events") {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      res.write(`event: hello\ndata: ${JSON.stringify({ chat: state.chat, status: status(), rev: deckRev(),
        turns: state.turns.map((t) => ({ id: t.id, undone: t.undone })) })}\n\n`);
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (p === "/api/ping") return json(res, 200, { ok: true });
    if (p === "/api/login-link") return json(res, 200, { url: loginUrl(loginCode(3600000)) });
    if (p === "/api/status") return json(res, 200, status());
    if (p === "/api/current" && req.method === "POST") { state.current = await body(req); return json(res, 200, {}); }
    if (p === "/api/pins" && req.method === "POST") { state.pins = (await body(req)).pins || []; return json(res, 200, {}); }
    if (p === "/api/measure-result" && req.method === "POST") {
      const b = await body(req);
      const w = pending.get(b.id);
      if (w) { pending.delete(b.id); clearTimeout(w.t); b.error ? w.reject(new Error(b.error)) : w.resolve(b.result); }
      return json(res, 200, {});
    }

    if (p === "/api/message" && req.method === "POST") {
      if (state.busy) return json(res, 409, { error: "Claude is still working." });
      // checked again here: the claude command may have been installed (or removed) since the start
      const claude = detectCapabilities().claude;
      if (!claude.available) return json(res, 503, { code: "claude-unavailable", error: claude.reason });
      const b = await body(req);
      if (typeof b.text !== "string" || !b.text.trim()) return json(res, 400, { error: "Empty message." });
      // what the prompt reads from pins and the selection must be there
      const placed = (x) => x && typeof x.eid === "string" && x.slide && Number.isInteger(x.slide.index) && x.box;
      b.pins = (Array.isArray(b.pins) ? b.pins : []).filter((p) => placed(p) && p.point && p.at);
      if (!placed(b.selection)) b.selection = null;
      if (!Array.isArray(b.layouts)) b.layouts = [];
      if (b.current && !Number.isInteger(b.current.index)) b.current = null;
      let screenshot = null;
      const shotSlide = typeof b.screenshot === "object" && b.screenshot?.eid ? b.screenshot : b.screenshot ? b.current : null;
      if (shotSlide) {
        try { screenshot = { slide: shotSlide.index + 1, path: await takeShot(shotSlide) }; }
        catch (e) { addEntry({ kind: "notice", text: "Screenshot failed: " + e.message }); }
      }
      const label = (p) => (p.tag?.startsWith("footer") ? "footer" : p.eid === p.slide.eid ? "slide" : p.eid.replace(/^[^/]+\//, ""));
      // only files PinDeck itself stored can be attached
      b.attachments = (b.attachments || []).filter((a) => a && state.uploads.has(a.path) && fs.existsSync(uploadFile(a.path)));
      b.attachments.forEach((a) => { state.uploads.delete(a.path); if (a.waveform) state.uploads.delete(a.waveform); });
      const entry = addEntry({ kind: "user", text: b.text, screenshot: !!screenshot,
        attachments: b.attachments.map((a) => ({ path: a.path, kind: a.kind, name: a.name })),
        selection: b.selection ? { eid: b.selection.eid, label: b.selection.eid.replace(/^[^/]+\//, ""), slide: b.selection.slide.index + 1 } : null,
        pins: (b.pins || []).map((p) => ({ n: p.n, eid: p.eid, label: label(p), slide: p.slide.index + 1 })) });
      startTurn(buildPrompt({ ...b, screenshot }), entry);
      return json(res, 200, { id: entry.id });
    }
    if (p === "/api/upload" && req.method === "POST") {
      const original = decodeURIComponent(String(req.headers["x-filename"] || "file"));
      const kind = attachKind(original);
      if (!kind) return json(res, 415, { error: `Only images (${ATTACH_TYPES.image.join(", ")}), audio (${ATTACH_TYPES.audio.join(", ")}) and PDFs can be attached.` });
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > ATTACH_MAX) return json(res, 413, { error: `${original} is larger than ${kb(ATTACH_MAX)}.` });
        chunks.push(c);
      }
      const buf = Buffer.concat(chunks);
      if (kind === "pdf") {
        if (buf.subarray(0, 5).toString() !== "%PDF-") return json(res, 415, { error: `${original} is not a PDF.` });
        fs.mkdirSync(PDF_DIR, { recursive: true, mode: 0o700 });
        const abs = attachPath(original, PDF_DIR);
        fs.writeFileSync(abs, buf, { mode: 0o600 });
        state.uploads.add(abs);
        let info = null;
        if (CAPS.pdfPages.available) { try { info = await pdfInfo(abs, STATE_DIR); } catch {} }
        return json(res, 200, { path: abs, kind, bytes: buf.length, pages: info?.pages, pageSize: info?.sizes[0] });
      }
      const rel = attachPath(original);
      writeDeckFile(rel, buf);
      state.uploads.add(rel);
      return json(res, 200, { path: rel, kind, bytes: buf.length, url: `/deck/${rel}` });
    }
    if (p === "/api/upload-remove" && req.method === "POST") {
      const b = await body(req);
      for (const rel of [b.path, b.waveform].filter(Boolean)) {
        if (!state.uploads.has(rel)) continue;   // only unsent uploads, never other deck files
        state.uploads.delete(rel);
        fs.rmSync(uploadFile(rel), { force: true });
      }
      return json(res, 200, {});
    }
    if (p === "/api/settings" && req.method === "POST") {
      const b = await body(req);
      const model = b.model ?? settings.model, effort = b.effort ?? settings.effort;
      if (!MODELS.includes(model) || !EFFORTS.includes(effort)) return json(res, 400, { error: "Unknown model or effort." });
      if (model === settings.model && effort === settings.effort) return json(res, 200, { settings });
      if (state.busy) return json(res, 409, { error: "Wait until Claude has finished, then change the model or effort." });
      Object.assign(settings, { model, effort });
      saveSettings();
      // restart the session with the new flags; --resume keeps the conversation
      if (session.running) session.stop().then(() => { if (!quitting) ensureSession(); });
      addEntry({ kind: "notice", text: `Model: ${model[0].toUpperCase() + model.slice(1)}, effort: ${effort}. The conversation continues.` });
      pushStatus();
      return json(res, 200, { settings });
    }
    if (p === "/api/slide-hidden" && req.method === "POST") {
      if (state.busy) return json(res, 409, { error: "Claude is working. Wait until it has finished." });
      const b = await body(req);
      if (staleEdit(res, b)) return;
      const before = snapshot(EDITABLE);
      const slides = findSlides(parse(before[DECK_FILE]));
      const index = slides.findIndex((s) => s.attrs["data-eid"]?.value === b.eid);
      if (index < 0) return json(res, 404, { error: "Slide not found in the file." });
      const r = setAttr(before[DECK_FILE], b.eid, "data-visibility", b.hidden ? "hidden" : null);
      if (!r.changed) return json(res, 200, { unchanged: true });
      const turnId = recordHandEdit(before, r.html, `${b.hidden ? "Hid" : "Showed"} slide ${index + 1}`,
        `The user ${b.hidden ? "hid" : "showed again"} slide ${index + 1} (${b.eid}). Hidden slides carry ` +
        `data-visibility="hidden": they stay in the file but are skipped when presenting and in PDF exports.`,
        { manual: true, chat: false });   // the editor reloads the slide itself; undo is in the toolbar
      return json(res, 200, { turnId, index });
    }
    if (p === "/api/move-slide" && req.method === "POST") {
      if (state.busy) return json(res, 409, { error: "Claude is working. Wait until it has finished." });
      const b = await body(req);
      if (staleEdit(res, b)) return;
      const before = snapshot(EDITABLE);
      const r = moveSlide(before[DECK_FILE], b.eid, b.before ?? null);
      if (r.error) return json(res, 409, { error: r.error });
      if (!r.changed) return json(res, 200, { unchanged: true, index: r.from });
      const turnId = recordHandEdit(before, r.html, `Moved slide ${r.from + 1} to ${r.index + 1}`,
        `The user moved slide ${r.from + 1} (${b.eid}) to position ${r.index + 1}; the slides in between changed numbers.`,
        { manual: true, chat: false });   // the editor reloads itself on the moved slide; undo is in the toolbar
      return json(res, 200, { turnId, index: r.index });
    }
    if (p === "/api/add-slide" && req.method === "POST") {
      if (state.busy) return json(res, 409, { error: "Claude is working. Wait until it has finished." });
      const b = await body(req);
      if (staleEdit(res, b)) return;
      if (!["content", "section", "duplicate"].includes(b.kind)) return json(res, 400, { error: "Unknown slide kind." });
      const before = snapshot(EDITABLE);
      const r = insertSlide(before[DECK_FILE], b.kind, b.after);
      if (r.error) return json(res, 409, { error: r.error });
      const html = assignEids(r.html).html;
      const slide = findSlides(parse(html))[r.index];
      const eid = slide.attrs["data-eid"].value;
      const what = { content: "content slide", section: "section divider", duplicate: "copy of the slide" }[b.kind];
      const turnId = recordHandEdit(before, html, `Added a ${what} (slide ${r.index + 1})`,
        `The user added a ${what} as slide ${r.index + 1} (${eid})` + (b.kind === "duplicate" ? `, a copy of ${b.after}.` : " with placeholder text."),
        { manual: true });   // the editor reloads itself and opens the new slide; no second reload from the watcher
      return json(res, 200, { turnId, index: r.index, eid });
    }
    if (p === "/api/import" && req.method === "POST") {
      if (!CAPS.pptxImport.available) return json(res, 501, { code: "unavailable", error: CAPS.pptxImport.reason });
      const name = path.basename(decodeURIComponent(String(req.headers["x-filename"] || "slides.pptx")));
      if (!/\.pptx$/i.test(name)) return json(res, 415, { error: "Choose a PowerPoint file (.pptx). Save older .ppt files as .pptx first." });
      const chunks = [];
      let size = 0;
      for await (const c of req) {
        size += c.length;
        if (size > IMPORT_MAX) return json(res, 413, { error: `${name} is larger than ${kb(IMPORT_MAX)}.` });
        chunks.push(c);
      }
      let imp;
      try { imp = startImport(name, Buffer.concat(chunks)); }
      catch (e) { return json(res, 400, { error: `${name} could not be read: ${e.message}` }); }
      // what the import can only approximate, so the dialog can offer Claude's help with it
      const complex = new Map(planSlides(imp.model, imp.model.slides.map((s) => s.n), { drawings: renderAvailable() }).map((p) => [p.n, p.complex]));
      return json(res, 200, { id: imp.id, name, render: renderAvailable(),
        slides: imp.model.slides.map((s) => ({ n: s.n, title: s.title, subtitle: s.subtitle, hidden: s.hidden, kind: s.kind, complex: complex.get(s.n) || [] })) });
    }
    if (p === "/api/import-thumb") {
      const imp = lastImport, n = +url.searchParams.get("n");
      if (!imp || imp.id !== url.searchParams.get("id") || !Number.isInteger(n)) return text(res, 404, "Not found");
      return serveFile(res, path.join(imp.dir, `thumb-${n}.png`));
    }
    if (p === "/api/import-apply" && req.method === "POST") {
      if (state.busy) return json(res, 409, { error: "Claude is working. Wait until it has finished." });
      const b = await body(req);
      if (staleEdit(res, b)) return;
      const imp = lastImport;
      if (!imp || imp.id !== b.id) return json(res, 410, { error: "This import has expired. Choose the file again." });
      const numbers = (b.slides || []).filter((n) => imp.model.slides.some((s) => s.n === n));
      if (!numbers.length) return json(res, 400, { error: "Choose at least one slide." });
      try { return json(res, 200, await applyImport(imp, numbers, b.after, !!b.refine)); }
      catch (e) { console.error(e); return json(res, 500, { error: String(e.message || e) }); }
    }
    if (p === "/api/stop" && req.method === "POST") {
      if (state.busy && session.running) {
        const interruptedTurn = state.turn;
        session.interrupt();
        setTimeout(() => {
          if (state.busy && state.turn === interruptedTurn) session.stop();
        }, 5000); // force only if the interrupted turn does not answer
      }
      return json(res, 200, {});
    }
    if (p === "/api/new-chat" && req.method === "POST") {
      session.stop();
      Object.assign(state, { chat: [], sessionId: null, turns: [], redo: [], turn: null, busy: false, notes: [] });
      saveChat();
      broadcast("reset", { chat: [] });
      ensureSession();
      pushStatus();
      return json(res, 200, {});
    }
    let m;
    if ((m = p.match(/^\/api\/turn\/(\d+)\/diff$/))) {
      const t = state.turns.find((t) => t.id === +m[1]);
      if (!t) return text(res, 404, "No such change");
      return text(res, 200, changeFiles(t).map((rel) => fileDiff(rel, t.before[rel] ?? null, t.after[rel] ?? null)).filter(Boolean).join("\n\n"));
    }
    if ((m = p.match(/^\/api\/turn\/(\d+)\/undo$/)) && req.method === "POST") {
      const t = liveTurns().at(-1);
      if (t && t.id !== +m[1]) return json(res, 409, { error: "Only the most recent change can be undone." });
      return undo(res);
    }
    if (p === "/api/undo" && req.method === "POST") return undo(res);
    if (p === "/api/redo" && req.method === "POST") {
      if (state.busy) return json(res, 409, { error: "Wait until Claude has finished." });
      const t = state.redo.at(-1);
      if (!t) return json(res, 409, { error: "Nothing to redo." });
      const diverged = undoConflicts(t, "redo");
      if (diverged.length) return conflict(res, "redo", diverged);
      state.redo.pop();
      for (const rel of changeFiles(t)) if (!isAs(rel, t.after[rel])) putDeckFile(rel, t.after[rel] ?? null);
      for (const { rel } of t.deletedFiles || []) fs.rmSync(path.join(DECK_DIR, rel), { force: true });
      for (const { rel, data } of t.addedFiles || []) writeDeckFile(rel, data, false);
      t.undone = false;
      state.notes.push(t.kind === "manual" ? `The user redid their hand edit: ${t.label}.`
        : `The user redid your change from turn ${t.id} after undoing it.`);
      broadcast("undone", { turnId: t.id, undone: false });
      pushStatus();
      return json(res, 200, {});
    }

    // Delete an element (and, if the user agrees, the files only it uses)
    if (p === "/api/delete-info") {
      const plan = deletePlan(url.searchParams.get("eid"));
      if (!plan) return json(res, 404, { error: "Element not found in the file." });
      return json(res, 200, { eid: plan.eid, tag: plan.tag, files: plan.files });
    }
    if (p === "/api/delete" && req.method === "POST") {
      if (state.busy) return json(res, 409, { error: "Claude is working. Wait until it has finished." });
      const b = await body(req);
      if (staleEdit(res, b)) return;
      const plan = deletePlan(b.eid);
      if (!plan) return json(res, 404, { error: "Element not found in the file." });
      const before = snapshot(EDITABLE);
      const wanted = new Set(b.files || []);
      const deletedFiles = plan.files.filter((f) => wanted.has(f.rel) && !f.usedElsewhere)
        .map((f) => ({ rel: f.rel, data: fs.readFileSync(path.join(DECK_DIR, f.rel)) }));
      const short = plan.eid.replace(/^[^/]+\//, "/");
      const label = `Deleted ${short}` + (deletedFiles.length ? ` and ${deletedFiles.map((f) => f.rel).join(", ")}` : "");
      const turnId = recordHandEdit(before, plan.html, label,
        `The user deleted ${plan.eid} (${plan.tag}) by hand` + (deletedFiles.length ? `, together with the file(s) ${deletedFiles.map((f) => f.rel).join(", ")}` : "") + ".",
        { manual: false, deletedFiles });
      for (const f of deletedFiles) fs.rmSync(path.join(DECK_DIR, f.rel), { force: true });
      return json(res, 200, { turnId, deleted: plan.eid, files: deletedFiles.map((f) => f.rel) });
    }

    // Hand edits from the editor: drag/resize (inline styles) and text
    if (p === "/api/edit" && req.method === "POST") {
      if (state.busy) return json(res, 409, { error: "Claude is working. Wait until it has finished." });
      const b = await body(req);
      if (staleEdit(res, b)) return;
      const before = snapshot(EDITABLE);
      const r = setStyles(before[DECK_FILE], b.ops || []);
      if (r.missing.length) return json(res, 404, { error: `No element ${r.missing.join(", ")} in ${DECK_FILE}.` });
      if (!r.changed) return json(res, 200, { unchanged: true });
      const label = String(b.label || "Edited layout").slice(0, 200);
      const turnId = recordHandEdit(before, r.html, label,
        `The user edited the layout by hand: ${label}. This is an inline style on the element in ${DECK_FILE}.`);
      return json(res, 200, { turnId });
    }
    if (p === "/api/source") {
      const html = getInner(readDeck(DECK_FILE), url.searchParams.get("eid"), JSON.parse(url.searchParams.get("path") || "[]"));
      return html == null ? json(res, 404, { error: "Element not found in the file." }) : json(res, 200, { html });
    }
    // Speaker notes of a slide: read for the notes field, saved as a hand edit
    if (p === "/api/notes" && req.method === "GET") {
      const n = getNotes(readDeck(DECK_FILE), url.searchParams.get("eid"));
      return n ? json(res, 200, n) : json(res, 404, { error: "Slide not found in the file." });
    }
    if (p === "/api/notes" && req.method === "POST") {
      if (state.busy) return json(res, 409, { error: "Claude is working. Wait until it has finished." });
      const b = await body(req);
      if (staleEdit(res, b)) return;
      const before = snapshot(EDITABLE);
      const r = setNotes(before[DECK_FILE], b.eid, b.text, !!b.html);
      if (!r) return json(res, 404, { error: "Slide not found in the file." });
      if (!r.changed) return json(res, 200, { unchanged: true });
      const n = findSlides(parse(before[DECK_FILE])).findIndex((s) => s.attrs["data-eid"]?.value === b.eid) + 1;
      const text = String(b.text || "").trim();
      const turnId = recordHandEdit(before, r.html, text ? `Edited the notes of slide ${n}` : `Removed the notes of slide ${n}`,
        text ? `The user edited the speaker notes of slide ${n} (${b.eid}) by hand. They now read: "${text.slice(0, 300)}".`
             : `The user removed the speaker notes of slide ${n} (${b.eid}).`);   // manual: the slide itself does not change
      return json(res, 200, { turnId });
    }
    if (p === "/api/text" && req.method === "POST") {
      if (state.busy) return json(res, 409, { error: "Claude is working. Wait until it has finished." });
      const b = await body(req);
      if (staleEdit(res, b)) return;
      const before = snapshot(EDITABLE);
      const r = setInner(before[DECK_FILE], b.eid, b.path || [], String(b.html ?? ""));
      if (!r) return json(res, 404, { error: `No element ${b.eid} in ${DECK_FILE}.` });
      if (!r.changed) return json(res, 200, { unchanged: true });
      const label = String(b.label || "Edited text").slice(0, 200);
      const where = b.eid + (b.path?.length ? ` (cell ${b.path.map((i) => i + 1).join("/")})` : "");
      const turnId = recordHandEdit(before, r.html, label,
        `The user edited the text of ${where} by hand. It now reads: "${String(b.text || "").slice(0, 300)}".`);
      return json(res, 200, { turnId });
    }

    // Enter in a bullet: the bullet keeps the text before the caret, a new bullet after it gets the rest
    if (p === "/api/split" && req.method === "POST") {
      if (state.busy) return json(res, 409, { error: "Claude is working. Wait until it has finished." });
      const b = await body(req);
      if (staleEdit(res, b)) return;
      const before = snapshot(EDITABLE);
      const r1 = setInner(before[DECK_FILE], b.eid, [], String(b.html ?? ""));
      if (!r1) return json(res, 404, { error: `No element ${b.eid} in ${DECK_FILE}.` });
      const r2 = insertAfter(r1.html, b.eid, { tag: "li", cls: b.cls || "", inner: String(b.newHtml ?? ""), newEid: b.newEid });
      const short = (e) => e.replace(/^[^/]+\//, "/");
      const turnId = recordHandEdit(before, r2.html, `New bullet after ${short(b.eid)}`,
        `The user added a bullet (${r2.eid}) after ${b.eid} by pressing Enter while editing; ${b.eid} now reads "${String(b.text || "").slice(0, 200)}".`);
      return json(res, 200, { turnId, eid: r2.eid });
    }
    if (p === "/api/remove" && req.method === "POST") {
      if (state.busy) return json(res, 409, { error: "Claude is working. Wait until it has finished." });
      const b = await body(req);
      if (staleEdit(res, b)) return;
      const before = snapshot(EDITABLE);
      const html = removeElement(before[DECK_FILE], b.eid);
      if (html == null) return json(res, 404, { error: `No element ${b.eid} in ${DECK_FILE}.` });
      const turnId = recordHandEdit(before, html, `Removed empty bullet ${b.eid.replace(/^[^/]+\//, "/")}`,
        `The user removed the empty bullet ${b.eid}.`);
      return json(res, 200, { turnId });
    }

    if (p === "/api/export" && req.method === "POST") {
      const b = await body(req);
      try { return json(res, 200, await exportPdf(b.kind, b.includeHidden)); }
      catch (e) { return json(res, e.status || 500, { error: String(e.message || e) }); }
    }

    // CLI endpoints (used by Claude Code via cli.mjs)
    if (p === "/api/pdf") {
      const kind = url.searchParams.get("slide") || url.searchParams.get("kind") || "handout";
      if (!["handout", "presentation"].includes(kind)) return text(res, 400, 'Use "handout" or "presentation".');
      if (!CAPS.pdfExport.available) return text(res, 501, `PDF export is not available: ${CAPS.pdfExport.reason}.`);
      const r = await exportPdf(kind, url.searchParams.get("all") === "1");
      return text(res, 200, r.path);
    }
    if (p === "/api/pdf-figure") {
      const r = await pdfFigure(Object.fromEntries(url.searchParams));
      return text(res, r.status || 200, r.text);
    }
    if (p === "/api/slides") {
      return text(res, 200, slideList().map((s) => `${String(s.index + 1).padStart(2)}  ${s.eid}`).join("\n"));
    }
    if (p === "/api/layout" || p === "/api/shot") {
      const slide = resolveSlide(url.searchParams.get("slide"));
      if (!slide) return text(res, 404, `No slide "${url.searchParams.get("slide")}". Use \`${CLI_CMD} slides\`.`);
      if (!slide.eid) runEidPass();
      const s2 = slide.eid ? slide : resolveSlide(String(slide.index + 1));
      if (p === "/api/shot") {
        if (!CAPS.screenshot.available) return text(res, 501, `Screenshots are not available: ${CAPS.screenshot.reason}.`);
        return text(res, 200, await takeShot(s2));
      }
      try { return text(res, 200, formatLayout(await measure(s2))); }
      catch (e) { if (e.status) return text(res, e.status, e.message); throw e; }
    }
    return text(res, 404, "Not found");
  } catch (e) {
    // malformed JSON or %-encoding in a request is the caller's mistake, not a server error
    const bad = e instanceof SyntaxError || e instanceof URIError || e.message === "body too large";
    if (!bad) console.error(e);
    if (!res.headersSent) text(res, bad ? 400 : 500, String(e.message || e));
  }
});

/* ---- Start ----------------------------------------------------------------------------------------
   The port is bound first. Only then does PinDeck write anything: its state folder and server files, and
   the element ids in the deck. A port in use or another failure to listen leaves deck and state untouched. */
let quitting = false;
server.on("error", (e) => {
  if (ready) return console.error(e);
  console.error(e.code === "EADDRINUSE"
    ? `Port ${PORT} is in use (another PinDeck, or an SSH tunnel?). Choose another with --port, the same on both ends of a tunnel.`
    : `Cannot listen on 127.0.0.1:${PORT}: ${e.message}`);
  process.exit(1);
});
server.listen(PORT, "127.0.0.1", () => {
  PORT = server.address().port;
  ORIGIN = `http://127.0.0.1:${PORT}`;
  try {
    writeServerInfo();
    completeSettings();
    fs.rmSync(IMPORT_DIR, { recursive: true, force: true });
    const first = runEidPass();
    if (first.changed) console.log(`Added ${first.assigned.length} element ids to ${DECK_FILE} (backup in ${path.join(STATE_DIR, "backups")}).`);
    startWatcher();
  } catch (e) {
    console.error(`PinDeck could not open the deck: ${e.message}`);
    removeServerInfo();
    process.exit(1);
  }
  ready = true;
  console.log(`PinDeck: ${loginUrl(loginCode(3600000))}`);
  console.log("  (a one-time login link, valid for an hour; for a new one: pindeck login)");
  console.log(`Deck: ${DECK_DIR}`);
  console.log(`Server: ${CAPS.label}`);
  for (const [name, c] of Object.entries(publicCapabilities(CAPS)))
    if (c && c.available === false) console.log(`  ${name}: off (${c.reason})`);
  ensureSession();
});
/* Ctrl+C or SIGTERM: stop taking requests, let Claude Code end (it gets end of input, then SIGTERM, then
   SIGKILL), then exit. At most 6 s; a second Ctrl+C exits at once. A running turn is not resumed later. */
async function quit() {
  if (quitting) process.exit(1);
  quitting = true;
  try { watcher?.close(); } catch {}
  clearTimeout(flush); clearTimeout(eidTimer);
  for (const res of clients) res.end();
  for (const w of pending.values()) { clearTimeout(w.t); w.reject(new Error("PinDeck is stopping")); }
  server.close();
  server.closeAllConnections?.();
  removeServerInfo();
  await Promise.race([session.stop(), new Promise((r) => setTimeout(r, 6000))]);
  if (chatTimer) writeChat();
  process.exit(0);
}
process.on("SIGINT", quit);
process.on("SIGTERM", quit);
