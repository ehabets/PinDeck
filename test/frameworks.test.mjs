/* Which slide framework a deck uses: reveal.js is edited, others get a clear message. */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectFramework, unsupportedMessage } from "../lib/frameworks.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const page = (head, body) => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;

test("reveal.js: the example deck, a deck without slides yet, and one whose text names other frameworks", () => {
  assert.deepEqual(detectFramework(fs.readFileSync(path.join(ROOT, "ocean-example", "index.html"), "utf8")),
    { name: "reveal.js", supported: true });
  assert.equal(detectFramework(page("", '<div class="reveal"><div class="slides"></div></div>')).supported, true);
  const talk = page("", '<div class="reveal"><div class="slides"><section><h2>Why not impress.js, remark or Marp?</h2>' +
    "<p>Slidev and Spectacle are nice too.</p></section></div></div>");
  assert.deepEqual(detectFramework(talk), { name: "reveal.js", supported: true });
});

test("other frameworks are named, from their markup and scripts", () => {
  const cases = {
    Marp: page('<meta name="generator" content="marp-cli">', '<div class="marpit"><svg data-marpit-svg=""></svg></div>'),
    Slidev: page('<script type="module" src="/assets/slidev.js"></script>', '<div id="app"></div>'),
    "impress.js": page('<script src="js/impress.js"></script>', '<div id="impress"><div class="step">Hi</div></div>'),
    remark: page('<script src="https://remarkjs.com/downloads/remark-latest.min.js"></script>',
      '<textarea id="source"># Hi</textarea><script>var slideshow = remark.create();</script>'),
    Spectacle: page('<script src="https://unpkg.com/spectacle@10/dist/spectacle.min.js"></script>', '<div id="root"></div>'),
    Shower: page('<link rel="stylesheet" href="shower/themes/ribbon/styles/screen.css">', '<div class="shower list"><section class="slide">Hi</section></div>'),
    "deck.js": page('<script src="core/deck.core.js"></script>', '<div class="deck-container"><section class="slide">Hi</section></div>'),
    "bespoke.js": page('<script src="bespoke.min.js"></script>', '<article><section>Hi</section></article><script>bespoke.from("article")</script>'),
  };
  for (const [name, html] of Object.entries(cases)) assert.deepEqual(detectFramework(html), { name, supported: false }, name);
});

test("plain HTML: no framework, and the message says what PinDeck looks for", () => {
  const html = page("<title>Notes</title>", "<h1>Notes on remark and impress.js</h1><p>Not a deck.</p>");
  assert.deepEqual(detectFramework(html), { name: null, supported: false });
  assert.match(unsupportedMessage(html, "notes.html"), /^notes\.html has no reveal\.js slides \(a <div class="reveal">/);
  assert.match(unsupportedMessage(page("", '<div class="marpit"></div>'), "talk.html"),
    /^talk\.html is a Marp deck\. PinDeck works with reveal\.js decks; other frameworks may follow\. A deck made otherwise can name its slides in its <head>: <meta name="pindeck:slides" content="[^"]+"> .*Nothing was changed\.$/);
  assert.equal(unsupportedMessage(page("", '<div class="reveal"><div class="slides"><section>A</section></div></div>'), "x.html"), null);
});
