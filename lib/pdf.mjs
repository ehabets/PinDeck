/* PDF export through headless Chrome, in two steps.

   1. Layout: open the deck in reveal.js print view (?print-pdf) with --dump-dom and a virtual-time
      budget. Chrome runs the page's timers until reveal.js has built the print layout (one
      .pdf-page per slide, or per build step) and prints the resulting DOM. requestAnimationFrame
      is replaced by a timer for this, since headless Chrome renders no frames here.
   2. Print: the dumped DOM, without its scripts, is served as a static page and printed with
      --print-to-pdf. Nothing is left to wait for, so Chrome's print timing no longer matters.

   Chrome's own --print-to-pdf on the live deck prints before reveal.js has laid out the pages,
   and DevTools-based printing is not used because managed Chrome installs may forbid remote
   debugging. Only plain command-line flags are needed. */

import { spawn } from "node:child_process";
import fs from "node:fs";

/* Added to the <head> of the print page: headless Chrome renders no animation frames here, and
   reveal.js waits for one (requestAnimationFrame) before it builds the print layout. */
export const PDF_HEAD_TAG = `<script>window.requestAnimationFrame = function (cb) {
  return setTimeout(function () { cb(performance.now()); }, 16);
};</script>
</head>`;

/* Added to the end of the print page: print colours and backgrounds exactly. */
export const PDF_PAGE_TAG = `<style>@media print { * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; } }</style>
</body>`;

// Chrome refuses to run as root with its sandbox (containers, some servers); it says so, and needs --no-sandbox.
// Without --disable-field-trial-config a headless Chrome can wait forever for its field-trial setup (seen
// behind a proxy); PinDeck needs none of those experiments.
export const ROOT_ARGS = ["--disable-field-trial-config", ...(process.getuid?.() === 0 ? ["--no-sandbox"] : [])];
const BASE = ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--mute-audio", "--hide-scrollbars", ...ROOT_ARGS];

/* Why Chrome stopped, from what it printed: its last error line (such as "Running as root without
   --no-sandbox is not supported"), without the log prefix. "" if it said nothing useful. */
export function chromeReason(stderr) {
  // Chrome logs much that is harmless (display links, D-Bus, GPU, fonts): a fatal line first, then a plain reason
  const noise = /CVDisplayLink|dbus|gcm|fontconfig|gpu|viz|gles|egl|vaapi|sandbox_linux|ssl_client_socket/i;
  const lines = String(stderr).split("\n").filter((l) => l.trim() && !noise.test(l)).reverse();
  const clean = (l) => l.replace(/^\[[^\]]*\]\s*/, "").trim().slice(0, 300);
  const fatal = lines.find((l) => /:FATAL:/.test(l)), plain = lines.find((l) => /not supported|cannot|denied|no such|error/i.test(l));
  return fatal ? clean(fatal) : plain ? clean(plain) : "";
}
const exited = (what, err) => new Error(`${what}${chromeReason(err) ? `: ${chromeReason(err)}` : "."}`);

/* Runs Chrome with args, stops it once done(stdout, stderr) is true (Chrome often lingers). */
function chromeRun(chrome, args, profile, done, timeout) {
  return new Promise((resolve, reject) => {
    const proc = spawn(chrome, [...BASE, `--user-data-dir=${profile}`, ...args]);
    let out = "", err = "", finished = false;
    const finish = (e, v) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      proc.kill("SIGKILL");
      setTimeout(() => fs.rm(profile, { recursive: true, force: true }, () => {}), 500);
      e ? reject(e) : resolve(v);
    };
    const timer = setTimeout(() => finish(new Error("Chrome timed out.")), timeout);
    const check = () => { if (done(out, err)) setTimeout(() => finish(null, out), 150); };
    proc.stdout.on("data", (d) => { out += d; check(); });
    proc.stderr.on("data", (d) => { err += d; check(); });
    proc.on("error", (e) => finish(e));
    // "close", not "exit": at exit Chrome's last output (the line saying the file is written) may still be unread
    proc.on("close", () => (done(out, err) ? finish(null, out) : finish(exited("Chrome exited early", err))));
  });
}

/* Step 1: the deck's DOM after reveal.js has built the print layout, as static HTML. */
export async function printLayout(chrome, url, profile) {
  const dom = await chromeRun(chrome, ["--virtual-time-budget=15000", "--dump-dom", url], profile,
    (o) => /<\/html>\s*$/i.test(o), 60000);
  if (!/class="[^"]*pdf-page/.test(dom)) throw new Error("reveal.js did not build the print layout.");
  return "<!doctype html>\n" + dom.replace(/<script\b[\s\S]*?<\/script>/gi, "");
}

/* Step 2: print a (static) page to a PDF file. */
export async function printPdf(chrome, url, out, profile) {
  try { fs.rmSync(out, { force: true }); } catch {}
  // the virtual-time budget lets Chrome follow PinDeck's login start page to the print page before printing
  await chromeRun(chrome, ["--virtual-time-budget=5000", "--no-pdf-header-footer", `--print-to-pdf=${out}`, url], profile,
    (_o, e) => /bytes written to file/.test(e), 90000);
  if (!fs.existsSync(out)) throw new Error("Chrome did not write the PDF.");
  return out;
}
