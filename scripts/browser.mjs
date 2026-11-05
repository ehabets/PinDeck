/* Headless Chrome for the browser checks (scripts/*-check.mjs): a PinDeck deck server, Chrome, and a small
   DevTools protocol client that can reach into the deck's sandboxed frame. Needs Chrome (or CHROME_BIN).
   Not part of `npm test`: these checks take tens of seconds and start real browsers. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const CHROME = [process.env.CHROME_BIN, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && fs.existsSync(p));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, what, ms = 30000) {
  let last;
  for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) { try { last = await fn(); } catch (e) { last = e; } if (last && !(last instanceof Error)) return last; }
  throw new Error(`Timed out waiting for ${what}${last instanceof Error ? ` (${last.message})` : ""}`);
}

/* Starts the deck server for `deck` and Chrome logged in to it. Returns helpers; everything stops on exit. */
export async function open(deck, { width = 1600, height = 1000 } = {}) {
  if (!CHROME) throw new Error("Chrome not found (set CHROME_BIN)");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pindeck-check-"));
  const PORT = 5600 + Math.floor(Math.random() * 300), CDP = PORT + 400;
  const kids = [];
  process.on("exit", () => kids.forEach((k) => k.kill()));
  const server = spawn(process.execPath, [new URL("../server.mjs", import.meta.url).pathname, deck, "--port", String(PORT)],
    { env: { ...process.env, PINDECK_HOME: path.join(tmp, "home") }, stdio: ["ignore", "pipe", "pipe"] });
  kids.push(server);
  let log = "";
  server.stdout.on("data", (d) => { log += d; });
  server.stderr.on("data", (d) => { log += d; });
  const login = await until(() => /PinDeck: (http\S+)/.exec(log)?.[1] || (server.exitCode != null && new Error(log)), "the deck server", 120000);
  kids.push(spawn(CHROME, ["--headless=new", `--remote-debugging-port=${CDP}`, `--user-data-dir=${tmp}/chrome`,
    `--window-size=${width},${height}`, "--no-first-run", "about:blank"], { stdio: "ignore" }));
  const page = await until(async () => (await (await fetch(`http://127.0.0.1:${CDP}/json/list`)).json()).find((t) => t.type === "page"), "Chrome");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let seq = 0;
  const waiting = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); waiting.get(d.id)?.(d); waiting.delete(d.id); };
  const cdp = (method, params = {}, sessionId) => new Promise((ok, fail) => {
    const id = ++seq;
    waiting.set(id, (d) => (d.error ? fail(new Error(method + ": " + d.error.message)) : ok(d.result)));
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const evaluate = async (expr, sessionId) => {
    const r = await cdp("Runtime.evaluate", { expression: `(async () => { ${expr} })()`, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  /* The editor page */
  const js = (expr) => evaluate(expr);
  /* The visible slide's frame: sandboxed, so a process (and a DevTools target) of its own */
  const sessions = new Map();   // targetId -> sessionId
  async function frameJs(expr) {
    const src = await js(`return document.querySelector(".stage iframe:not(.loading):not(.measure)")?.src`);
    if (!src) throw new Error("no slide frame");
    const { targetInfos } = await cdp("Target.getTargets");
    // the frame's own URL is the redirect's target, under /v/<token>/: match it by its query
    const t = targetInfos.filter((x) => x.type === "iframe" && /[?&]editor=main\b/.test(x.url) && x.url.split("#")[0].endsWith(new URL(src).search)).at(-1);
    if (!t) throw new Error("slide frame not found");
    if (!sessions.has(t.targetId)) sessions.set(t.targetId, (await cdp("Target.attachToTarget", { targetId: t.targetId, flatten: true })).sessionId);
    return evaluate(expr, sessions.get(t.targetId));
  }
  async function click(x, y) {
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  }
  const clickSel = async (sel) => click(...await js(`const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2];`));
  /* Clicks an element of the visible slide, found by a selector inside the frame */
  async function clickInSlide(sel, fx = 0.3, fy = 0.5) {
    const r = await frameJs(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error("no ${sel.replace(/"/g, "'")}");
      const b = el.getBoundingClientRect(); return [b.x + b.width * ${fx}, b.y + b.height * ${fy}];`);
    const f = await js(`const b = document.querySelector(".stage iframe:not(.loading):not(.measure)").getBoundingClientRect(); return [b.x, b.y];`);
    await click(f[0] + r[0], f[1] + r[1]);
  }
  const type = async (sel, text) => { await js(`const t = document.querySelector(${JSON.stringify(sel)}); t.focus(); t.value = "";`); await cdp("Input.insertText", { text }); };
  const shot = async (file) => fs.writeFileSync(file, Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).data, "base64"));

  await cdp("Runtime.enable");
  await cdp("Page.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await cdp("Page.navigate", { url: login });
  await until(() => js(`return document.querySelectorAll("#slide-list li").length > 0 && !!document.querySelector(".stage iframe:not(.loading):not(.measure)")`), "the editor and the deck", 60000);
  return { js, frameJs, click, clickSel, clickInSlide, type, shot, cdp, log: () => log, tmp };
}
