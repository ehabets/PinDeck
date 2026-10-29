/* The PinDecks running for this user, and which one serves a deck: shared by the front, the deck server,
   `pindeck login` and cli.mjs.

   Each PinDeck process (a front, a deck server on its own, or one behind a front) keeps a file of its own in
   ~/.pindeck-v3/servers/<pid>.json (0600, in a 0700 folder) with its address and token. Several fronts and
   servers can run side by side (another --port, another PINDECK_HOME user, a server started on its own) and
   none overwrites another's file; a file whose process is gone is removed when it is read. */

import fs from "node:fs";
import path from "node:path";

const dirOf = (home) => path.join(home, "servers");
export const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

/* info: { url, token, front?, key?, deckDir?, behindFront? }. Returns the function that removes the file again
   (only if it is still ours). */
export function registerServer(home, info) {
  const dir = dirOf(home);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, `${process.pid}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...info, pid: process.pid }, null, 2), { mode: 0o600 });
  fs.chmodSync(file, 0o600);
  return () => { try { if (JSON.parse(fs.readFileSync(file, "utf8")).token === info.token) fs.rmSync(file, { force: true }); } catch {} };
}

/* The running ones, the newest first */
export function runningServers(home) {
  let names = [];
  try { names = fs.readdirSync(dirOf(home)).filter((f) => /^\d+\.json$/.test(f)); } catch {}
  const out = [];
  for (const name of names) {
    const file = path.join(dirOf(home), name);
    try {
      const info = JSON.parse(fs.readFileSync(file, "utf8"));
      if (alive(info.pid)) { out.push({ ...info, since: fs.statSync(file).mtimeMs }); continue; }
    } catch {}
    try { fs.rmSync(file, { force: true }); } catch {}
  }
  return out.sort((a, b) => b.since - a.since);
}

const ask = async (s, p) => {
  const res = await fetch(`${s.url}${p}`, { headers: { "x-editor-token": s.token }, signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
};

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

/* Who serves a deck (a deckTarget): { front, key } a front whose deck list has it (open or not), under that
   front's key for it, and/or { own } its deck server if one runs (on its own, or behind a front). Decks are
   compared by real path: the same folder can be named through a symlink (on macOS a terminal in /var/... is
   in /private/var/...). null: no running PinDeck serves it. */
export async function serverFor(home, deck) {
  const all = runningServers(home), file = real(path.join(deck.dir, deck.file));
  const own = all.find((s) => !s.front && (s.key === deck.key || real(path.join(s.deckDir, s.deckFile || "index.html")) === file)) || null;
  for (const f of all.filter((s) => s.front)) {
    try {
      const { decks } = await ask(f, "/api/decks");
      const d = decks.find((x) => !x.problem && (x.key === deck.key || real(path.join(x.root, x.rel)) === file));
      if (d) return { front: f, key: d.key, own };
    } catch {}
  }
  return own ? { front: null, key: own.key, own } : null;
}

/* pindeck login [deck]: a new one-time login link, from the PinDeck that serves the deck (the link then opens
   it), or from each PinDeck running when no deck is named. Prints and exits. */
export async function printLogin(home, deck) {
  let targets;
  if (deck) {
    const found = await serverFor(home, deck);
    const shown = path.join(deck.dir, deck.file);
    if (!found || (!found.front && found.own.behindFront)) {
      console.error(`No running PinDeck serves ${shown}.` + (runningServers(home).length ? " Open it from a running PinDeck's deck menu, or start PinDeck for it." : ""));
      process.exit(1);
    }
    targets = [found.front ? { s: found.front, next: `/d/${found.key}/`, label: shown } : { s: found.own, next: "/", label: shown }];
  } else {
    targets = runningServers(home).filter((s) => !s.behindFront).map((s) => ({ s, next: "/", label: s.deckDir }));
    if (!targets.length) { console.error("No PinDeck is running."); process.exit(1); }
  }
  let ok = true;
  for (const { s, next, label } of targets) {
    try { console.log(`PinDeck (${label}): ${(await ask(s, "/api/login-link?" + new URLSearchParams({ next }))).url}`); }
    catch { ok = false; console.error(`The PinDeck at ${s.url} (${label}) does not answer. Is it still running?`); }
  }
  process.exit(ok ? 0 : 1);
}
