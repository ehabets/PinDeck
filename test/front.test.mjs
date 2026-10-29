/* The front (front.mjs, what `pindeck` starts) as a real process: one port and one login for several decks,
   each served by its own deck server, opened when first asked for; the deck list; what it refuses; idle
   decks; pindeck login; shutdown. Decks are copies of ocean-example; the assistant is test/fixtures/fake-agent. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { deckTarget } from "../lib/deck-target.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FRONT = path.join(ROOT, "front.mjs");
const CLI = path.join(ROOT, "cli.mjs");
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
  const serverFile = path.join(fx.home, "servers", `${s.child.pid}.json`);
  const info = JSON.parse(fs.readFileSync(serverFile, "utf8"));
  assert.equal(info.front, true);
  assert.equal(info.url, s.url);
  assert.equal((fs.statSync(serverFile).mode & 0o777), 0o600);

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
  assert.deepEqual(fs.readdirSync(path.join(fx.home, "servers")), [], "no server files left: the front's and its deck servers'");
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

test("Front: the start deck's warnings are shown when it starts anyway", async (t) => {
  for (const [config, warning] of [["{ \"provider\": \"codex\", }", /config\.json is not valid JSON; using the defaults\./],
    ["null", /config\.json does not hold settings/]]) {
    const fx = fixture(t);
    fs.mkdirSync(fx.home, { recursive: true });
    fs.writeFileSync(path.join(fx.home, "config.json"), config);
    const s = await startFront(t, fx, [fx.talks], { CLAUDE_MODEL: "haiku" });
    assert.match(s.output(), warning);
    assert.match(s.output(), /CLAUDE_MODEL is not used by PinDeck 3: .*--model haiku/);
    assert.equal((await s.api(`/d/${key(fx.talks)}/api/status`)).status, 200);
  }
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

/* The pid of the deck server the front started for this deck path */
const serverPid = (deck) => +spawnSync("ps", ["-eo", "pid=,args="], { encoding: "utf8" }).stdout.split("\n")
  .find((l) => l.includes(`server.mjs ${deck} --port`))?.trim().split(/\s+/)[0];
/* An event stream as the browser reads it: the blocks so far, as { ev, data } */
function readEvents(t, url, headers) {
  const ctrl = new AbortController(), list = [];
  t.after(() => ctrl.abort());
  const done = (async () => {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const dec = new TextDecoder();
    let buf = "";
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      for (let i; (i = buf.indexOf("\n\n")) >= 0;) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const ev = /^event: (.*)$/m.exec(block)?.[1], data = /^data: (.*)$/m.exec(block)?.[1];
        if (ev) list.push({ ev, data: JSON.parse(data) });
      }
    }
  })().catch(() => {});
  return { list, done };
}

test("Front: the tabs of a browser share one event stream; a deck server that stops is opened again", async (t) => {
  const fx = fixture(t);
  const s = await startFront(t, fx);
  const second = key(path.join(fx.talks, "second.html"));
  const stream = readEvents(t, `${s.url}/events?stream=test-stream-1`, s.jar);
  await waitFor(() => stream.list.some((e) => e.ev === "ready"), "the stream");
  const sub = (body) => fetch(`${s.url}/events/subscribe`, { method: "POST", body: JSON.stringify({ stream: "test-stream-1", ...body }),
    headers: { ...s.jar, origin: s.url, "content-type": "application/json" } });
  // two tabs: each gets its deck's events as if it had its own stream, starting with "hello"
  assert.equal((await sub({ tab: "1", deck: key(fx.talks), on: true })).status, 200);
  assert.equal((await sub({ tab: "2", deck: second, on: true })).status, 200);
  const of = (tab, type) => stream.list.filter((e) => e.ev === "deck" && e.data.tab === tab && e.data.type === type);
  await waitFor(() => of("1", "hello").length && of("2", "hello").length, "both hellos");
  assert.equal(of("2", "hello")[0].data.data.status.deckFile, "second.html");
  assert.equal((await s.api(`/d/${second}/api/message`, { text: "fake-op append notes.txt" })).status, 200);
  await waitFor(() => of("2", "chat").some((e) => e.data.data.kind === "turn"), "tab 2's turn");
  const saved = path.join(fx.home, "decks", second, "chat.json");
  await waitFor(() => fs.existsSync(saved) && fs.readFileSync(saved, "utf8").includes('"kind":"turn"'), "the chat saved");
  assert.equal(of("1", "chat").length, 0, "tab 1 gets its own deck's events only");
  // the second deck's server is killed: the tab is told, the deck opens again, and a new hello brings its state
  process.kill(serverPid(path.join(fx.talks, "second.html")), "SIGKILL");
  await waitFor(() => of("2", "gone").length, "tab 2 told");
  await waitFor(() => of("2", "hello").length === 2, "a new hello");
  assert.ok(of("2", "hello")[1].data.data.chat.some((e) => e.kind === "turn"), "with the chat as saved");
  // only for streams of this login, and a tab that leaves gets nothing more
  assert.equal((await fetch(`${s.url}/events?stream=test-stream-2`)).status, 403);
  assert.equal((await sub({ tab: "2", on: false })).status, 200);
  const n = stream.list.length;
  assert.equal((await s.api(`/d/${second}/api/message`, { text: "again" })).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(stream.list.slice(n).filter((e) => e.data?.tab === "2").length, 0);
});

test("Front: a proxied event stream ends when its deck server stops", async (t) => {
  const fx = fixture(t);
  const s = await startFront(t, fx);
  const events = readEvents(t, `${s.url}/d/${key(fx.talks)}/api/events`, s.jar);
  await waitFor(() => events.list.some((e) => e.ev === "hello"), "hello");
  process.kill(serverPid(fx.talks), "SIGKILL");
  await Promise.race([events.done, new Promise((_, no) => setTimeout(() => no(new Error("the stream stayed open")), 5000))]);
});

test("Fronts side by side: login and cli.mjs find the PinDeck that serves the deck; one PinDeck per deck", async (t) => {
  const fx = fixture(t);
  const other = path.join(fx.root, "other talks");
  fs.cpSync(path.join(ROOT, "ocean-example"), other, { recursive: true });
  const a = await startFront(t, fx), b = await startFront(t, fx, [other]);
  const run = (file, args, cwd = fx.root) => spawnSync(process.execPath, [file, ...args], { env: env(fx), encoding: "utf8", cwd });
  const linkOf = (r) => /(http:\/\/127\.0\.0\.1:\d+)\/login\?code=[0-9a-f]+/.exec(r.stdout)?.[1];
  // each deck's link from the front that serves it; without a deck, a link from each
  assert.equal(linkOf(run(FRONT, ["login", fx.talks])), a.url);
  assert.equal(linkOf(run(FRONT, ["login", other])), b.url);
  assert.equal(run(FRONT, ["login"]).stdout.match(/login\?code=/g).length, 2);
  // a deck no running PinDeck serves: said so, no link
  for (const d of ["/etc", path.join(fx.root, "nowhere.html"), path.join(fx.talks, "lecture", "old", "older")]) {
    const r = run(FRONT, ["login", d]);
    assert.equal(r.status, 1, d);
    assert.match(r.stderr, /^No running PinDeck serves /);
    assert.equal(r.stdout, "");
  }
  // cli.mjs from a terminal: the deck in the current folder, or --deck; a deck not open yet is opened
  const slides = run(CLI, ["slides"], fx.talks);
  assert.equal(slides.status, 0, slides.stderr);
  assert.match(slides.stdout, /^ 1  \S+/);
  const named = run(CLI, ["slides", "--deck", path.join(fx.talks, "second.html")]);
  assert.equal(named.status, 0, named.stderr);
  await waitFor(() => /\[second\.html\] opened/.test(a.output()), "the deck opened by the front");
  assert.match(run(CLI, ["slides"], path.join(fx.root)).stderr, /No index\.html in .*--deck/);
  // one front stops: the other still answers; a file left by a PinDeck that is gone is ignored and removed
  fs.writeFileSync(path.join(fx.home, "servers", "999999.json"), JSON.stringify({ pid: 999999, url: "http://127.0.0.1:1", token: "x", front: true }));
  process.kill(b.child.pid, "SIGTERM");
  await b.exited;
  assert.equal(linkOf(run(FRONT, ["login"])), a.url);
  assert.equal(fs.existsSync(path.join(fx.home, "servers", "999999.json")), false);
  // the deck is open in front a: neither a second front nor a server on its own opens it too
  const second = spawnFront(fx, [fx.talks, "--port", "0"]);
  assert.equal((await second.exited).code, 1);
  assert.match(second.output(), new RegExp(`index\\.html is open in another PinDeck already \\(${a.url}, process \\d+\\)`));
  const alone = spawnSync(process.execPath, [path.join(ROOT, "server.mjs"), fx.talks, "--port", "0"], { env: env(fx), encoding: "utf8", timeout: 10000 });
  assert.equal(alone.status, 1);
  assert.match(alone.stderr, /is open in another PinDeck already/);
});
