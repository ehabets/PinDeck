/* Decks made without reveal.js, which name their slides with <meta name="pindeck:slides">: the selector,
   the slides it finds, and the slide edits the editor makes on such a deck (lib/eids.mjs). */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse, findSlides, slideSelector, deckSize, parseSelector, assignEids, insertSlide, moveSlide, getNotes, setNotes } from "../lib/eids.mjs";
import { detectFramework, unsupportedMessage } from "../lib/frameworks.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DECK = fs.readFileSync(path.join(ROOT, "test", "fixtures", "selector-deck.html"), "utf8");
const page = (head, body) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const meta = (sel, size) => `<meta name="pindeck:slides" content="${sel}">` + (size ? `<meta name="pindeck:size" content="${size}">` : "");
const eidsOf = (html) => findSlides(parse(html)).map((s) => s.attrs["data-eid"]?.value);

test("selectors: tags, #id, .class and [attr], joined by spaces or >, in a list; anything else is refused", () => {
  assert.equal(parseSelector("main.deck > section.slide").length, 1);
  assert.equal(parseSelector('div#fit section.slide, [data-slide="a,b"], *.page').length, 3);
  for (const bad of ["section:not(.x)", "a + b", "a ~ b", "> a", "a >", "a,", "section::before", "div:nth-child(2)"])
    assert.throws(() => parseSelector(bad), undefined, bad);
});

test("the meta tag names the slides: child and descendant steps, attributes, and only the innermost match", () => {
  const body = '<main class="deck"><section class="slide" id="a">A</section><div><section class="slide">B</section></div></main>' +
    '<section class="slide">outside</section>';
  assert.equal(findSlides(parse(page(meta("main.deck > section.slide"), body))).length, 1);
  assert.equal(findSlides(parse(page(meta("main.deck section.slide"), body))).length, 2);
  assert.equal(findSlides(parse(page(meta("section.slide"), body))).length, 3);
  assert.equal(findSlides(parse(page(meta("#a, [class=slide]"), body))).length, 3);
  const nested = '<div class="slide">outer<div class="slide">inner 1</div><div class="slide">inner 2</div></div>';
  assert.deepEqual(findSlides(parse(page(meta("div.slide"), nested))).map((s) => s.children.length), [0, 0]);
  // an unusable selector finds nothing rather than guessing
  assert.equal(findSlides(parse(page(meta("section:first-child"), body))).length, 0);
  // without the meta tag, reveal.js decks are found as before
  assert.equal(findSlides(parse(fs.readFileSync(path.join(ROOT, "ocean-example", "index.html"), "utf8"))).length, 13);
});

test("slide size and selector from the meta tags", () => {
  const t = parse(DECK);
  assert.equal(slideSelector(t), "main.deck > section.slide");
  assert.deepEqual(deckSize(t), { width: 1024, height: 768 });
  assert.deepEqual(deckSize(parse(page('<meta name="pindeck:size" content="1440 × 1080">', ""))), { width: 1440, height: 1080 });
  assert.equal(deckSize(parse(page('<meta name="pindeck:size" content="wide">', ""))), null);
  assert.equal(slideSelector(parse(page("", ""))), null);
});

test("ids go on the slides and the elements in them, not on the deck's other markup", () => {
  const { html, slides } = assignEids(DECK);
  assert.deepEqual(slides.map((s) => s.eid), ["a-deck-without-reveal", "points", "a-figure"]);
  assert.match(html, /<li data-eid="points\/li">First point<\/li>/);
  assert.match(html, /<nav class="dock">/);              // outside the slides: left as it is
  assert.match(html, /<main class="deck">/);
  assert.equal(assignEids(html).changed, false);         // a second pass changes nothing
});

test("new, moved and annotated slides keep the deck's own structure", () => {
  const html = assignEids(DECK).html;
  const add = insertSlide(html, "content", "points");
  assert.equal(add.index, 2);
  const after = assignEids(add.html).html;
  assert.equal(findSlides(parse(after)).length, 4);
  assert.match(after.slice(after.indexOf("Second point")), /<section class="slide"[^>]*>\s*<h1[^>]*>New Slide<\/h1>/);
  assert.equal(findSlides(parse(assignEids(insertSlide(html, "duplicate", "a-figure").html).html)).length, 4);

  const toEnd = moveSlide(html, "a-deck-without-reveal", null);
  assert.deepEqual(eidsOf(toEnd.html), ["points", "a-figure", "a-deck-without-reveal"]);
  assert.equal(toEnd.index, 2);
  const back = moveSlide(toEnd.html, "a-deck-without-reveal", "points");
  assert.deepEqual(eidsOf(back.html), ["a-deck-without-reveal", "points", "a-figure"]);
  assert.match(toEnd.html, /<\/section>\n<\/main>\n<nav class="dock">/);   // still inside the deck's container

  const noted = setNotes(html, "points", "Say this\nthen that");
  assert.deepEqual(getNotes(noted.html, "points"), { text: "Say this\nthen that", html: false });
});

test("frameworks: a deck that names its slides is supported, and the messages say what to do", () => {
  assert.deepEqual(detectFramework(DECK), { name: "selector", selector: "main.deck > section.slide", supported: true });
  // the meta tag wins over a framework's markup: a Shower deck that names its slides is edited too
  const shower = page(meta(".shower > section.slide", "1024x768"), '<div class="shower list"><section class="slide">Hi</section></div>');
  assert.equal(detectFramework(shower).supported, true);
  assert.equal(unsupportedMessage(DECK, "talk.html"), null);
  // the size is needed too: headless Chrome and the PDF pages use it
  const slides = '<main class="deck"><section class="slide">x</section></main>';
  assert.equal(detectFramework(page(meta("main.deck > section.slide"), slides)).supported, false);
  for (const size of [null, "wide"])
    assert.match(unsupportedMessage(page(meta("main.deck > section.slide", size), slides), "talk.html"),
      /^talk\.html: <meta name="pindeck:size"> is missing or not a size such as content="1440x1080" .*Nothing was changed\.$/);
  assert.match(unsupportedMessage(page(meta("main > section.page"), "<main><section>x</section></main>"), "talk.html"),
    /^talk\.html: the slide selector "main > section\.page" in <meta name="pindeck:slides"> matches no elements\. Nothing was changed\.$/);
  assert.match(unsupportedMessage(page(meta("section:first-child"), ""), "talk.html"), /cannot be used: .*not supported/);
  assert.match(unsupportedMessage(page("", '<main class="deck"><section class="slide">x</section></main>'), "talk.html"),
    /<meta name="pindeck:slides" content="main\.deck > section\.slide">/);
});
