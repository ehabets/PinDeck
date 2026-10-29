/* The front (front.mjs, what `pindeck` starts) as a real process: one port and one login for several decks,
   each served by its own deck server, opened when first asked for; the deck list; what it refuses; idle
   decks; pindeck login; shutdown. Decks are copies of ocean-example; the assistant is test/fixtures/fake-agent. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deckTarget } from "../lib/deck-target.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FRONT = path.join(ROOT, "front.mjs");
const FAKE_AGENT = path.join(ROOT, "test", "fixtures", "fake-agent");
const EXAMPLE = path.join(ROOT, "ocean-example");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, what, timeout = 10000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await sleep(50);
  }
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/* talks/: index.html (the example), second.html (a copy), notes.html (no slides), lecture/index.html one
   folder down, and decks PinDeck must not list: in export/, node_modules/ and two folders down */
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pindeck front "));
  const stops = [];
  t.after(async () => {
    for (const stop of stops) await stop().catch(() => {});
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const talks = path.join(root, "talks 'n' decks");
  fs.cpSync(EXAMPLE, talks, { recursive: true });
  const deck = fs.readFileSync(path.join(talks, "index.html"), "utf8");
  fs.writeFileSync(path.join(talks, "second.html"), deck);
  fs.writeFileSync(path.join(talks, "notes.html"), "<!doctype html><title>Notes</title><p>Not slides.</p>\n");
  for (const d of ["lecture", "export", "node_modules/pkg", "lecture/old/older"]) {
    fs.mkdirSync(path.join(talks, d), { recursive: true });
    fs.writeFileSync(path.join(talks, d, "index.html"), deck);
  }
  return { root, talks, home: path.join(root, "state"), log: path.join(root, "agent.log"), stops };
}
const env = (fx, more = {}) => ({ ...process.env, PINDECK_HOME: fx.home, CLAUDE_BIN: FAKE_AGENT, CODEX_BIN: FAKE_AGENT,
  FAKE_AGENT_LOG: fx.log, CHROME_BIN: path.join(fx.root, "no-chrome"), PINDECK_LINUX_CHROME: "", PORT: "", ...more });
const agentPids = (fx) => fs.existsSync(fx.log)
  ? [...new Set(fs.readFileSync(fx.log, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((e) => e.event === "start").map((e) => e.pid))] : [];

function spawnFront(fx, args, more = {}) {
  const child = spawn(process.execPath, [FRONT, ...args], { env: env(fx, more), stdio: ["ignore", "pipe", "pipe"], detached: true });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  const exited = new Promise((r) => child.once("exit", (code, signal) => r({ code, signal })));
  fx.stops.push(async () => {
    // SIGTERM: the front waits for its deck servers (each in its own process group), so none is still
    // writing its state when the folder is removed; SIGKILL if that takes too long
    if (child.exitCode === null && child.signalCode === null) {
      try { process.kill(child.pid, "SIGTERM"); } catch {}
      if (!(await Promise.race([exited, sleep(10000)]))) { try { process.kill(-child.pid, "SIGKILL"); } catch {} await exited; }
    }
    for (const pid of agentPids(fx)) if (alive(pid)) process.kill(pid, "SIGKILL");
  });
  return { child, exited, output: () => out };
}
async function startFront(t, fx, args = [fx.talks], more = {}) {
  const s = spawnFront(fx, [...args, "--port", "0"], more);
  const login = await waitFor(() => /PinDeck: (http:\/\/127\.0\.0\.1:\d+\/login\?code=[0-9a-f]+)/.exec(s.output())?.[1] ||
    (s.child.exitCode !== null && Promise.reject(new Error("the front exited: " + s.output()))), "the front to start");
  const url = new URL(login).origin, port = +new URL(login).port;
  const res = await fetch(login);
  assert.equal(res.status, 200);
  const jar = { cookie: res.headers.get("set-cookie").split(";")[0] };
  assert.equal(jar.cookie.split("=")[0], `pindeck-${port}`);
  const get = (p, headers = jar) => fetch(url + p, { headers, redirect: "manual" });
  const api = async (p, body) => {
    const r = await fetch(url + p, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body),
      headers: { ...jar, origin: url, "content-type": "application/json" } });
    const raw = await r.text();
    try { return { status: r.status, data: JSON.parse(raw) }; } catch { return { status: r.status, data: raw }; }
  };
  return { ...s, url, port, jar, get, api };
}
const key = (p) => deckTarget(p).key;
/* A request with headers fetch() will not send as given (Host) */
const raw = (port, { method = "GET", p, headers }) => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, method, path: p, headers }, (res) => { res.resume(); resolve(res.statusCode); });
  req.on("error", reject);
  req.end(method === "POST" ? "{}" : undefined);
});
const ids = (f) => (fs.readFileSync(f, "utf8").match(/data-eid=/g) || []).length;

test("Front: one login for several decks, each with its own server, opened when first asked for", async (t) => {
  const fx = fixture(t);
  const second = path.join(fx.talks, "second.html"), notes = path.join(fx.talks, "notes.html");
  const notesBefore = fs.readFileSync(notes, "utf8");
  const s = await startFront(t, fx);
  const info = JSON.parse(fs.readFileSync(path.join(fx.home, "server.json"), "utf8"));
  assert.equal(info.front, true);
  assert.equal(info.url, s.url);
  assert.equal((fs.statSync(path.join(fx.home, "server.json")).mode & 0o777), 0o600);

  // / opens the start deck
  const home = await s.get("/");
  assert.equal(home.status, 302);
  assert.equal(home.headers.get("location"), `/d/${key(fx.talks)}/`);

  // the list: the deck folder and one folder down; notes.html with its reason; nothing written to any
  const { decks } = (await s.api("/api/decks")).data;
  assert.deepEqual(decks.map((d) => d.rel), ["index.html", "notes.html", "second.html", "lecture/index.html"]);
  assert.match(decks[1].problem, /notes\.html has no reveal\.js slides/);
  assert.deepEqual(decks.map((d) => d.open), [true, false, false, false]);
  assert.equal(ids(second), 0, "listing a deck does not give it ids");

  // each deck its own server: its status, its file; ids only once opened
  const a = await s.api(`/d/${key(fx.talks)}/api/status`), b = await s.api(`/d/${key(second)}/api/status`);
  assert.equal(a.data.deckFile, "index.html");
  assert.equal(b.data.deckFile, "second.html");
  assert.ok(ids(second) > 0);
  assert.match(s.output(), /\[second\.html\] opened: /);
  assert.deepEqual((await s.api("/api/decks")).data.decks.map((d) => d.open), [true, false, true, false]);
  // the editor page and the deck page, under the deck's own path; the bridge from the front
  assert.equal((await s.get(`/d/${key(second)}/`)).status, 200);
  // the deck page is sent to its sandboxed address, which needs no cookie (the deck has none) but gives nothing else
  const toView = await s.get(`/d/${key(second)}/deck/second.html?editor=main`);
  assert.equal(toView.status, 302);
  const view = new URL(toView.headers.get("location"), `${s.url}/d/${key(second)}/deck/second.html`);
  assert.match(view.pathname, new RegExp(`^/d/${key(second)}/v/[0-9a-f]{32}/deck/second\\.html$`));
  const page = await fetch(view, { headers: {} });
  assert.match(page.headers.get("content-security-policy"), /^sandbox allow-scripts /);
  assert.match(await page.text(), /<script src="\/editor\/bridge\.js">/);
  const viewBase = view.pathname.replace(/deck\/second\.html$/, "");
  assert.equal((await fetch(`${s.url}${viewBase}deck/theme.css`)).status, 200, "the deck's own files");
  for (const p of ["api/status", "api/events", "deck/../api/status", "shots/x.png"])
    assert.notEqual((await fetch(`${s.url}${viewBase}${p}`)).status, 200, p);
  assert.equal((await fetch(`${s.url}${viewBase.replace(/[0-9a-f]{32}/, "0".repeat(32))}deck/theme.css`)).status, 403, "a wrong token");
  assert.equal((await fetch(`${s.url}/d/${key(second)}/api/status`)).status, 403, "the API: login needed");
  assert.equal((await fetch(`${s.url}/d/${key(fx.talks)}/../${key(second)}/api/status`)).status, 403);
  assert.equal((await s.get("/editor/bridge.js", {})).status, 200, "the editor's scripts need no login");
  assert.equal((await s.get(`/d/${key(second)}`)).headers.get("location"), `/d/${key(second)}/`);

  // live events pass through
  const ac = new AbortController();
  const events = await fetch(`${s.url}/d/${key(second)}/api/events`, { headers: s.jar, signal: ac.signal });
  const reader = events.body.getReader();
  let first = "";
  while (!first.includes("\n\n")) first += new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /^event: hello\n/);
  ac.abort();

  // a POST: from the editor's own origin only
  assert.equal((await s.api(`/d/${key(second)}/api/notes`, {})).status !== 403, true);
  const bad = await fetch(`${s.url}/d/${key(second)}/api/notes`, { method: "POST", body: "{}", headers: { ...s.jar, origin: "http://evil.example" } });
  assert.equal(bad.status, 403);

  // what cannot be opened: not a deck, not in the list, a path outside
  const no = await s.get(`/d/${key(notes)}/`);
  assert.equal(no.status, 409);
  assert.match(await no.text(), /notes\.html has no reveal\.js slides/);
  assert.equal(fs.readFileSync(notes, "utf8"), notesBefore);
  for (const p of [`/d/${key(path.join(fx.talks, "export"))}/`, `/d/${key(path.join(fx.talks, "lecture", "old", "older"))}/`, "/d/nothing-12345678/", "/d/..%2F..%2Fapi/decks"])
    assert.notEqual((await s.get(p)).status, 200, p);
  assert.equal(ids(path.join(fx.talks, "export", "index.html")), 0);

  // without the login: the login page, or a refusal
  assert.equal((await s.get(`/d/${key(fx.talks)}/`, {})).status, 403);
  assert.match(await (await s.get("/", {})).text(), /Log in to PinDeck/);
  assert.equal((await s.get(`/d/${key(fx.talks)}/api/status`, {})).status, 403);
  assert.equal((await s.get("/api/decks", { cookie: `pindeck-${s.port}=${"0".repeat(32)}` })).status, 403);
  for (const host of ["evil.example", `evil.example:${s.port}`, "localhost.:8080"])
    assert.equal(await raw(s.port, { p: "/api/decks", headers: { ...s.jar, host } }), 403, host);
  // a tunnel on another local port: its Host and Origin, passed on to the deck as the deck's own
  const tunnel = { ...s.jar, host: "localhost:8080", "content-type": "application/json" };
  assert.equal(await raw(s.port, { p: `/d/${key(second)}/api/status`, headers: tunnel }), 200);
  assert.notEqual(await raw(s.port, { method: "POST", p: `/d/${key(second)}/api/notes`, headers: { ...tunnel, origin: "http://localhost:8080" } }), 403);
  assert.equal(await raw(s.port, { method: "POST", p: `/d/${key(second)}/api/notes`, headers: { ...tunnel, origin: s.url } }), 403);

  // pindeck login: a link to the front; with a deck, one that opens it
  const login = (...args) => execFileSync(process.execPath, [FRONT, "login", ...args], { env: env(fx), encoding: "utf8" });
  assert.match(login(), new RegExp(`${s.url}/login\\?code=[0-9a-f]+\\n$`));
  const link = /(http:\S+)/.exec(login(second))[1];
  assert.equal(new URL(link).searchParams.get("next"), `/d/${key(second)}/`);

  // SIGTERM: every deck and its assistant end, then the front, which removes its server file
  const pids = agentPids(fx);
  assert.ok(pids.length >= 2);
  process.kill(s.child.pid, "SIGTERM");
  assert.equal((await s.exited).code, 0);
  await waitFor(() => pids.every((p) => !alive(p)), "the assistants to end");
  assert.equal(fs.existsSync(path.join(fx.home, "server.json")), false);
});

test("Front: a folder without index.html lists its decks; the asset roots' decks too", async (t) => {
  const fx = fixture(t);
  const folder = path.join(fx.root, "several");
  fs.mkdirSync(folder);
  fs.copyFileSync(path.join(fx.talks, "second.html"), path.join(folder, "a.html"));
  fs.copyFileSync(path.join(fx.talks, "second.html"), path.join(folder, "b <&> c.html"));
  const s = await startFront(t, fx, [folder, "--asset-root", fx.talks]);
  assert.match(s.output(), /Decks: /);
  const page = await s.get("/");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, new RegExp(`href="/d/${key(path.join(folder, "a.html"))}/"`));
  assert.match(html, /b &lt;&amp;&gt; c\.html/);
  assert.match(html, /notes\.html.*no reveal\.js slides/s, "the asset root's decks, with the reasons");
  const roots = new Set((await s.api("/api/decks")).data.decks.map((d) => d.root));
  assert.deepEqual([...roots], [folder, fx.talks]);
  assert.equal((await s.api(`/d/${key(path.join(fx.talks, "lecture"))}/api/status`)).data.deckFile, "index.html");
});

test("Front: the start deck's problem stops it with that message; nothing is written", async (t) => {
  const fx = fixture(t);
  const notes = spawnFront(fx, [path.join(fx.talks, "notes.html"), "--port", "0"]);
  assert.equal((await notes.exited).code, 1);
  assert.match(notes.output(), /^notes\.html has no reveal\.js slides/, "as the deck server says it, without a deck mark");
  const missing = spawnFront(fx, [path.join(fx.talks, "missing.html"), "--port", "0"]);
  assert.equal((await missing.exited).code, 1);
  assert.match(missing.output(), /No missing\.html in /);
  const root = spawnFront(fx, [fx.talks, "--port", "0", "--asset-root", path.join(fx.root, "nowhere")]);
  assert.equal((await root.exited).code, 2);
  assert.match(root.output(), /Asset root .* is not a folder/);
  assert.equal(fs.existsSync(fx.home), false);
  assert.equal(ids(path.join(fx.talks, "index.html")), 0);
});

test("Front: a deck with no editor open closes after a while, and opens again when asked for", async (t) => {
  const fx = fixture(t);
  const s = await startFront(t, fx, [fx.talks], { PINDECK_IDLE_MS: "400" });
  const second = `/d/${key(path.join(fx.talks, "second.html"))}`;
  assert.equal((await s.api(`${second}/api/status`)).status, 200);
  await waitFor(() => /\[second\.html\] no editor open .* closing it/.test(s.output()), "the idle deck to close");
  await waitFor(() => /\[second\.html\] closed/.test(s.output()), "its server to end");
  assert.equal((await s.api(`${second}/api/status`)).data.deckFile, "second.html", "opened again");
});
