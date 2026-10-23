/* Which slide framework a deck uses. PinDeck edits reveal.js decks: <section> slides inside an element
   with class "slides" (inside <div class="reveal">). Any other deck can name its slides itself with
   <meta name="pindeck:slides" content="CSS selector"> (see lib/eids.mjs) and is then edited too. Other
   frameworks are recognised by their markup and scripts, so the user gets a clear "not supported (yet)"
   before PinDeck changes anything, instead of an editor without slides. Only tags and scripts are looked
   at, never the slides' text, so a talk that mentions "impress.js" is not taken for one. */

import { parse, findSlides, slideSelector, deckSize, parseSelector } from "./eids.mjs";

const OTHERS = [   // name, markers; the first match wins (Marp before bespoke.js, which it is built on)
  ["Marp", /\bmarpit\b|bespoke-marp|data-marpit|marp-cli/i],
  ["Slidev", /slidev/i],
  ["impress.js", /id=["']impress["']|impress(\.min)?\.js/i],
  ["remark", /remark(-latest)?(\.min)?\.js|remark\.create\s*\(/i],
  ["Spectacle", /<script[^>]+src=["'][^"']*spectacle/i],
  ["Shower", /class=["'][^"']*\bshower\b|shower-core/i],
  ["deck.js", /deck-container|deck\.core(\.min)?\.js/i],
  ["bespoke.js", /bespoke(\.min)?\.js|bespoke\.from\s*\(/i],
];

/* Tags and script contents only: the slides' text could name any framework */
const markup = (html) => [...String(html).matchAll(/<script\b[^>]*>[\s\S]*?<\/script>|<[^>]+>/gi)].map((m) => m[0]).join("\n");

/* { name, supported }: reveal.js decks are supported, including one without slides yet, and so is a deck
   whose <meta name="pindeck:slides"> selector finds slides and whose <meta name="pindeck:size"> gives their
   size ({ name: "selector", selector, supported }) */
export function detectFramework(html) {
  const tree = parse(html), selector = slideSelector(tree);
  if (selector) return { name: "selector", selector, supported: findSlides(tree).length > 0 && !!deckSize(tree) };
  if (findSlides(tree).length) return { name: "reveal.js", supported: true };
  const tags = markup(html);
  const other = OTHERS.find(([, re]) => re.test(tags));
  if (other) return { name: other[0], supported: false };
  if (/class=["'][^"']*\breveal\b/i.test(tags) || /Reveal\.initialize\s*\(/.test(tags)) return { name: "reveal.js", supported: true };
  return { name: null, supported: false };
}

const HOW = `A deck made otherwise can name its slides in its <head>: ` +
  `<meta name="pindeck:slides" content="main.deck > section.slide"> (a CSS selector for the slides) and ` +
  `<meta name="pindeck:size" content="1440x1080"> (their size in px).`;

/* The message for a deck PinDeck cannot edit, or null */
export function unsupportedMessage(html, file) {
  const fw = detectFramework(html);
  if (fw.supported) return null;
  if (fw.name === "selector") {
    // the slides are found: the size is what is missing (headless Chrome and the PDF pages need it)
    if (findSlides(parse(html)).length) return `${file}: <meta name="pindeck:size"> is missing or not a size ` +
      `such as content="1440x1080" (the slides' width and height in px). PinDeck opens the slides at that size ` +
      `for screenshots and PDFs. Nothing was changed.`;
    let why = "matches no elements";
    try { parseSelector(fw.selector); } catch (e) { why = `cannot be used: ${e.message}`; }
    return `${file}: the slide selector "${fw.selector}" in <meta name="pindeck:slides"> ${why}. Nothing was changed.`;
  }
  const what = fw.name ? `${file} is a ${fw.name} deck.` :
    `${file} has no reveal.js slides (a <div class="reveal"> with <div class="slides"> holding <section> slides).`;
  return `${what} PinDeck works with reveal.js decks; other frameworks may follow. ${HOW} ` +
    `Nothing was changed.`;
}
