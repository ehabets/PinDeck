/* Stable element ids for PinDeck.

   Gives every slide <section> and every visible element inside it a readable
   data-eid attribute ("summary", "summary/callout", "summary/li-2"), so the
   editor, the pins and Claude can all name the same element.

   The HTML is edited as text: only the attribute is inserted, so comments,
   indentation and everything else in the file stay exactly as they are.
   Existing ids are kept; duplicates (e.g. from a copied slide) are renamed. */

const VOID = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta",
  "param", "source", "track", "wbr"]);
const RAW = new Set(["script", "style", "textarea", "title"]);

/* Elements that get an id. Inline formatting (strong, em, sup, br, ...) does not:
   a pin on bold text resolves to the enclosing element plus the clicked word. */
const TAGGED = new Set(["section", "h1", "h2", "h3", "h4", "h5", "h6", "p", "ul", "ol", "li",
  "dl", "dt", "dd", "figure", "figcaption", "img", "svg", "table", "caption", "tr", "div",
  "button", "audio", "video", "iframe", "pre", "blockquote", "canvas", "header", "footer",
  "aside", "nav", "article"]);
const GENERIC_CLASSES = new Set(["fragment", "slide", "visible", "current-fragment", "present",
  "past", "future", "top", "left", "right", "center"]);

const ATTR_RE = /([^\s"'=\/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;

function parseAttrs(src, offset) {
  const attrs = {};
  let m;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(src))) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? "";
    let valueStart = -1;
    if (m[2] !== undefined || m[3] !== undefined || m[4] !== undefined) {
      let k = m[0].indexOf("=") + 1;
      while (/\s/.test(m[0][k])) k++;
      if (m[0][k] === '"' || m[0][k] === "'") k++;
      valueStart = offset + m.index + k;
    }
    const start = offset + m.index;
    attrs[name] = { value, valueStart, valueEnd: valueStart + value.length, start, end: start + m[0].length };
  }
  return attrs;
}

/* Minimal HTML tokenizer: builds an element tree with source offsets. */
export function parse(html) {
  const root = { name: "#root", children: [], parent: null };
  let cur = root;
  let i = 0;
  const n = html.length;
  while (i < n) {
    const lt = html.indexOf("<", i);
    if (lt < 0) break;
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (html[lt + 1] === "/") {
      const m = /^<\/\s*([a-zA-Z][\w:-]*)\s*>/.exec(html.slice(lt, lt + 80));
      if (!m) { i = lt + 1; continue; }
      const name = m[1].toLowerCase();
      // pop to the matching element (tolerates unclosed <p>/<li>)
      let node = cur;
      while (node !== root && node.name !== name) node = node.parent;
      if (node !== root) {
        let c = cur;
        while (c !== node) { c.closeStart = lt; c = c.parent; }
        node.closeStart = lt;
        cur = node.parent;
      }
      i = lt + m[0].length;
      continue;
    }
    if (!/[a-zA-Z]/.test(html[lt + 1] || "")) { i = lt + 1; continue; }

    // opening tag: scan to '>' outside quotes
    let j = lt + 1;
    while (j < n && /[\w:-]/.test(html[j])) j++;
    const name = html.slice(lt + 1, j).toLowerCase();
    const nameEnd = j;
    let quote = null;
    while (j < n) {
      const c = html[j];
      if (quote) { if (c === quote) quote = null; }
      else if (c === '"' || c === "'") quote = c;
      else if (c === ">") break;
      j++;
    }
    const tagEnd = j; // index of '>'
    const selfClose = html[tagEnd - 1] === "/";
    const attrSrc = html.slice(nameEnd, selfClose ? tagEnd - 1 : tagEnd);
    const node = {
      name, start: lt, nameEnd, tagEnd, selfClose,
      attrs: parseAttrs(attrSrc, nameEnd),
      children: [], parent: cur, contentStart: tagEnd + 1, closeStart: -1,
    };
    cur.children.push(node);
    i = tagEnd + 1;
    if (VOID.has(name) || selfClose) continue;
    if (RAW.has(name)) {
      // a case-insensitive search in place: toLowerCase() can change the length (İ), and with it the offsets
      const re = new RegExp("</" + name, "gi");
      re.lastIndex = i;
      const close = re.exec(html)?.index ?? -1;
      node.closeStart = close < 0 ? n : close;
      const gt = html.indexOf(">", node.closeStart);
      i = gt < 0 ? n : gt + 1;
      continue;
    }
    cur = node;
  }
  return root;
}

const classesOf = (node) => (node.attrs.class?.value || "").split(/\s+/).filter(Boolean);

const ENTITIES = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
function decode(s) {   // one pass, so "&amp;lt;" stays "&lt;"
  return s.replace(/&(?:(nbsp|amp|lt|gt|quot|apos)|#(\d+)|#x([0-9a-f]+));/gi, (m, name, d, x) =>
    name ? ENTITIES[name.toLowerCase()] : String.fromCodePoint(d ? +d : parseInt(x, 16)));
}
function textOf(html, node) {
  if (node.closeStart < 0) return "";
  return decode(html.slice(node.contentStart, node.closeStart).replace(/<[^>]*>/g, " "))
    .replace(/\\[()[\]]/g, " ").replace(/\s+/g, " ").trim();
}
function slug(text, maxWords = 4) {
  const words = text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  return words.slice(0, maxWords).join("-");
}
export function walk(node, fn) {
  for (const c of node.children) { if (fn(c) !== false) walk(c, fn); }
}
function find(node, pred) {
  let hit = null;
  walk(node, (c) => { if (hit) return false; if (pred(c)) { hit = c; return false; } });
  return hit;
}

/* ---- Decks made without reveal.js ----------------------------------------------------------------
   A deck names its slides with <meta name="pindeck:slides" content="main.deck > section.slide">, a CSS
   selector, and its size with <meta name="pindeck:size" content="1440x1080">. Selectors stay simple, so
   the server and the browser find the same slides: tag names, #id, .class, [attr] and [attr="value"],
   joined by spaces (descendant) or ">" (child), in a comma-separated list. */

const metaOf = (tree, name) => {
  const m = find(tree, (c) => c.name === "meta" && c.attrs.name?.value.trim().toLowerCase() === `pindeck:${name}`);
  return m ? decode(m.attrs.content?.value || "").trim() || null : null;
};
/* The deck's slide selector, or null for a reveal.js deck */
export const slideSelector = (tree) => metaOf(tree, "slides");
/* The deck's slide size from <meta name="pindeck:size">: { width, height } or null */
export function deckSize(tree) {
  const m = /^(\d{2,5})\s*[x×*,\s]\s*(\d{2,5})$/i.exec(metaOf(tree, "size") || "");
  return m ? { width: +m[1], height: +m[2] } : null;
}

const IDENT = "-?[_a-zA-Z\\u00a0-\\uffff][\\w\\u00a0-\\uffff-]*";
const COMPOUND = new RegExp(`^(?:(\\*|${IDENT})|#(${IDENT})|\\.(${IDENT})|\\[\\s*(${IDENT})\\s*(?:=\\s*(?:"([^"]*)"|'([^']*)'|(${IDENT}))\\s*)?\\])`);
/* "main.deck > section.slide, aside.extra" -> one list of compounds and combinators per selector.
   Throws with the part it cannot read (pseudo-classes, +, ~ ...). */
export function parseSelector(sel) {
  const parts = [];   // top-level commas only: not inside [attr="a,b"]
  let quote = null, depth = 0, from = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (quote) { if (c === quote) quote = null; }
    else if (c === '"' || c === "'") quote = c;
    else if (c === "[") depth++;
    else if (c === "]") depth--;
    else if (c === "," && !depth) { parts.push(sel.slice(from, i)); from = i + 1; }
  }
  parts.push(sel.slice(from));
  return parts.map((part) => {
    const steps = [];   // [{ tag, ids, classes, attrs }, ">" | " ", { ... }, ...]
    let s = part.trim(), cur = null;
    if (!s) throw new Error(`empty selector in "${sel}"`);
    while (s) {
      const ws = /^\s+/.exec(s);
      const gt = /^\s*>\s*/.exec(s);
      if (gt) { if (!cur) throw new Error(`"${part.trim()}" starts with ">"`); steps.push(">"); cur = null; s = s.slice(gt[0].length); continue; }
      if (ws) { steps.push(" "); cur = null; s = s.slice(ws[0].length); continue; }
      const m = COMPOUND.exec(s);
      if (!m) throw new Error(`"${s.slice(0, 20)}" in "${part.trim()}" is not supported (use tags, #id, .class, [attr], spaces and ">")`);
      if (!cur) { cur = { tag: null, ids: [], classes: [], attrs: [] }; steps.push(cur); }
      if (m[1]) {
        if (cur.tag || cur.ids.length || cur.classes.length || cur.attrs.length) throw new Error(`a tag name must come first in "${part.trim()}"`);
        cur.tag = m[1] === "*" ? null : m[1].toLowerCase();
      }
      else if (m[2]) cur.ids.push(m[2]);
      else if (m[3]) cur.classes.push(m[3]);
      else cur.attrs.push({ name: m[4].toLowerCase(), value: m[5] ?? m[6] ?? m[7] ?? null });
      s = s.slice(m[0].length);
    }
    if (typeof steps.at(-1) === "string") throw new Error(`"${part.trim()}" ends with a combinator`);
    return steps;
  });
}
function compoundMatches(node, c) {
  if (!node.attrs) return false;   // the root
  if (c.tag && node.name !== c.tag) return false;
  if (c.ids.some((id) => node.attrs.id?.value !== id)) return false;
  const cls = classesOf(node);
  if (c.classes.some((k) => !cls.includes(k))) return false;
  return c.attrs.every((a) => node.attrs[a.name] && (a.value == null || node.attrs[a.name].value === a.value));
}
/* steps[i] matches node, and the steps before it match its ancestors as their combinators say */
function stepsMatch(node, steps, i = steps.length - 1) {
  if (!compoundMatches(node, steps[i])) return false;
  if (i === 0) return true;
  if (steps[i - 1] === ">") return !!node.parent && stepsMatch(node.parent, steps, i - 2);
  for (let a = node.parent; a; a = a.parent) if (stepsMatch(a, steps, i - 2)) return true;
  return false;
}
/* Elements matching the selector, in document order; an element holding another match is a stack of
   slides, not a slide (as with reveal.js's vertical stacks) */
function selectorSlides(tree, sel) {
  let list;
  try { list = parseSelector(sel); } catch { return []; }
  const hits = [];
  walk(tree, (c) => { if (list.some((steps) => stepsMatch(c, steps))) hits.push(c); });
  const inside = (a, b) => { for (let p = b.parent; p; p = p.parent) if (p === a) return true; return false; };
  return hits.filter((h) => !hits.some((o) => o !== h && inside(h, o)));
}

/* Slides are leaf <section>s inside .slides; vertical-stack containers are not slides. A deck that names
   its slides with <meta name="pindeck:slides"> has the elements that selector matches instead. */
export function findSlides(tree) {
  const sel = slideSelector(tree);
  if (sel) return selectorSlides(tree, sel);
  const slidesEl = find(tree, (c) => classesOf(c).includes("slides"));
  if (!slidesEl) return [];
  const out = [];
  const visit = (node) => {
    for (const c of node.children) {
      if (c.name !== "section") continue;
      if (c.children.some((child) => child.name === "section")) visit(c);
      else out.push(c);
    }
  };
  visit(slidesEl);
  return out;
}

function slideTitle(html, section) {
  const cls = classesOf(section);
  const heading = find(section, (c) => /^h[1-3]$/.test(c.name));
  let main = "", sub = "";
  if (heading) {
    const subEl = find(heading, (c) => classesOf(c).includes("sub"));
    sub = subEl ? textOf(html, subEl) : "";
    main = textOf(html, heading);
    if (sub && main.endsWith(sub)) main = main.slice(0, -sub.length).trim();
  }
  return { main, sub, kind: cls.find((c) => /-slide$/.test(c)) || "content" };
}

function elementName(node) {
  if (node.name === "g") {
    const idx = node.attrs["data-fragment-index"]?.value;
    return idx ? `step-${idx}` : "g";
  }
  const cls = classesOf(node).find((c) => !GENERIC_CLASSES.has(c));
  return cls ? slug(cls.replace(/-/g, " "), 3) || node.name : node.name;
}

/* Returns { html, changed, assigned: [eid...], renamed: [[old,new]...], slides: [{eid,title,kind}] } */
export function assignEids(html) {
  const tree = parse(html);
  const sections = findSlides(tree);
  const isSlide = slideSelector(tree) ? ((c) => sections.includes(c)) : ((c) => c.name === "section");
  const used = new Set();
  const edits = []; // { at, insert } or { start, end, replace }
  const assigned = [], renamed = [];

  // Pass 1: slide ids. Content slides that share a main title ("Background") are named by subtitle.
  const titles = sections.map((s) => slideTitle(html, s));
  const mainCount = {};
  titles.forEach((t) => { if (t.main) mainCount[t.main] = (mainCount[t.main] || 0) + 1; });

  const unique = (base) => {
    let name = base, k = 2;
    while (used.has(name)) name = `${base}-${k++}`;
    used.add(name);
    return name;
  };
  const setEid = (node, eid) => {
    const existing = node.attrs["data-eid"];
    if (existing) {
      edits.push({ start: existing.valueStart, end: existing.valueEnd, replace: eid });
      renamed.push([existing.value, eid]);
    } else {
      let at = node.selfClose ? node.tagEnd - 1 : node.tagEnd;
      while (at > node.nameEnd && /\s/.test(html[at - 1])) at--;
      edits.push({ start: at, end: at, replace: ` data-eid="${eid}"` });
      assigned.push(eid);
    }
    node.eid = eid;
  };

  // Keep every existing, non-duplicate id first so new names never collide with them.
  const keep = new Set();
  // Reserve container ids too, including ids assigned to stacks by older versions.
  walk(tree, (c) => {
    const v = c.attrs?.["data-eid"]?.value;
    if (v && !used.has(v)) { used.add(v); keep.add(c); c.eid = v; }
  });

  const slides = [];
  sections.forEach((section, i) => {
    const t = titles[i];
    if (!keep.has(section)) {
      let base;
      if (t.kind === "title-slide") base = "title";
      else if (t.kind === "closing-slide") base = "closing";
      else if (t.sub && mainCount[t.main] > 1) base = slug(t.sub);
      else base = slug(t.main) || slug(t.sub);
      setEid(section, unique(base || `slide-${i + 1}`));
    }
    slides.push({ eid: section.eid, title: [t.main, t.sub].filter(Boolean).join(" / "), kind: t.kind });

    // Pass 2: elements inside the slide
    const visit = (node, inSvg) => {
      for (const c of node.children) {
        if (isSlide(c)) continue; // nested slide, handled on its own
        const cls = classesOf(c);
        if (c.name === "aside" && cls.includes("notes")) continue;
        if (c.attrs["data-noeid"]) continue;
        const isSvgRoot = c.name === "svg";
        const tagged = inSvg ? c.name === "g" : (TAGGED.has(c.name) || (c.name === "span" && cls.length > 0));
        if (tagged && !keep.has(c)) setEid(c, unique(`${section.eid}/${elementName(c)}`));
        visit(c, inSvg || isSvgRoot);
      }
    };
    visit(section, false);
  });

  if (!edits.length) return { html, changed: false, assigned, renamed, slides };
  edits.sort((a, b) => b.start - a.start);
  let out = html;
  for (const e of edits) out = out.slice(0, e.start) + e.replace + out.slice(e.end);
  return { html: out, changed: true, assigned, renamed, slides };
}

/* ---- Inline style edits (drag and resize in the editor) ---------------------------------- */

/* Sets or removes CSS properties in a style attribute, keeping the untouched declarations
   exactly as written. A value of null or "" removes the property. */
export function mergeStyle(src, set) {
  const parts = src.split(";").filter((p) => p.trim());
  const todo = Object.fromEntries(Object.entries(set).map(([k, v]) => [k.toLowerCase(), v]));
  const out = [];
  for (const p of parts) {
    const name = p.split(":")[0].trim().toLowerCase();
    if (!(name in todo)) { out.push(p); continue; }
    const v = todo[name];
    delete todo[name];
    if (v != null && v !== "") out.push(`${p.match(/^\s*/)[0]}${name}: ${v}`);
  }
  for (const [k, v] of Object.entries(todo)) if (v != null && v !== "") out.push(`${out.length ? " " : ""}${k}: ${v}`);
  return out.join(";").trim();
}

/* edits: [{ eid, set: { prop: value|null } }]. Returns { html, changed, missing: [eid] }. */
export function setStyles(html, edits) {
  const tree = parse(html);
  const byEid = new Map();
  walk(tree, (c) => { const v = c.attrs?.["data-eid"]?.value; if (v && !byEid.has(v)) byEid.set(v, c); });
  const ops = [], missing = [];
  for (const e of edits) {
    const node = byEid.get(e.eid);
    if (!node) { missing.push(e.eid); continue; }
    const st = node.attrs.style;
    const value = mergeStyle(st ? st.value : "", e.set).replace(/"/g, "'");
    if (st) {
      if (value === st.value) continue;
      if (value) ops.push({ start: st.valueStart, end: st.valueEnd, replace: value });
      else {
        let a = st.start;
        while (a > node.nameEnd && /\s/.test(html[a - 1])) a--;
        ops.push({ start: a, end: st.end, replace: "" });
      }
    } else if (value) {
      let at = node.selfClose ? node.tagEnd - 1 : node.tagEnd;
      while (at > node.nameEnd && /\s/.test(html[at - 1])) at--;
      ops.push({ start: at, end: at, replace: ` style="${value}"` });
    }
  }
  if (!ops.length) return { html, changed: false, missing };
  ops.sort((a, b) => b.start - a.start);
  let out = html;
  for (const o of ops) out = out.slice(0, o.start) + o.replace + out.slice(o.end);
  return { html: out, changed: true, missing };
}

/* ---- Text edits (inline editing in the editor) --------------------------------------------- */

/* The element with this id, or a descendant reached by element-child indices (path), e.g. a
   table cell [2] under a row that has the id. */
function nodeAt(html, eid, path = [], { anyKind = false } = {}) {
  let node = null;
  walk(parse(html), (c) => { if (node) return false; if (c.attrs?.["data-eid"]?.value === eid) { node = c; return false; } });
  for (const i of path) node = node?.children[i] || null;
  return node && (anyKind || node.closeStart >= 0) ? node : null;
}
/* End of an element in the source: after its closing tag, or after the tag itself for <img> etc. */
export const elementEnd = (html, node) => (node.closeStart >= 0 ? html.indexOf(">", node.closeStart) + 1 : node.tagEnd + 1);

/* Inner HTML of an element exactly as written in the source (math still as TeX). */
export function getInner(html, eid, path) {
  const node = nodeAt(html, eid, path);
  return node ? html.slice(node.contentStart, node.closeStart) : null;
}

/* Replaces the inner HTML of one element. Returns { html, changed } or null if not found. */
export function setInner(html, eid, path, inner) {
  const node = nodeAt(html, eid, path);
  if (!node) return null;
  const old = html.slice(node.contentStart, node.closeStart);
  if (old === inner) return { html, changed: false };
  return { html: html.slice(0, node.contentStart) + inner + html.slice(node.closeStart), changed: true };
}

/* ---- New bullets (Enter in a list item) ------------------------------------------------------ */

const allEids = (html) => {
  const ids = new Set();
  walk(parse(html), (c) => { const v = c.attrs?.["data-eid"]?.value; if (v) ids.add(v); });
  return ids;
};
const closeEnd = elementEnd;
export const lineIndent = (html, at) => {
  const ls = html.lastIndexOf("\n", at - 1) + 1;
  const pre = html.slice(ls, at);
  return /^\s*$/.test(pre) ? pre : "";
};

/* Inserts <tag class=...>inner</tag> right after the element `eid`, on its own line with the same
   indentation. The new element gets `newEid`, or a free variant of it. Returns { html, eid }. */
export function insertAfter(html, eid, { tag = "li", cls = "", inner = "", newEid }) {
  const node = nodeAt(html, eid);
  if (!node) return null;
  const used = allEids(html);
  // ids are written into the attribute as they are: nothing that could end it
  let id = String(newEid || "").replace(/["'<>&\s]/g, "") || `${eid}-next`, k = 2;
  const base = id.replace(/-\d+$/, "");
  while (used.has(id)) id = `${base}-${k++}`;
  const end = closeEnd(html, node);
  const indent = lineIndent(html, node.start);
  const attrs = (cls ? ` class="${cls.replace(/"/g, "")}"` : "") + ` data-eid="${id}"`;
  const el = `${indent ? "\n" + indent : ""}<${tag}${attrs}>${inner}</${tag}>`;
  return { html: html.slice(0, end) + el + html.slice(end), eid: id };
}

/* Removes the element `eid`, and its line if nothing else is on it. Returns the new html or null. */
export function removeElement(html, eid) {
  const node = nodeAt(html, eid, [], { anyKind: true });
  if (!node) return null;
  let a = node.start, b = closeEnd(html, node);
  const indent = lineIndent(html, a);
  if (indent || html[a - 1] === "\n") {
    const rest = html.slice(b).match(/^[ \t]*(?=\n|$)/);
    if (rest) { a -= indent.length; b += rest[0].length; if (html[a - 1] === "\n") a--; }
  }
  return html.slice(0, a) + html.slice(b);
}

/* ---- Deleting elements ------------------------------------------------------------------------ */

const MEDIA = new Set(["img", "svg", "video", "audio", "canvas", "iframe", "object", "picture"]);

/* What deleting `eid` would remove: the element, or its figure when it is the figure's only media,
   with the element's source HTML. Returns { eid, tag, outer } or null. */
export function deleteTarget(html, eid) {
  let node = nodeAt(html, eid, [], { anyKind: true });
  if (!node) return null;
  const p = node.parent;
  if (MEDIA.has(node.name) && p?.name === "figure" && p.attrs?.["data-eid"]) {
    let media = 0;
    walk({ children: p.children }, (c) => { if (MEDIA.has(c.name)) media++; });
    if (media === 1) node = p;   // delete the whole figure, caption included
  }
  const cls = (node.attrs.class?.value || "").split(/\s+/).filter(Boolean);
  return { eid: node.attrs["data-eid"].value, tag: node.name + (cls.length ? "." + cls.join(".") : ""),
    outer: html.slice(node.start, elementEnd(html, node)) };
}

/* Relative file references (src, data, poster, href) in a piece of HTML. */
export function fileRefs(fragment) {
  const out = new Set();
  for (const m of fragment.matchAll(/\b(?:src|data|poster|href)\s*=\s*["']([^"'#?]+)/gi)) {
    const v = m[1].trim();
    if (v && !/^([a-z]+:|\/\/|\/)/i.test(v)) out.add(v.replace(/^\.\//, ""));
  }
  return [...out];
}

/* ---- New slides ---------------------------------------------------------------------------------- */

export const classList = (n) => (n.attrs?.class?.value || "").split(/\s+/).filter(Boolean);
const slideKind = (n) => classList(n).find((c) => /-slide$/.test(c)) || "content";

/* Inserts a new slide after the slide `afterEid`, modelled on a slide of the deck itself so it
   matches the design:
     content    title and two placeholder bullets, from a content slide (the current one if it is one)
     section    a section divider, from the deck's first divider
     duplicate  a copy of the current slide
   Element ids are left out; assignEids() gives the new slide fresh ones. In a deck made without reveal.js,
   the slide's own id is left out too: such decks (and Present) go to slides by their id.
   Returns { html, index } (index of the new slide) or { error }. */
export function insertSlide(html, kind, afterEid) {
  const tree = parse(html), slides = findSlides(tree);
  if (!slides.length) return { error: "The deck has no slides." };
  const after = slides.find((s) => s.attrs["data-eid"]?.value === afterEid) || slides.at(-1);
  const hasHead = (s) => { let h = false; walk({ children: [s] }, (c) => { if (/^h[1-3]$/.test(c.name)) h = true; }); return h; };
  let tpl;
  if (kind === "duplicate") tpl = after;
  else if (kind === "section") tpl = slides.find((s) => slideKind(s) === "section-slide");
  else tpl = [after, ...slides].find((s) => slideKind(s) === "content" && hasHead(s));
  if (!tpl) return { error: kind === "section" ? "This deck has no section divider to model a new one on." : "This deck has no content slide to model a new one on." };

  let frag = html.slice(tpl.start, elementEnd(html, tpl)).replace(/\s+data-eid="[^"]*"/g, "");
  if (slideSelector(tree)) frag = frag.replace(/^(<[^>]*?)\s+id=(?:"[^"]*"|'[^']*'|[^\s>]+)/, "$1");   // the opening tag only
  if (kind !== "duplicate") frag = placeholderSlide(frag, kind, slides.filter((s, i) => i <= slides.indexOf(after) && slideKind(s) === "section-slide").length + 1);

  const indent = lineIndent(html, after.start);
  const end = elementEnd(html, after);
  return { html: html.slice(0, end) + `\n\n${indent}` + frag + html.slice(end), index: slides.indexOf(after) + 1 };
}

/* Turns a copied slide into an empty one: placeholder title and text, no notes or references. */
function placeholderSlide(frag, kind, sectionNumber) {
  const root = parse(frag).children[0];
  const edits = [];   // { start, end, text }
  const inner = (n, text) => edits.push({ start: n.contentStart, end: n.closeStart, text });
  const drop = (n) => {
    let a = n.start;
    while (a > 0 && /[ \t]/.test(frag[a - 1])) a--;
    if (frag[a - 1] === "\n") a--;
    edits.push({ start: a, end: elementEnd(frag, n), text: "" });
  };
  const find = (pred, from = root) => { let hit = null; walk({ children: [from] }, (c) => { if (!hit && pred(c)) hit = c; }); return hit; };
  const heading = find((c) => /^h[1-3]$/.test(c.name));
  if (heading) {
    const sub = find((c) => classList(c).includes("sub"), heading);
    inner(heading, (kind === "section" ? "New Section" : "New Slide") +
      (sub ? frag.slice(sub.start, sub.contentStart) + "Subtitle" + frag.slice(sub.closeStart, elementEnd(frag, sub)) : ""));
  }
  for (const c of root.children) {
    if (c.name === "aside" || classList(c).includes("refs")) drop(c);   // speaker notes, references
  }
  if (kind === "section") {
    const num = find((c) => classList(c).includes("num"));
    if (num) inner(num, String(sectionNumber).padStart(frag.slice(num.contentStart, num.closeStart).trim().length, "0"));
    const p = find((c) => c.name === "p" && !classList(c).includes("kicker"));
    if (p) inner(p, "One line on what this part is about");
  } else {
    const body = find((c) => classList(c).includes("slide-body"));
    if (body) {
      const ind = lineIndent(frag, body.start);
      inner(body, `\n${ind}  <ul class="bullets">\n${ind}    <li>First point</li>\n${ind}    <li>Second point</li>\n${ind}  </ul>\n${ind}`);
    }
    // keep only the head and body of a content slide (no stray figures or callouts from the model slide)
    for (const c of root.children) if (c !== body && !find((x) => x === heading, c) && c.name !== "aside" && !classList(c).includes("refs")) drop(c);
  }
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) frag = frag.slice(0, e.start) + e.text + frag.slice(e.end);
  return frag;
}

/* ---- Moving slides ------------------------------------------------------------------------------- */

/* A slide in the source: the <section> and the comments right above it (the banner naming its
   layout), which move with it. prevEnd is the end of whatever precedes it in its parent. */
function slideBlock(html, s) {
  const sib = s.parent.children, i = sib.indexOf(s);
  const prevEnd = i > 0 ? elementEnd(html, sib[i - 1]) : s.parent.contentStart;
  const c = html.slice(prevEnd, s.start).indexOf("<!--");
  return { prevEnd, start: c >= 0 ? prevEnd + c : s.start, end: elementEnd(html, s) };
}

/* Moves the slide `eid` (with its comments, notes and everything in it) before the slide `beforeEid`,
   or to the end when beforeEid is null. Only the slide's text moves; ids and attributes stay as they
   are. Slides inside vertical stacks are not moved. Returns { html, changed, from, index } or { error }. */
export function moveSlide(html, eid, beforeEid) {
  const byEid = (all, e) => all.find((s) => s.attrs["data-eid"]?.value === e);
  const tree = parse(html), slides = findSlides(tree);
  const bySelector = !!slideSelector(tree);   // such decks have no vertical stacks
  const slide = byEid(slides, eid), target = beforeEid == null ? null : byEid(slides, beforeEid);
  if (!slide || (beforeEid != null && !target)) return { error: "Slide not found in the file." };
  if (!bySelector && [slide, target].some((s) => s?.parent.name === "section")) return { error: "Slides inside a vertical stack cannot be moved yet." };
  const from = slides.indexOf(slide);
  const top = slide.parent.children.filter((c) => (bySelector ? slides.includes(c) : c.name === "section"));
  const next = top[top.indexOf(slide) + 1] || null;
  if (target === slide || target === next) return { html, changed: false, from, index: from };

  const b = slideBlock(html, slide);
  const text = html.slice(b.start, b.end), indent = lineIndent(html, slide.start);
  // cut from the end of whatever precedes the slide, so the whitespace before the next one stays
  const cut = html.slice(0, b.prevEnd) + html.slice(b.end);
  const rest = findSlides(parse(cut));
  let out;
  if (target) {
    const at = slideBlock(cut, byEid(rest, beforeEid)).start;
    out = cut.slice(0, at) + text + `\n\n${indent}` + cut.slice(at);
  } else {
    // A final vertical stack is absent from the leaf-slide list, but we must insert after it.
    const last = bySelector ? rest.at(-1) : find(parse(cut), (c) => classesOf(c).includes("slides"))
      .children.filter((c) => c.name === "section").at(-1);
    const at = elementEnd(cut, last);
    out = cut.slice(0, at) + `\n\n${indent}` + text + cut.slice(at);
  }
  const moved = findSlides(parse(out));
  return { html: out, changed: true, from, index: moved.indexOf(byEid(moved, eid)) };
}

/* ---- Speaker notes ---------------------------------------------------------------------------------
   A slide's notes are its <aside class="notes"> (reveal.js speaker view). Notes of plain text and <br>
   (as the PowerPoint import writes them) are edited as text with line breaks; notes with other markup
   are edited as their HTML, so no formatting is lost. */

const notesOf = (slide) => slide.children.find((c) => c.name === "aside" && classesOf(c).includes("notes")) || null;
const PLAIN_NOTES = /^[^<]*(?:<br\s*\/?>[^<]*)*$/i;
const escText = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slideByEid = (html, eid) => findSlides(parse(html)).find((s) => s.attrs["data-eid"]?.value === eid) || null;

/* Returns { text, html } (html: true when the notes are edited as HTML), or null if there is no such slide. */
export function getNotes(html, eid) {
  const slide = slideByEid(html, eid);
  if (!slide) return null;
  const aside = notesOf(slide);
  const inner = aside ? html.slice(aside.contentStart, aside.closeStart).replace(/\s+/g, " ").trim() : "";
  if (!PLAIN_NOTES.test(inner)) return { text: inner, html: true };
  return { text: inner.split(/\s*<br\s*\/?>\s*/i).map(decode).join("\n"), html: false };
}

/* Sets the notes of slide `eid` to `text` (or to the HTML `text` when asHtml). Empty notes remove the
   aside; a slide without notes gets one as its last child, on its own line. Returns { html, changed } or null. */
export function setNotes(html, eid, text, asHtml = false) {
  const slide = slideByEid(html, eid);
  if (!slide) return null;
  const t = String(text ?? "").trim();
  const body = asHtml ? t : t.split(/\r?\n/).map((l) => escText(l.trim())).join("<br>");
  const aside = notesOf(slide);
  let out;
  if (aside && !body) {
    let a = aside.start;
    while (a > 0 && /[ \t]/.test(html[a - 1])) a--;
    if (html[a - 1] === "\n") a--;
    out = html.slice(0, a) + html.slice(elementEnd(html, aside));
  } else if (aside) {
    out = html.slice(0, aside.contentStart) + body + html.slice(aside.closeStart);
  } else if (body) {
    const tag = `<aside class="notes">${body}</aside>`;
    const ls = html.lastIndexOf("\n", slide.closeStart - 1) + 1;
    if (/^[ \t]*$/.test(html.slice(ls, slide.closeStart))) {
      const ind = (slide.children[0] && lineIndent(html, slide.children[0].start)) || html.slice(ls, slide.closeStart) + "  ";
      out = html.slice(0, ls) + `${ind}${tag}\n` + html.slice(ls);
    } else {
      out = html.slice(0, slide.closeStart) + tag + html.slice(slide.closeStart);   // a slide written on one line
    }
  } else {
    out = html;
  }
  return { html: out, changed: out !== html };
}

/* ---- Single attributes (hide or show a slide) ------------------------------------------------------ */

/* Sets attribute `name` on the element `eid` to `value`, or removes it when value is null.
   Only that attribute changes in the source. Returns { html, changed } or null if not found. */
export function setAttr(html, eid, name, value) {
  const node = nodeAt(html, eid, [], { anyKind: true });
  if (!node) return null;
  const a = node.attrs[name];
  let out;
  if (value == null) {
    if (!a) return { html, changed: false };
    let s = a.start;
    while (s > node.nameEnd && /\s/.test(html[s - 1])) s--;
    out = html.slice(0, s) + html.slice(a.end);
  } else {
    const v = String(value).replace(/"/g, "&quot;");
    if (a && a.valueStart >= 0) {
      if (a.value === v) return { html, changed: false };
      out = html.slice(0, a.valueStart) + v + html.slice(a.valueEnd);
    } else if (a) {
      out = html.slice(0, a.start) + `${name}="${v}"` + html.slice(a.end);
    } else {
      // after the class attribute if there is one, so <section class="slide" data-visibility="hidden" ...>
      const at = node.attrs.class ? node.attrs.class.end : node.nameEnd;
      out = html.slice(0, at) + ` ${name}="${v}"` + html.slice(at);
    }
  }
  return { html: out, changed: true };
}
