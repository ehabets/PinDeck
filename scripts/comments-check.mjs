#!/usr/bin/env node
/* Browser check of review comments on a real deck: headless Chrome, real clicks and typing.

   node scripts/comments-check.mjs [deck folder]   (default: a copy of ocean-example)

   Pins an element and keeps a comment on it, keeps one on a slide as a whole, then changes the commented text
   outside PinDeck (the comment turns grey and says so), resolves the other one in the comments file as an
   outside agent would (the editor follows), puts the open comments into the message box, and opens a comment
   from its marker on the slide. The deck itself never gets the comments. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { open, until, sleep } from "./browser.mjs";

let deck = process.argv[2];
if (!deck) {
  deck = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pindeck-comments-")), "deck");
  fs.cpSync(new URL("../ocean-example", import.meta.url).pathname, deck, { recursive: true });
}
const b = await open(deck);
const FILE = path.join(deck, ".pindeck", "index.review.json");
const PACKET = path.join(deck, ".pindeck", "index.review.md");
const saved = () => JSON.parse(fs.readFileSync(FILE, "utf8"));

// 1. a comment on a pinned element of slide 3
await b.clickSel('#slide-list li[data-i="2"]');
await until(() => b.js(`return document.querySelector('#slide-list li.active')?.dataset.i === "2"`), "slide 3");
await sleep(500);
await b.clickSel("#pin-toggle");
const target = await b.frameJs(`const s = [...document.querySelectorAll("section")].find((x) => getComputedStyle(x).visibility !== "hidden" && x.querySelector("p[data-eid], li[data-eid]") && x.getBoundingClientRect().width > 0 && x.classList.contains("present") || x.classList.contains("__pindeck_cur"));
  const el = (s || document).querySelector("p[data-eid], li[data-eid]"); return { eid: el.dataset.eid, text: el.textContent.trim() };`);
await b.clickInSlide(`[data-eid="${target.eid}"]`);
await until(() => b.js(`return document.querySelectorAll("#pin-tray .chip").length === 1`), "the pin");
await b.type("#input", "Shorten this, it wraps.");
await b.clickSel("#comment");
await until(() => b.js(`return document.getElementById("comments-count").textContent === "1"`), "the comment count");
assert.equal(await b.js(`return document.getElementById("input").value`), "", "the box is emptied");
assert.equal(await b.js(`return document.querySelectorAll("#pin-tray .chip").length`), 0, "the pin is used up");
let s = saved();
assert.equal(s.comments[0].target.eid, target.eid);
assert.equal(s.comments[0].text, "Shorten this, it wraps.");
assert.equal(await b.frameJs(`return [...document.querySelectorAll(".__pin.__comment")].map((m) => m.textContent).join()`), "C1");

// 2. a comment on the slide as a whole: no pin
await b.clickSel("#pin-toggle");
await b.type("#input", "Too much on this slide.");
await b.clickSel("#comment");
await until(() => b.js(`return document.getElementById("comments-count").textContent === "2"`), "the second comment");
s = saved();
assert.equal(s.comments[1].target.eid, null);
assert.match(fs.readFileSync(PACKET, "utf8"), /2 open comment\(s\), 0 unmatched/);

// 3. the commented text changes outside PinDeck: the comment is flagged, not moved
const html = fs.readFileSync(path.join(deck, "index.html"), "utf8");
const at = html.indexOf(`data-eid="${target.eid}"`);
const close = html.indexOf("</", html.indexOf(">", at));
fs.writeFileSync(path.join(deck, "index.html"), html.slice(0, close) + " (edited)" + html.slice(close));
await until(() => b.js(`return document.querySelector(".cmt.stale .flag")?.textContent`), "the comment to be flagged");
await until(() => b.frameJs(`return document.querySelector(".__pin.__comment.__stale")`).then(Boolean), "a grey marker");
assert.match(fs.readFileSync(PACKET, "utf8"), /UNMATCHED: the element's text has changed/);

// 4. an agent outside PinDeck resolves the second comment in the file: the editor follows
s.comments[1].status = "resolved";
fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
await until(() => b.js(`return document.getElementById("comments-count").textContent === "1"`), "the count to follow the file");
assert.match(fs.readFileSync(PACKET, "utf8"), /1 open comment\(s\), 1 unmatched; 1 resolved/);

// 5. the open comments go into the message box as one request (nothing is sent)
await b.clickSel("#comments-btn");
await b.clickSel("#comments-send");
const req = await until(() => b.js(`return document.getElementById("input").value`), "the request in the box");
assert.match(req, /^Please address these 1 review comment/);
assert.match(req, /Shorten this, it wraps\./);
assert.doesNotMatch(req, /Too much on this slide/, "resolved comments stay out");

// 6. a marker on the slide opens its comment; Resolve in the list
await b.clickSel("#comments-btn");   // closed again
await b.click(...await b.frameJs(`const r = document.querySelector(".__pin.__comment").getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]`)
  .then(async ([x, y]) => { const f = await b.js(`const r = document.querySelector(".stage iframe:not(.loading):not(.measure)").getBoundingClientRect(); return [r.x, r.y]`); return [f[0] + x, f[1] + y]; }));
await until(() => b.js(`return !document.getElementById("comments-panel").hidden`), "the panel to open from the marker");
await b.clickSel('.cmt [data-act="resolved"]');
await until(() => b.js(`return document.getElementById("comments-count").textContent === ""`), "no open comments");
assert.equal(await b.frameJs(`return document.querySelectorAll(".__pin.__comment").length`), 0, "resolved comments have no marker");

await b.shot(path.join(b.tmp, "comments.png"));
const deckNow = fs.readFileSync(path.join(deck, "index.html"), "utf8");
assert.ok(!/Shorten this|Too much on this/.test(deckNow), "comments never go into the deck");
console.log(`ok: comments pinned, flagged after an outside edit, resolved from the file and the list (screenshot ${path.join(b.tmp, "comments.png")})`);
process.exit(0);
