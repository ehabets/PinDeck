#!/usr/bin/env node
/* PinDeck command line: the assistant's self-checks (need the PinDeck server running) and git setup.

   node cli.mjs layout <slide>...   measured layout and issues of one or more slides
                                    (add --issues for the issues only: layout 9 10 11 --issues)
   node cli.mjs shot <slide>...     screenshots with pin markers; prints the PNG paths
   node cli.mjs slides              slide numbers and ids
   node cli.mjs pdf handout         PDF with one page per slide (build steps in their final state)
   node cli.mjs pdf presentation    PDF with one page per build step
                                    (add "all" to include hidden slides: pdf handout all)
   node cli.mjs pdf-figure <pdf> <page> [x,y,w,h] [figures/name.png] [--width 1600]
                                    a page of an attached PDF, or a box of it (fractions of the page
                                    from the top left), as PNG: without a name in the screenshots
                                    folder to look at, with one saved into the deck

   node cli.mjs git-setup [deck]    keep PinDeck's data-eid ids out of git (no server needed; a folder or deck file)

   <slide> is a slide id (data-eid), a slide number (1-based) or "current". The assistant's commands reach its
   own deck server (DECK_EDITOR_URL); run from a terminal, they reach the PinDeck that serves the deck in the
   current folder (its index.html), or the deck named with --deck <folder | file.html>. */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { deckTarget, homeDir } from "./lib/deck-target.mjs";
import { serverFor } from "./lib/servers.mjs";

const args = process.argv.slice(2);
const deckAt = args.indexOf("--deck");
const deckArg = deckAt >= 0 ? args.splice(deckAt, 2)[1] : null;
const [cmd, ...rest] = args;
const arg = rest[0];

/* git-setup: a git "clean" filter strips PinDeck's data-eid attributes whenever git reads the deck's
   HTML, so ids never reach a commit and id-only changes do not show in `git status`. The ids stay in
   the file on disk, where PinDeck and the assistant need them. The filter is plain sed, so it does not depend
   on where PinDeck is installed; git config is per clone, so run this once in each clone. */
if (cmd === "git-setup") {
  const FILTER = `sed 's/ data-eid="[^"]*"//g'`;
  let deck = path.resolve(arg || ".");
  try { if (!fs.statSync(deck).isDirectory()) deck = path.dirname(deck); } catch {}   // a deck file: its folder
  try { deck = fs.realpathSync(deck); } catch {}   // git reports the real path; a symlinked path would not match
  const git = (...a) => execFileSync("git", ["-C", deck, ...a], { encoding: "utf8" }).trim();
  let root;
  try { root = git("rev-parse", "--show-toplevel"); }
  catch { console.error(`${deck} is not inside a git repository.`); process.exit(1); }
  git("config", "filter.pindeck-ids.clean", FILTER);
  const rel = path.relative(root, deck).split(path.sep).join("/");
  // .gitattributes patterns end at whitespace: spaces in folder names are written as [[:space:]]
  const pattern = `${rel ? rel.replace(/\s/g, "[[:space:]]") + "/" : ""}*.html`;
  const attrFile = path.join(root, ".gitattributes");
  const attrs = fs.existsSync(attrFile) ? fs.readFileSync(attrFile, "utf8") : "";
  const line = `${pattern} filter=pindeck-ids`;
  const added = !attrs.split("\n").some((l) => l.trim() === line);
  if (added) fs.writeFileSync(attrFile, attrs + (attrs && !attrs.endsWith("\n") ? "\n" : "") + line + "\n");
  console.log(`Git filter "pindeck-ids" configured in ${root} (local git config).`);
  console.log(added ? `Added "${line}" to .gitattributes; commit that file.` : `.gitattributes already has "${line}".`);
  process.exit(0);
}
const issuesOnly = cmd === "layout" && rest.includes("--issues");
const slides = rest.filter((a) => a !== "--issues");
if (!["layout", "shot", "slides", "pdf", "pdf-figure"].includes(cmd)) {
  console.error("Usage: node cli.mjs layout|shot <slide>... [--issues]  |  node cli.mjs slides  |  node cli.mjs pdf handout|presentation  |  " +
    "node cli.mjs pdf-figure <pdf> <page> [x,y,w,h] [figures/name.png] [--width px]  |  node cli.mjs git-setup [deck]");
  process.exit(2);
}
/* pdf-figure: the box and the output name are told apart by their form, so their order does not matter */
function figureQuery(args) {
  const w = args.indexOf("--width"), width = w >= 0 ? args.splice(w, 2)[1] : "";
  const [file = "", page = "1", ...more] = args;
  return { file: file && path.resolve(file), page, width,
    box: more.find((a) => /^[\d.]+(,[\d.]+){3}$/.test(a)) || "", out: more.find((a) => /\.png$/i.test(a)) || "" };
}

let url = process.env.DECK_EDITOR_URL, token = process.env.DECK_EDITOR_TOKEN;
if (!url || !token) {
  // from a terminal: the deck's own server if it is open, else a front that lists it (which opens it)
  const deck = deckTarget(deckArg || process.cwd());
  if (!fs.existsSync(path.join(deck.dir, deck.file))) {
    console.error(`No ${deck.file} in ${deck.dir}: run this in a deck's folder, or name the deck with --deck <folder | file.html>.`);
    process.exit(2);
  }
  const found = await serverFor(homeDir(), deck);
  if (!found) { console.error(`No running PinDeck serves ${path.join(deck.dir, deck.file)} (start it with: pindeck ${deckArg || "."}).`); process.exit(1); }
  ({ url, token } = found.own || found.front);
  if (!found.own) url = `${url}/d/${deck.key}`;
}

/* layout and shot take several slides, so the assistant needs no shell loop or pipe (which PinDeck refuses) */
const queries = cmd === "pdf-figure" ? [figureQuery([...rest])]
  : cmd === "pdf" ? [{ slide: rest[0] || "handout", ...(rest[1] === "all" ? { all: "1" } : {}) }]
  : cmd === "slides" ? [{}] : (slides.length ? slides : ["current"]).map((slide) => ({ slide }));
let ok = true;
for (const q of queries) {
  let res, out;
  try {
    res = await fetch(`${url}/api/${cmd}?` + new URLSearchParams(q), { headers: { "x-editor-token": token } });
    out = await res.text();
  } catch {
    console.error("Cannot reach the PinDeck server at " + url + ". Is it running?");
    process.exit(1);
  }
  if (res.ok && issuesOnly) {
    const lines = out.split("\n"), i = lines.findIndex((l) => l.startsWith("Issues"));
    out = [lines[0], ...lines.slice(i)].join("\n");
  }
  (res.ok ? console.log : console.error)(out);
  ok &&= res.ok;
}
process.exit(ok ? 0 : 1);
