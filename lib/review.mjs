/* Review comments (after Sebastian J. Schlecht's review mode for PinDeck).

   A comment is a note on a slide or one of its elements, kept for later instead of sent to the assistant now.
   Comments live in <deck folder>/.pindeck/<deck>.review.json: a dot folder, so they are never deck files, never
   part of an undo and never edited by the assistant. Each comment keeps what it needs to be found again after
   the deck changes: the slide's id attribute (Quarto's heading anchor), title and position, and the element's
   id, tag and text. A comment whose slide or element cannot be found again is flagged, never silently moved.
   Next to the comments, <deck>.review.md is the review packet: the open comments, for an agent outside PinDeck. */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { assignEids, parse, findSlides, walk, textOf } from "./eids.mjs";
import { writeAtomic } from "./deck-files.mjs";

const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim();
const classes = (n) => (n.attrs?.class?.value || "").split(/\s+/).filter(Boolean);
const tagOf = (n) => [n.name, ...classes(n)].join(".");

/* The deck as comments see it: per slide, its id attribute, title, position in the stacks and its elements by
   id. Ids are assigned in memory (a deck PinDeck has opened has them already; a rendered Quarto deck gets them
   again after each render). */
export function indexDeck(html) {
  const withIds = assignEids(html).html;
  const tree = parse(withIds);
  const slides = findSlides(tree).map((sec, index) => {
    const stacked = sec.parent?.name === "section";
    const top = stacked ? sec.parent : sec;
    const siblings = (n) => (n.parent?.children || []).filter((c) => c.name === sec.name);
    let head = null;
    walk(sec, (c) => { if (head) return false; if (/^h[1-3]$/.test(c.name)) { head = c; return false; } });
    const elements = new Map();
    walk(sec, (c) => {
      if (c.name === "section" || (c.name === "aside" && classes(c).includes("notes"))) return false;
      const eid = c.attrs?.["data-eid"]?.value;
      if (!eid) return;
      let fragment = false;
      for (let p = c; p && p !== sec; p = p.parent) if (classes(p).includes("fragment")) fragment = true;
      const src = c.name === "img" ? (c.attrs["data-src"] || c.attrs.src)?.value : null;
      elements.set(eid, { eid, tag: tagOf(c), text: norm(src || textOf(withIds, c)), fragment });
    });
    return {
      index, eid: sec.attrs["data-eid"]?.value, id: sec.attrs.id?.value || null,
      title: head ? norm(textOf(withIds, head)) : "",
      h: siblings(top).indexOf(top), v: stacked ? siblings(sec).indexOf(sec) : 0, elements,
    };
  });
  return { html: withIds, slides };
}

/* A new comment from a pin placed in the editor (bridge.js onClick), or from the slide as a whole (pin null,
   slide { index, eid }). */
export function commentFromPin(deck, { pin, slide: whole }, text) {
  const ref = pin ? pin.slide : whole;
  const slide = deck.slides[ref?.index];
  if (!slide || slide.eid !== ref.eid) throw new Error("The slide has changed since the pin was placed. Pin it again.");
  const onSlide = !pin || pin.eid === slide.eid;
  const el = onSlide ? null : slide.elements.get(pin.eid);
  if (!onSlide && !el) throw new Error("Element not found in the deck. Pin it again.");
  const r = (v) => Math.round(v * 1e4) / 1e4;
  const now = new Date().toISOString();
  return {
    id: "c-" + crypto.randomBytes(4).toString("hex"), created: now, updated: now, status: "open", text: String(text).trim(),
    slide: { id: slide.id, eid: slide.eid, title: slide.title, h: slide.h, v: slide.v },
    target: el ? { eid: el.eid, tag: el.tag, text: el.text, fragment: el.fragment, word: pin.word || null, cell: pin.cell || null }
      : { eid: null, tag: "section", text: "", fragment: false, word: null, cell: null },
    // where the marker sits: on the slide (px), and inside its element (0..1 of its box)
    point: pin?.point ? { x: r(pin.point.x), y: r(pin.point.y) } : null,
    at: pin?.at ? { fx: r(pin.at.fx), fy: r(pin.at.fy) } : null,
  };
}

/* Where a stored comment is in the deck as it is now.
   status: ok        same slide, same element, same text
           moved     the element's text was found elsewhere on the slide (ids can be positional)
           changed   the element is there but its text differs: possibly already addressed
           missing   the slide is there, the element is not
           no-slide  neither the slide's id nor its title exists any more
   Only "ok" and "moved" place the marker on the element; the others at the stored point on the slide (if any). */
export function locate(deck, c) {
  // shortcut: repeated titles resolve to the first; add an h/v tiebreak if decks repeat titles without ids
  const slide = (c.slide.id && deck.slides.find((s) => s.id === c.slide.id)) ||
    (c.slide.eid && deck.slides.find((s) => s.eid === c.slide.eid && (!c.slide.title || s.title === c.slide.title))) ||
    (c.slide.title && deck.slides.find((s) => s.title === c.slide.title));
  if (!slide) return { status: "no-slide", slide: null, eid: null };
  const t = c.target;
  if (!t.eid) return { status: "ok", slide, eid: null };
  const els = [...slide.elements.values()];
  const same = slide.elements.get(t.eid);
  if (same && same.tag === t.tag && same.text === t.text) return { status: "ok", slide, eid: same.eid };
  const moved = t.text && (els.find((e) => e.tag === t.tag && e.text === t.text) || els.find((e) => e.text === t.text));
  if (moved) return { status: "moved", slide, eid: moved.eid };
  if (same && same.tag === t.tag) return { status: "changed", slide, eid: null, now: same.text };
  return { status: "missing", slide, eid: null };
}
export const matched = (status) => status === "ok" || status === "moved";

/* ---- The comments file ------------------------------------------------------------------------ */
export function reviewFiles(deckDir, deckFile) {
  const base = path.join(deckDir, ".pindeck", deckFile.replace(/\.html?$/i, ""));
  return { json: base + ".review.json", packet: base + ".review.md" };
}
export function loadReview(file) {
  try {
    const r = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!r || !Array.isArray(r.comments)) throw new Error(`${file} is not a PinDeck comments file.`);
    return r;
  } catch (e) { if (e.code === "ENOENT") return { pindeckReview: 1, deck: {}, comments: [] }; throw e; }
}
export function saveReview(file, review) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, JSON.stringify(review, null, 2) + "\n");   // a crash never leaves half a file
}

/* ---- The review packet ------------------------------------------------------------------------------ */
const pandocId = (s) => norm(s.replace(/\{[^}]*\}\s*$/, "")).toLowerCase()
  .replace(/[^\p{L}\p{N}\s_.-]/gu, "").replace(/^[^\p{L}]+/u, "").replace(/\s+/g, "-");

/* 1-based line of the slide's heading in a Quarto/Markdown source, or null. */
export function sourceLine(srcLines, slide) {
  if (!srcLines || !slide) return null;
  const i = srcLines.findIndex((l) => {
    const m = /^#{1,3}\s+(.*)$/.exec(l);
    if (!m) return false;
    const explicit = /\{[^}]*#([\w:.-]+)/.exec(m[1]);
    return explicit ? explicit[1] === slide.id : pandocId(m[1]) === slide.id || norm(m[1]) === slide.title;
  });
  return i < 0 ? null : i + 1;
}

const STATUS = {
  ok: "ok", moved: "ok (element found again by its text)",
  changed: "UNMATCHED: the element's text has changed since the comment (maybe already addressed)",
  missing: "UNMATCHED: the element is no longer on this slide",
  "no-slide": "UNMATCHED: the slide is no longer in the deck",
};
const clip = (s, n = 240) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const slideName = (s) => `slide ${s.h + 1}${s.v ? "." + s.v : ""} “${s.title || "(untitled)"}”`;

/* The open comments in deck order, each with where it is now and its number in the editor's list (C1, C2, …) */
export function openComments(review, deck) {
  const n = new Map(review.comments.map((c, i) => [c.id, i + 1]));
  const key = (x) => (x.loc.slide ? x.loc.slide.index : 1e6) * 1e5 + (x.c.point?.y ?? 0);
  return review.comments.filter((c) => c.status !== "resolved").map((c) => ({ c, n: n.get(c.id), loc: locate(deck, c) }))
    .sort((a, b) => key(a) - key(b));
}
function items(list, lines) {
  return list.flatMap(({ c, n, loc }) => {
    const s = loc.slide, t = c.target;
    const line = sourceLine(lines, s || { id: c.slide.id, title: c.slide.title });
    return [`## C${n}. ${s ? slideName(s) : "was " + slideName(c.slide)}`, "",
      `> ${c.text.replace(/\n/g, "\n> ")}`, "",
      `- Slide: ${c.slide.id ? `\`#${c.slide.id}\`` : `\`${s?.eid || c.slide.eid}\``}${line ? `, source line ${line}` : ""} — ${STATUS[loc.status]}`,
      t.eid ? `- Element: \`${t.tag}\`${matched(loc.status) ? ` (data-eid \`${loc.eid}\`)` : ""}${t.fragment ? ", a build step" : ""}: “${clip(t.text)}”`
        : "- Element: the slide as a whole",
      ...(t.word ? [`- Clicked word: “${t.word}”`] : []),
      ...(t.cell ? [`- Table cell: row ${t.cell.row + 1}, column ${t.cell.col + 1}: “${clip(t.cell.text || "", 80)}”`] : []),
      ...(loc.status === "changed" ? [`- Text now: “${clip(loc.now)}”`] : []),
      `- Comment id: \`${c.id}\``, ""];
  });
}

/* For an agent outside PinDeck (Claude Code in an editor, say): written next to the comments file */
export function packet(review, deck, { deckFile = "the deck", source = null, srcText = null, commentsFile = "?" } = {}) {
  const open = openComments(review, deck);
  const stale = open.filter((x) => !matched(x.loc.status));
  const resolved = review.comments.length - open.length;
  return [
    `# Slide review: ${deckFile}`, "",
    `- Deck: \`${deckFile}\`${source ? `, source \`${source}\`` : ""}`,
    `- Comments: \`${commentsFile}\``,
    `- ${open.length} open comment(s), ${stale.length} unmatched; ${resolved} resolved (not listed).`, "",
    "These are reviewer comments on the slides. They are not speaker notes: do not copy them into the deck.",
    source ? `Make each change in the source (\`${source}\`, its stylesheets or figure scripts), never in the rendered HTML, ` +
      "which the next render overwrites. Render, then" : "Make each change, then",
    "set the comment's `status` to `\"resolved\"` in the comments file. UNMATCHED comments point at slides or text that",
    "changed after the comment was made: check whether they still apply before acting on them.", "",
    ...items(open, srcText?.split("\n")),
  ].join("\n");
}

/* For PinDeck's own assistant: the open comments as one request, put in the message box for the user to send */
export function request(review, deck, { source = null, srcText = null } = {}) {
  const open = openComments(review, deck);
  if (!open.length) return "";
  return [`Please address these ${open.length} review comment(s), one by one. They are notes for you, not slide text or speaker notes.`,
    "Mark each one you have addressed as resolved with PinDeck's resolve command and its comment id. If one is unclear or no",
    "longer applies, leave it open and say so instead of guessing.", "",
    ...items(open, source ? srcText?.split("\n") : null)].join("\n").trim();
}
