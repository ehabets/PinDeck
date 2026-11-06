import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { indexDeck, commentFromPin, locate, loadReview, saveReview, packet, request, sourceLine, reviewFiles } from "../lib/review.mjs";

// A Quarto-shaped deck: a vertical stack, heading ids, a fragment, math, a figure, notes.
const deckHtml = (slideA, { withB = true } = {}) => `<!doctype html><html><body><div class="reveal"><div class="slides">
<section id="title-slide" class="quarto-title-block"><h1 class="title">Deck</h1></section>
<section>
<section id="part-one" class="title-slide slide level1"><h1>Part one</h1></section>
<section id="slide-a" class="slide level2"><h2>Slide A</h2>
${slideA}
<aside class="notes"><p>Speaker note text</p></aside>
</section>
${withB ? `<section id="custom-id" class="slide level2"><h2>Slide B</h2><p>Bravo</p></section>` : ""}
</section>
</div></div></body></html>`;
const A1 = `<p>Alpha text with <span class="math inline">\\(x^2\\)</span></p>
<ul><li class="fragment">First point</li></ul>
<p><img data-src="../figures/plot.png" style="width:50%"></p>`;
const SRC = "---\ntitle: Deck\n---\n\n# Part one\n\n## Slide A\n\nAlpha text with $x^2$\n\n## Slide B {#custom-id}\n\nBravo\n";

function pinOn(deck, slideId, match) {
  const s = deck.slides.find((x) => x.id === slideId);
  const el = match ? [...s.elements.values()].find(match) : null;
  return { pin: { slide: { index: s.index, eid: s.eid }, eid: el ? el.eid : s.eid, point: { x: 400, y: 300 }, at: { fx: 0.25, fy: 0.5 }, word: "Alpha" } };
}
const isAlpha = (e) => e.tag === "p" && /Alpha/.test(e.text);

test("indexes slides with their ids, stack positions, fragments and figures, skipping notes", () => {
  const d = indexDeck(deckHtml(A1));
  const a = d.slides.find((s) => s.id === "slide-a");
  assert.deepEqual([a.title, a.h, a.v], ["Slide A", 1, 1]);
  const els = [...a.elements.values()];
  assert.ok(els.some((e) => e.text === "Alpha text with x^2"));
  assert.ok(els.some((e) => e.tag === "li.fragment" && e.fragment));
  assert.ok(els.some((e) => e.tag === "img" && e.text === "../figures/plot.png"));
  assert.ok(!els.some((e) => /Speaker note/.test(e.text)), "speaker notes are not comment targets");
});

test("comments persist, and the packet carries what an agent needs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pindeck-review-"));
  const { json: file, packet: md } = reviewFiles(dir, "deck.html");
  assert.equal(path.relative(dir, md), path.join(".pindeck", "deck.review.md"));
  const d = indexDeck(deckHtml(A1));
  const c = commentFromPin(d, pinOn(d, "slide-a", isAlpha), "  Shorten this line.\nKeep the math.  ");
  assert.equal(c.text, "Shorten this line.\nKeep the math.");
  saveReview(file, { pindeckReview: 1, deck: {}, comments: [c] });
  const back = loadReview(file);
  assert.deepEqual(back.comments, [c]);
  assert.deepEqual(loadReview(path.join(dir, "none.json")).comments, []);

  const out = packet(back, d, { deckFile: "deck.html", source: "deck.qmd", srcText: SRC });
  assert.match(out, /## C1\. slide 2\.1 “Slide A”/);
  assert.match(out, /> Shorten this line\.\n> Keep the math\./);
  assert.match(out, /`#slide-a`, source line 7 — ok/);
  assert.match(out, /data-eid `[^`]+`\): “Alpha text with x\^2”/);
  assert.match(out, /not speaker notes/);
  assert.match(out, /never in the rendered HTML/);
  assert.match(request(back, d), /^Please address these 1 review comment/);

  back.comments[0].status = "resolved";
  assert.match(packet(back, d), /0 open comment\(s\), 0 unmatched; 1 resolved/);
  assert.equal(request(back, d), "");
});

test("a comment on the slide as a whole", () => {
  const d = indexDeck(deckHtml(A1));
  const s = d.slides.find((x) => x.id === "custom-id");
  const c = commentFromPin(d, { pin: null, slide: { index: s.index, eid: s.eid } }, "Too sparse");
  assert.equal(c.target.eid, null);
  assert.equal(c.point, null);
  assert.match(request({ comments: [c] }, d), /the slide as a whole/);
  assert.throws(() => commentFromPin(d, { pin: null, slide: { index: s.index, eid: "other" } }, "x"), /slide has changed/);
});

test("source lines resolve explicit ids and Pandoc auto ids", () => {
  const lines = SRC.split("\n");
  assert.equal(sourceLine(lines, { id: "custom-id", title: "Slide B" }), 11);
  assert.equal(sourceLine(lines, { id: "part-one", title: "Part one" }), 5);
  assert.equal(sourceLine(lines, { id: "gone", title: "Gone" }), null);
});

test("after a change comments are found again or flagged, never silently moved", () => {
  const d1 = indexDeck(deckHtml(A1));
  const onP = commentFromPin(d1, pinOn(d1, "slide-a", isAlpha), "p");
  const onSlide = commentFromPin(d1, pinOn(d1, "custom-id"), "whole slide");
  assert.equal(locate(d1, onP).status, "ok");

  // a paragraph inserted above: the positional id now names another element; the text finds it again
  const d2 = indexDeck(deckHtml("<p>New intro</p>\n" + A1));
  const moved = locate(d2, onP);
  assert.equal(moved.status, "moved");
  assert.equal(moved.slide.elements.get(moved.eid).text, onP.target.text);

  const changed = locate(indexDeck(deckHtml(A1.replace("Alpha text", "Shorter"))), onP);
  assert.deepEqual([changed.status, changed.eid, changed.now], ["changed", null, "Shorter with x^2"]);

  assert.equal(locate(indexDeck(deckHtml("<div>Only this</div>")), onP).status, "missing");
  assert.equal(locate(indexDeck(deckHtml(A1, { withB: false })), onSlide).status, "no-slide");
  // the heading id changed but the title did not: still the same slide
  assert.equal(locate(indexDeck(deckHtml(A1).replace('id="custom-id"', 'id="renamed"')), onSlide).status, "ok");

  const out = packet({ deck: {}, comments: [onP, onSlide] }, indexDeck(deckHtml("<div>Only this</div>", { withB: false })));
  assert.match(out, /2 open comment\(s\), 2 unmatched/);
  assert.match(out, /UNMATCHED: the slide is no longer in the deck/);
  assert.match(out, /UNMATCHED: the element is no longer on this slide/);
});

test("a comments file with a comment that cannot be placed is refused, not loaded", () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pindeck-review-")), "x.review.json");
  fs.writeFileSync(f, JSON.stringify({ comments: [{ id: "c-1", text: "x", status: "open" }] }));
  assert.throws(() => loadReview(f), /comment 1 lacks/);
});
