#!/usr/bin/env node
/* Browser check of a Quarto deck: headless Chrome, real clicks and typing. Needs quarto and Chrome.

   node scripts/quarto-check.mjs   (works on a copy of quarto-example's sources)

   Opens talk.qmd (PinDeck renders it), checks that hand edits are off (no New slide, no text editing, read-only
   notes), that the interactive OJS slide draws and answers its slider, keeps a comment on a math formula (its
   text is the TeX), then edits talk.qmd outside PinDeck: the slide reloads with the change and the comment is
   flagged. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { open, until, sleep } from "./browser.mjs";

const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pindeck-quarto-")), "talk");
fs.mkdirSync(dir);
for (const f of ["talk.qmd", "custom.scss"]) fs.copyFileSync(new URL(`../quarto-example/${f}`, import.meta.url), path.join(dir, f));
const b = await open(path.join(dir, "talk.qmd"));
const shots = [];
const shot = async (name) => { const f = path.join(b.tmp, name + ".png"); await b.shot(f); shots.push(f); };
const go = async (i) => {
  await b.clickSel(`#slide-list li[data-i="${i}"]`);
  await until(() => b.js(`return document.querySelector('#slide-list li.active')?.dataset.i === "${i}"`), `slide ${i + 1}`);
  await sleep(600);
};

// 1. rendered, and the editor knows it is a Quarto deck: no hand edits
assert.equal(await b.js(`return document.querySelectorAll("#slide-list li").length`), 6);
assert.ok(await b.js(`return document.body.classList.contains("quarto") && getComputedStyle(document.getElementById("add-slide-btn")).display === "none"`), "no New slide");
assert.equal(await b.js(`return document.getElementById("deck-source").textContent + " " + document.getElementById("deck-name").textContent`), "talk.qmd talk.qmd");
await go(5);
await until(() => b.js(`return document.getElementById("notes").textContent.includes("9 Hz")`), "the speaker notes");
assert.equal(await b.js(`return document.getElementById("notes").contentEditable`), "false", "notes are read-only");
await b.clickInSlide("section.present h2");
for (const type of ["keyDown", "keyUp"]) await b.cdp("Input.dispatchKeyEvent", { type, key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });   // edit the selected title
await sleep(400);
assert.equal(await b.frameJs(`return !!document.querySelector("[contenteditable=true], [contenteditable=plaintext-only]")`), false, "no text editing");
assert.match(await b.js(`return document.getElementById("toast").textContent`), /rendered by Quarto from talk\.qmd/);

// 2. the interactive slide: OJS draws the sampled sinusoid and follows the slider
await go(3);
await until(() => b.frameJs(`return document.querySelectorAll("section.present svg circle").length > 3`), "the OJS plot (its libraries load from the web)", 45000);
const before = await b.frameJs(`return document.querySelector("section.present svg polyline").getAttribute("points").slice(0, 80)`);
await b.frameJs(`const r = document.querySelector("section.present input[type=range]"); r.value = 9; r.dispatchEvent(new Event("input", { bubbles: true }));`);
await until(() => b.frameJs(`return document.querySelector("section.present").textContent.includes("looks like 1.0 Hz")`), "the alias text to follow the slider");
assert.notEqual(await b.frameJs(`return document.querySelector("section.present svg polyline").getAttribute("points").slice(0, 80)`), before);
await shot("quarto-ojs");

// 3. a comment on the formula of slide 2: its text is the TeX
await go(1);
await b.clickSel("#pin-toggle");
await until(() => b.frameJs(`return !!document.querySelector('section.present script[type^="math/tex"]')`), "MathJax", 30000);
const mathEid = await b.frameJs(`const s = document.querySelector('section.present script[type="math/tex; mode=display"]'); return s.closest("[data-eid]").dataset.eid;`);
await b.clickInSlide(`[data-eid="${mathEid}"]`, 0.5, 0.5);
await until(() => b.js(`return document.querySelectorAll("#pin-tray .chip").length === 1`), "the pin");
await b.type("#input", "Use \\Omega for the normalized frequency.");
await b.clickSel("#comment");
await until(() => b.js(`return document.getElementById("comments-count").textContent === "1"`), "the comment");
const review = JSON.parse(fs.readFileSync(path.join(dir, ".pindeck", "talk.review.json"), "utf8"));
assert.equal(review.comments[0].slide.id, "sampling-a-sinusoid");
const packet = fs.readFileSync(path.join(dir, ".pindeck", "talk.review.md"), "utf8");
assert.match(packet, /source `talk\.qmd`/);
assert.match(packet, /`#sampling-a-sinusoid`, source line 13 — ok/);

// 4. the source changes outside PinDeck: rendered, reloaded, the comment flagged
const qmd = path.join(dir, "talk.qmd");
fs.writeFileSync(qmd, fs.readFileSync(qmd, "utf8").replace("x[n] = x(nT_s)", "x[n] = x(n T_s)"));
await until(() => b.js(`return document.querySelector(".cmt.stale")`).then(Boolean).catch(() => false), "the comment to be flagged after the render", 60000);
await until(() => b.frameJs(`return [...document.querySelectorAll('section.present script[type^="math/tex"]')].some((s) => s.textContent.includes("n T_s"))`), "the slide to show the change", 30000);
await b.clickSel("#comments-btn");
await shot("quarto-comments");
console.log(`ok: Quarto deck rendered, hand edits off, OJS interactive, comment on math, outside edit re-rendered\n  ${shots.join("\n  ")}`);
process.exit(0);
