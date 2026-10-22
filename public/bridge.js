/* Editor bridge, injected into the deck page by the editor server (never saved to the deck).

   Modes (?editor=...):
     main     the visible slide in the editor: navigation, selection, drag and resize, text editing, pins
     measure  hidden 1280x720 copy used to measure any slide without moving the user's view
     shot     headless screenshot of one slide, with pin markers
     dump     headless measurement; writes the result into the DOM for --dump-dom
     pdf      print layout for the PDF export (decks made without reveal.js; reveal.js has its own) */

(function () {
  const params = new URLSearchParams(location.search);
  const MODE = params.get("editor");
  // A deck describes itself with <meta name="pindeck:footer-top"> (no footer check without it) and
  // <meta name="pindeck:locked"> (brand elements that cannot be selected or moved).
  const deckMeta = (n) => document.querySelector(`meta[name="pindeck:${n}"]`)?.content?.trim();
  const FOOTER_TOP = deckMeta("footer-top") ? +deckMeta("footer-top") : null;
  const LOCKED_SEL = deckMeta("locked") || ".slide-foot, .logo";
  // A deck made without reveal.js names its slides with <meta name="pindeck:slides"> (a CSS selector)
  const SLIDE_SEL = deckMeta("slides") || null;
  const SLIDE = SLIDE_SEL ? `:is(${SLIDE_SEL})` : ".reveal .slides section";   // in CSS and closest()
  const SLIDE_OF = SLIDE_SEL || "section";   // the slide an element is on
  const host = () => (window.parent !== window ? window.parent.__editorHost : null);
  let W = 1280, H = 720, deck = null;   // deck: reveal.js or a selector deck (see "Decks" below)

  /* ---- Styles for editor-only overlays ---------------------------------------- */
  const css = document.createElement("style");
  // --pindeck-u = screen pixels per slide pixel, inverted: overlays keep a constant on-screen size at any
  // zoom (a name of its own: decks use --u for their own units)
  css.textContent = `
    .__pin { position:absolute; z-index:1000; width:calc(26px*var(--pindeck-u,1)); height:calc(26px*var(--pindeck-u,1));
      margin:calc(-13px*var(--pindeck-u,1)) 0 0 calc(-13px*var(--pindeck-u,1)); border-radius:50%;
      background:#ED8C01; color:#fff; font:700 calc(14px*var(--pindeck-u,1))/calc(26px*var(--pindeck-u,1)) system-ui, sans-serif; text-align:center;
      box-shadow:0 0 0 calc(2px*var(--pindeck-u,1)) #fff, 0 calc(2px*var(--pindeck-u,1)) calc(6px*var(--pindeck-u,1)) rgba(0,0,0,.45);
      cursor:pointer; pointer-events:auto; }
    .__hover { position:absolute; z-index:999; pointer-events:none; outline:calc(2px*var(--pindeck-u,1)) dashed #ED8C01;
      outline-offset:calc(2px*var(--pindeck-u,1)); background:rgba(237,140,1,.06); }
    .__hover span { position:absolute; left:calc(-2px*var(--pindeck-u,1)); background:#ED8C01; color:#fff; white-space:nowrap;
      font:600 calc(11px*var(--pindeck-u,1))/calc(17px*var(--pindeck-u,1)) system-ui, sans-serif; padding:0 calc(5px*var(--pindeck-u,1));
      border-radius:calc(3px*var(--pindeck-u,1)); }
    .__hover span.above { top:calc(-21px*var(--pindeck-u,1)); } .__hover span.below { bottom:calc(-21px*var(--pindeck-u,1)); }
    .__hover.locked { outline-color:#888; background:rgba(0,0,0,.04); }
    .__hover.locked span { background:#888; }
    .__flash { position:absolute; z-index:998; pointer-events:none; outline:calc(3px*var(--pindeck-u,1)) solid #ED8C01;
      outline-offset:calc(3px*var(--pindeck-u,1)); animation:__flash 1.4s ease-out forwards; }
    @keyframes __flash { 0%,60% { opacity:1 } 100% { opacity:0 } }
    html.__pinmode ${SLIDE}, html.__pinmode ${SLIDE} * { cursor:crosshair !important; }
    html.__pinmode ${SLIDE} .__pin { cursor:pointer !important; }
    .__hover.sel { outline:calc(1px*var(--pindeck-u,1)) solid #1a73e8; outline-offset:0; background:none; }
    .__hover.sel span { background:#1a73e8; }
    .__sel { position:absolute; z-index:1001; pointer-events:none; outline:calc(1.5px*var(--pindeck-u,1)) solid #1a73e8; }
    .__sel i { position:absolute; width:calc(9px*var(--pindeck-u,1)); height:calc(9px*var(--pindeck-u,1)); margin:calc(-5px*var(--pindeck-u,1)) 0 0 calc(-5px*var(--pindeck-u,1));
      background:#fff; border:calc(1.5px*var(--pindeck-u,1)) solid #1a73e8; box-sizing:border-box; pointer-events:auto; }
    .__sel i[data-h="nw"] { left:0; top:0; cursor:nwse-resize; }   .__sel i[data-h="n"] { left:50%; top:0; cursor:ns-resize; }
    .__sel i[data-h="ne"] { left:100%; top:0; cursor:nesw-resize; } .__sel i[data-h="e"] { left:100%; top:50%; cursor:ew-resize; }
    .__sel i[data-h="se"] { left:100%; top:100%; cursor:nwse-resize; } .__sel i[data-h="s"] { left:50%; top:100%; cursor:ns-resize; }
    .__sel i[data-h="sw"] { left:0; top:100%; cursor:nesw-resize; } .__sel i[data-h="w"] { left:0; top:50%; cursor:ew-resize; }
    .__sel.readonly i { display:none; }
    .__sel-label { position:absolute; left:calc(-1.5px*var(--pindeck-u,1)); white-space:nowrap; background:#1a73e8; color:#fff;
      font:600 calc(11px*var(--pindeck-u,1))/calc(17px*var(--pindeck-u,1)) system-ui, sans-serif; padding:0 calc(5px*var(--pindeck-u,1));
      border-radius:calc(3px*var(--pindeck-u,1)); font-variant-numeric:tabular-nums; }
    .__sel-label.above { top:calc(-21px*var(--pindeck-u,1)); } .__sel-label.below { bottom:calc(-21px*var(--pindeck-u,1)); }
    .__guide { position:absolute; z-index:1002; pointer-events:none; background:#e5399d; }
    .__guide.v { top:0; height:100%; width:calc(1px*var(--pindeck-u,1)); }
    .__guide.h { left:0; width:100%; height:calc(1px*var(--pindeck-u,1)); }
    html.__selmode ${SLIDE} * { cursor:default; }
    html.__selmode ${SLIDE} .__selected, html.__selmode.__dragging * { cursor:move !important; }
    html.__selmode ${SLIDE} .__sel i { cursor:inherit; }
    .__editing { outline:calc(2px*var(--pindeck-u,1)) solid #1a73e8 !important; outline-offset:calc(3px*var(--pindeck-u,1));
      background:rgba(26,115,232,.04); cursor:text !important; caret-color:#1a73e8; }
    .__editing * { cursor:text !important; }
    .__hidden-banner { position:absolute; z-index:997; top:calc(26px*var(--pindeck-u,1)); right:calc(26px*var(--pindeck-u,1)); pointer-events:none;
      background:#ED8C01; color:#fff; font:600 calc(12px*var(--pindeck-u,1))/calc(22px*var(--pindeck-u,1)) system-ui, sans-serif;
      padding:0 calc(10px*var(--pindeck-u,1)); border-radius:calc(11px*var(--pindeck-u,1)); box-shadow:0 calc(2px*var(--pindeck-u,1)) calc(8px*var(--pindeck-u,1)) rgba(0,0,0,.25); }
    .__edit-hint { position:absolute; z-index:1003; pointer-events:none; white-space:nowrap; background:#1a73e8; color:#fff;
      font:600 calc(11px*var(--pindeck-u,1))/calc(17px*var(--pindeck-u,1)) system-ui, sans-serif; padding:0 calc(5px*var(--pindeck-u,1));
      border-radius:calc(3px*var(--pindeck-u,1)); }`;
  document.head.appendChild(css);

  /* ---- Geometry ------------------------------------------------------------------ */
  const slides = () => deck.slides();
  const indexOf = (sec) => slides().indexOf(sec);
  const r1 = (v) => Math.round(v);
  function frame(sec) {
    const r = sec.getBoundingClientRect();
    return { r, s: r.width / W || 1 };
  }
  function boxOf(el, sec) {
    const { r, s } = frame(sec);
    const b = el.getBoundingClientRect();
    return { x: r1((b.left - r.left) / s), y: r1((b.top - r.top) / s), w: r1(b.width / s), h: r1(b.height / s) };
  }
  const byEid = (eid, root = document) => root.querySelector(`[data-eid="${CSS.escape(eid)}"]`);

  /* Visible text of an element, without KaTeX's hidden MathML copy. */
  function textOf(el, ownOnly) {
    if (el.tagName === "IMG") return el.getAttribute("alt") || (el.getAttribute("src") || "").split("/").pop();
    let out = "";
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(n) {
        const p = n.parentElement;
        if (!p || p.closest(".katex-mathml, .__pin, .__hover, .__flash, .__sel, .__guide, .__edit-hint, .__hidden-banner, aside.notes, script, style")) return NodeFilter.FILTER_REJECT;
        if (ownOnly) { const owner = p.closest("[data-eid]"); if (owner !== el) return NodeFilter.FILTER_REJECT; }
        return NodeFilter.FILTER_ACCEPT;
      },
    });
    while (walker.nextNode()) {
      const n = walker.currentNode;
      out += n.nodeValue + (n.parentElement.closest(".katex") ? "" : " "); // KaTeX splits math into one span per glyph
    }
    return out.replace(/\u200b/g, "").replace(/\s+/g, " ").trim();
  }
  function fontOf(el) {
    const cs = getComputedStyle(el);
    return `${Math.round(parseFloat(cs.fontSize))}px${+cs.fontWeight >= 600 ? " bold" : ""}`;
  }
  function slideInfo(sec, i = indexOf(sec)) {
    const head = sec.querySelector("h1, h2, h3");
    let title = "", sub = "";
    if (head) {
      const subEl = head.querySelector(".sub");
      sub = subEl ? textOf(subEl) : "";
      title = textOf(head);
      if (sub && title.endsWith(sub)) title = title.slice(0, -sub.length).trim();
    }
    const kind = [...sec.classList].find((c) => /-slide$/.test(c)) || "content";
    const hidden = sec.getAttribute("data-visibility") === "hidden";
    return { index: i, eid: sec.dataset.eid || `#${i + 1}`, title: title || sec.dataset.eid || `Slide ${i + 1}`, sub, kind,
      hasFooter: !!sec.querySelector(".slide-foot"), hidden };
  }
  function info() {
    return { slides: slides().map((s, i) => slideInfo(s, i)), current: indexOf(deck.current()) };
  }

  /* ---- Layout measurement ------------------------------------------------------------- */
  function measureSection(sec) {
    const si = slideInfo(sec);
    const els = [sec, ...sec.querySelectorAll("[data-eid]")];
    const elements = [], meta = [];
    for (const el of els) {
      const cs = getComputedStyle(el);
      const b = boxOf(el, sec);
      let depth = 0;
      for (let p = el.parentElement; p && p !== sec.parentElement; p = p.parentElement) if (p.dataset?.eid) depth++;
      const hidden = cs.display === "none" || cs.visibility === "hidden" || +cs.opacity === 0 || (b.w === 0 && b.h === 0);
      const leaf = !el.querySelector("[data-eid]");
      const own = el === sec ? "" : textOf(el, !leaf);
      const tag = el.tagName.toLowerCase() + (el.classList.length ? "." + [...el.classList].filter((c) => !/^(fragment|visible|current-fragment|present|past|future)$/.test(c) && !c.startsWith("__")).join(".") : "");
      const e = { eid: el.dataset.eid || si.eid, tag: tag.replace(/\.$/, ""), depth, ...b };
      if (own && el.tagName !== "IMG" && el !== sec) e.font = fontOf(el);
      if (own) e.text = own;
      if (hidden) e.hidden = true;
      if (el !== sec && el.matches(LOCKED_SEL)) e.locked = true;
      elements.push(e);
      meta.push({ el, e, hidden, cs, inSvg: !!el.closest("svg") && el.tagName.toLowerCase() !== "svg" });
    }

    /* What an element draws, for the checks below: a plain container (no text of its own, no
       background, border or shadow) draws only its children, so the empty part of a box stretched by
       flex or a fixed height (a slide-body filling the slide down to the references, say) does not
       count as an overlap. The layout listing keeps the real boxes. */
    const MEDIA = /^(IMG|SVG|VIDEO|AUDIO|CANVAS|IFRAME|OBJECT|TABLE|PICTURE)$/i;
    const paints = (cs) => cs.backgroundImage !== "none" || !/^(transparent|rgba\(.*,\s*0\))$/.test(cs.backgroundColor) ||
      cs.boxShadow !== "none" || ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== "none");
    const drawn = new Map();   // el -> { x, y, w, h }
    for (const { el, e, hidden, cs } of [...meta].reverse()) {   // children before their parents
      if (hidden) continue;
      const box = { x: e.x, y: e.y, w: e.w, h: e.h };
      if (el !== sec && !textOf(el, true) && !MEDIA.test(el.tagName) && !paints(cs)) {
        const kids = meta.filter((m) => drawn.has(m.el) && m.el.parentElement?.closest("[data-eid]") === el).map((m) => drawn.get(m.el));
        if (kids.length) {
          const x0 = Math.min(...kids.map((k) => k.x)), y0 = Math.min(...kids.map((k) => k.y));
          const x1 = Math.max(...kids.map((k) => k.x + k.w)), y1 = Math.max(...kids.map((k) => k.y + k.h));
          Object.assign(box, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
        }
      }
      drawn.set(el, box);
    }

    const issues = [];
    const rel = (eid) => (eid.startsWith(si.eid + "/") ? eid.slice(si.eid.length) : eid);
    const flagged = new Set();
    const underFlagged = (el) => { for (let p = el.parentElement; p; p = p.parentElement) if (flagged.has(p)) return true; return false; };
    for (const { el, e, hidden, cs } of meta) {
      if (el === sec || hidden || e.locked) continue;
      const d = drawn.get(el);
      if (d.x < -1 || d.y < -1 || d.x + d.w > W + 1 || d.y + d.h > H + 1) {
        if (!underFlagged(el)) issues.push(`${rel(e.eid)} extends outside the slide (box x=${d.x}..${d.x + d.w}, y=${d.y}..${d.y + d.h})`);
        flagged.add(el);
      } else if (si.hasFooter && FOOTER_TOP != null && d.y + d.h > FOOTER_TOP + 1 && d.y < H) {
        if (!underFlagged(el)) issues.push(`${rel(e.eid)} reaches y=${d.y + d.h}, below the footer rule (y=${FOOTER_TOP})`);
        flagged.add(el);
      }
      const clips = /(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY);
      if (clips && (el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2))
        issues.push(`${rel(e.eid)} clips its content (${Math.max(el.scrollHeight - el.clientHeight, el.scrollWidth - el.clientWidth)} px hidden)`);
    }
    // Overlaps between elements that are not nested in each other (SVG groups excluded: they overlap by design)
    const cand = meta.filter((m) => m.el !== sec && !m.hidden && !m.e.locked && !m.inSvg && m.e.w * m.e.h > 0)
      .map((m) => ({ ...m, e: { ...m.e, ...drawn.get(m.el) } }));   // the overlap test uses what each element draws
    let overlaps = 0;
    const reported = [];   // [el, el] pairs already reported
    for (let i = 0; i < cand.length && overlaps < 8; i++) {
      for (let j = i + 1; j < cand.length && overlaps < 8; j++) {
        const a = cand[i], b = cand[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const ix = Math.min(a.e.x + a.e.w, b.e.x + b.e.w) - Math.max(a.e.x, b.e.x);
        const iy = Math.min(a.e.y + a.e.h, b.e.y + b.e.h) - Math.max(a.e.y, b.e.y);
        if (ix <= 0 || iy <= 0) continue;
        const area = ix * iy, small = Math.min(a.e.w * a.e.h, b.e.w * b.e.h);
        if (area < 100 || area < 0.05 * small) continue;
        // skip pairs whose ancestors already overlap (report the outermost pair only)
        const pa = a.el.parentElement?.closest("[data-eid]"), pb = b.el.parentElement?.closest("[data-eid]");
        if (pa && pb && pa !== pb && !pa.contains(pb) && !pb.contains(pa) && pa !== sec && pb !== sec) continue;
        // ... and pairs inside a reported pair (the bullets of a slide-body that overlaps the references)
        if (reported.some(([p, q]) => (p.contains(a.el) && q.contains(b.el)) || (p.contains(b.el) && q.contains(a.el)))) continue;
        reported.push([a.el, b.el]);
        issues.push(`${rel(a.e.eid)} overlaps ${rel(b.e.eid)} (${ix} x ${iy} px)`);
        overlaps++;
      }
    }
    return { slide: si, width: W, height: H, footerTop: FOOTER_TOP, elements, issues };
  }
  // Layout is computed synchronously on read, so no timer is needed (timers are throttled in background tabs).
  const nextFrame = () => Promise.resolve();

  /* ---- Navigation ------------------------------------------------------------------------ */
  const goto = (index) => deck.goto(index);
  const presentHash = (index) => deck.hash(index);   // the slide's address in the deck opened on its own

  /* ---- Pins and hover ---------------------------------------------------------------------- */
  let mode = "select", pins = [], editable = true;   // mode: "select" (drag, resize) or "pin"
  const tagOf = (el) => el.tagName.toLowerCase() + (el.classList.length ? "." + [...el.classList].filter((c) => !c.startsWith("__")).join(".") : "");
  function wordAt(x, y, el) {
    let node, offset;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; offset = p.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    }
    if (!node || node.nodeType !== 3 || !el.contains(node) || node.parentElement.closest(".katex-mathml")) return null;
    const s = node.nodeValue;
    const isW = (c) => /[\p{L}\p{N}_\-.,%×]/u.test(c);
    let a = offset, b = offset;
    while (a > 0 && isW(s[a - 1])) a--;
    while (b < s.length && isW(s[b])) b++;
    const w = s.slice(a, b).replace(/[.,]+$/, "");
    return w || null;
  }
  function targetOf(t) {
    if (!t || !t.closest) return null;
    const sec = t.closest(SLIDE);
    if (!sec || t.closest(".__pin, .__hover, .__sel, .__guide")) return null;
    const foot = t.closest(".slide-foot");
    const el = foot ? sec : t.closest("[data-eid]") || sec;
    const locked = foot ? "footer, set by brand.css (locked)" : el !== sec && el.matches(LOCKED_SEL) ? "positioned by brand.css (locked)" : null;
    return { sec: el === sec ? sec : el.closest(SLIDE_OF), el, locked, foot };
  }
  function onPointerDown(e) {
    if (MODE !== "main" || e.button !== 0) return;
    if (mode === "select") return selectPointerDown(e);
    e.preventDefault(); e.stopPropagation();
  }
  function onClick(e) {
    if (MODE !== "main") return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    if (mode !== "pin") return;
    const marker = e.target.closest?.(".__pin");
    if (marker) { host()?.removePin(+marker.dataset.n); return; }
    const t = targetOf(e.target);
    if (!t) return;
    const { r, s } = frame(t.sec);
    const point = { x: r1((e.clientX - r.left) / s), y: r1((e.clientY - r.top) / s) };
    const box = t.foot ? boxOf(t.foot, t.sec) : boxOf(t.el, t.sec);
    const at = { fx: box.w ? Math.min(1, Math.max(0, (point.x - box.x) / box.w)) : 0.5, fy: box.h ? Math.min(1, Math.max(0, (point.y - box.y) / box.h)) : 0.5 };
    const cellEl = e.target.closest?.("td, th");
    const textEl = e.target.nodeType === 1 && e.target.closest(".__pin") == null ? e.target : t.el;
    const pin = {
      slide: slideInfo(t.sec), eid: t.el.dataset.eid || slideInfo(t.sec).eid,
      tag: t.foot ? "footer.slide-foot" : tagOf(t.el),
      text: textOf(t.foot || t.el).slice(0, 200), box, point, at,
      word: wordAt(e.clientX, e.clientY, t.foot || t.el), font: fontOf(textEl),
      cell: cellEl ? { row: cellEl.parentElement.rowIndex, col: cellEl.cellIndex, text: textOf(cellEl) } : null,
      locked: t.locked,
    };
    host()?.addPin(pin);
  }
  let hoverBox = null;
  function onMove(e) {
    if (MODE !== "main" || drag || editing) return hideHover();
    if (mode === "select") return selectHover(e);
    const t = targetOf(e.target);
    if (!t) return hideHover();
    if (!hoverBox) { hoverBox = document.createElement("div"); hoverBox.className = "__hover"; hoverBox.appendChild(document.createElement("span")); }
    const target = t.foot || t.el;
    const b = boxOf(target, t.sec);
    if (hoverBox.parentElement !== t.sec) t.sec.appendChild(hoverBox);
    Object.assign(hoverBox.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
    hoverBox.classList.toggle("locked", !!t.locked);
    hoverBox.classList.remove("sel");
    const eid = t.foot ? "footer (locked)" : t.el.dataset.eid || "";
    hoverBox.firstChild.textContent = (t.el === t.sec && !t.foot ? "slide " : "") + eid.replace(/^[^/]+\//, "/") + (t.locked && !t.foot ? " (locked)" : "");
    hoverBox.firstChild.className = b.y < 30 ? "below" : "above";
  }
  function hideHover() { hoverBox?.remove(); }

  function renderPins(list) {
    pins = list || [];
    document.querySelectorAll(".__pin").forEach((p) => p.remove());
    for (const p of pins) {
      const sec = byEid(p.slide.eid);
      if (!sec || !sec.matches(SLIDE_OF)) continue;
      let x = p.point.x, y = p.point.y;
      const el = p.eid !== p.slide.eid ? byEid(p.eid, sec) : null;
      if (el && el.getClientRects().length) {
        const b = boxOf(el, sec);
        x = b.x + p.at.fx * b.w; y = b.y + p.at.fy * b.h;
      }
      const m = document.createElement("div");
      m.className = "__pin";
      m.dataset.n = p.n;
      m.textContent = p.n;
      m.title = "Click to remove pin " + p.n;
      Object.assign(m.style, { left: x + "px", top: y + "px" });
      sec.appendChild(m);
    }
  }
  function highlight(eid) {
    const el = byEid(eid);
    if (!el) return;
    const sec = el.closest(SLIDE_OF);
    if (sec !== deck.current()) return;
    const b = boxOf(el, sec);
    const f = document.createElement("div");
    f.className = "__flash";
    Object.assign(f.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
    sec.appendChild(f);
    setTimeout(() => f.remove(), 1500);
  }

  /* ---- Select, drag and resize --------------------------------------------------------------------
     Moves are stored as the CSS `translate` property and sizes as width/height, inline on the element.
     `translate` works the same for elements in the flow and absolutely positioned ones, and leaves the
     layout around the element alone. The host writes the change into index.html. */
  let sel = null, selBox = null, drag = null;
  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const KEEP_ASPECT = new Set(["img", "svg", "video", "canvas", "iframe"]);

  function selectableOf(t) {
    const tt = targetOf(t);
    if (!tt) return null;
    if (tt.foot || tt.locked) return { locked: tt.locked || "footer, set by brand.css (locked)", el: tt.foot || tt.el, sec: tt.sec };
    let el = tt.el;
    const svg = el.closest("svg");
    if (svg && svg !== el && svg.dataset.eid) el = svg;   // parts of an inline SVG move with the SVG
    // inline boxes cannot be translated or sized: take the nearest block with an id
    while (el && el !== tt.sec && getComputedStyle(el).display === "inline") el = el.parentElement.closest("[data-eid]");
    if (!el || el === tt.sec) return null;
    return { el, sec: tt.sec };
  }
  function translateOf(el) {
    const v = getComputedStyle(el).translate;
    if (!v || v === "none") return [0, 0];
    const [x = "0", y = "0"] = v.split(/\s+/);
    return [parseFloat(x) || 0, parseFloat(y) || 0];
  }
  const fmtTranslate = (x, y) => (r1(x) || r1(y) ? `${r1(x)}px ${r1(y)}px` : "");
  const nameOf = (el, sec) => { const e = el.dataset.eid || ""; return e.startsWith(sec.dataset.eid + "/") ? e.slice(sec.dataset.eid.length) : e; };

  function drawSel() {
    if (!sel || !sel.el.isConnected) return removeSel();
    if (editing) return;
    if (!selBox) {
      selBox = document.createElement("div");
      selBox.className = "__sel";
      selBox.innerHTML = '<span class="__sel-label"></span>' + HANDLES.map((h) => `<i data-h="${h}"></i>`).join("");
    }
    if (selBox.parentElement !== sel.sec) sel.sec.appendChild(selBox);
    const b = boxOf(sel.el, sel.sec);
    Object.assign(selBox.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
    selBox.classList.toggle("readonly", !editable);
    const lab = selBox.firstChild;
    lab.textContent = `${nameOf(sel.el, sel.sec)}   ` + (drag?.kind === "move" ? `x ${b.x}  y ${b.y}` : `${b.w} × ${b.h}`);
    lab.className = "__sel-label " + (b.y < 30 ? "below" : "above");
  }
  function removeSel() { selBox?.remove(); document.querySelectorAll(".__selected").forEach((e) => e.classList.remove("__selected")); }
  function select(el, sec, notify = true) {
    removeSel();
    sel = el ? { el, sec } : null;
    if (sel) { sel.el.classList.add("__selected"); drawSel(); }
    if (notify) host()?.selectionChanged(sel ? selectionInfo() : null);
  }
  function selectionInfo() {
    const { el, sec } = sel;
    return { eid: el.dataset.eid, slide: slideInfo(sec), tag: tagOf(el), box: boxOf(el, sec), text: textOf(el).slice(0, 120) };
  }
  function selectEid(eid) {
    const el = eid && byEid(eid);
    const sec = el?.closest(SLIDE_OF);
    if (!el || sec !== deck.current()) return select(null, null);
    select(el, sec);
  }

  function selectHover(e) {
    const t = selectableOf(e.target);
    if (!t || (sel && t.el === sel.el)) return hideHover();
    if (!hoverBox) { hoverBox = document.createElement("div"); hoverBox.className = "__hover"; hoverBox.appendChild(document.createElement("span")); }
    const b = boxOf(t.el, t.sec);
    if (hoverBox.parentElement !== t.sec) t.sec.appendChild(hoverBox);
    Object.assign(hoverBox.style, { left: b.x + "px", top: b.y + "px", width: b.w + "px", height: b.h + "px" });
    hoverBox.classList.toggle("locked", !!t.locked);
    hoverBox.classList.toggle("sel", !t.locked);
    hoverBox.firstChild.textContent = t.locked ? (t.el.classList.contains("slide-foot") ? "footer (locked)" : nameOf(t.el, t.sec) + " (locked)") : nameOf(t.el, t.sec);
    hoverBox.firstChild.className = b.y < 30 ? "below" : "above";
  }

  /* Snap targets: slide edges and centre, the footer rule, and the edges and centres of other elements */
  function snapTargets(sec, el) {
    const xs = [0, W / 2, W], ys = [0, H / 2, H];
    if (FOOTER_TOP != null && sec.querySelector(".slide-foot")) ys.push(FOOTER_TOP);
    for (const o of sec.querySelectorAll("[data-eid]")) {
      if (o === el || el.contains(o) || o.contains(el)) continue;
      if (o.closest("svg") && o.tagName.toLowerCase() !== "svg") continue;
      if (!o.getClientRects().length) continue;
      const b = boxOf(o, sec);
      if (!b.w || !b.h) continue;
      xs.push(b.x, b.x + b.w / 2, b.x + b.w);
      ys.push(b.y, b.y + b.h / 2, b.y + b.h);
    }
    return { xs, ys };
  }
  function snapTo(values, targets, tol) {
    let best = null;
    for (const v of values) for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: t };
    }
    return best;
  }
  function showGuides(sec, xs, ys) {
    clearGuides();
    for (const [list, cls, prop] of [[xs, "v", "left"], [ys, "h", "top"]]) {
      for (const v of new Set(list.map(Math.round))) {
        const g = document.createElement("div");
        g.className = "__guide " + cls;
        g.style[prop] = v + "px";
        sec.appendChild(g);
      }
    }
  }
  function clearGuides() { document.querySelectorAll(".__guide").forEach((g) => g.remove()); }

  let lastDown = { t: 0, x: 0, y: 0, el: null };
  function selectPointerDown(e) {
    if (editing) {
      if (editing.el.contains(e.target)) return;   // let the browser place the caret
      finishEdit(true);
    }
    e.preventDefault(); e.stopPropagation();
    hideHover();
    // double click: edit the text under the pointer
    const now = performance.now();
    const dbl = now - lastDown.t < 450 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 6 && lastDown.el === e.target;
    lastDown = { t: dbl ? 0 : now, x: e.clientX, y: e.clientY, el: e.target };
    if (dbl && !e.target.closest?.(".__sel i")) return editAt(e.target, e.clientX, e.clientY);
    const handle = e.target.closest?.(".__sel i[data-h]");
    if (!handle) {
      if (e.target.closest?.(".__pin")) return;   // pin markers are removed in pin mode only
      const t = selectableOf(e.target);
      if (!t) return select(null, null);
      if (t.locked) {
        select(null, null);
        host()?.toast(`${t.el.classList.contains("slide-foot") ? "The footer is" : "This element is"} set by brand.css and locked.`);
        return;
      }
      if (!sel || sel.el !== t.el) select(t.el, t.sec);
    }
    if (!editable) { if (handle) host()?.toast("Claude is working. Moving and resizing resume when it has finished."); return; }
    const el = sel.el, cs = getComputedStyle(el);
    const { s } = frame(sel.sec);
    const [tx, ty] = translateOf(el);
    drag = {
      kind: handle ? "resize" : "move", handle: handle?.dataset.h, x0: e.clientX, y0: e.clientY, s, started: !!handle,
      b: boxOf(el, sel.sec), tx, ty, cw: parseFloat(cs.width) || 0, ch: parseFloat(cs.height) || 0,
      maxW: cs.maxWidth, maxH: cs.maxHeight, targets: snapTargets(sel.sec, el),
      before: { translate: el.style.translate, width: el.style.width, height: el.style.height, "max-width": el.style.maxWidth, "max-height": el.style.maxHeight },
    };
    document.documentElement.setPointerCapture?.(e.pointerId);
  }
  function onDragMove(e) {
    if (!drag || !sel) return;
    let dx = (e.clientX - drag.x0) / drag.s, dy = (e.clientY - drag.y0) / drag.s;
    if (!drag.started) {
      if (Math.hypot(dx * drag.s, dy * drag.s) < 4) return;
      drag.started = true;
      document.documentElement.classList.add("__dragging");
    }
    e.preventDefault();
    const tol = 6 / drag.s, snap = !e.altKey, { b, targets } = drag, el = sel.el;
    const gx = [], gy = [];
    if (drag.kind === "move") {
      if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      if (snap && !(e.shiftKey && dx === 0)) {
        const sx = snapTo([b.x + dx, b.x + dx + b.w / 2, b.x + dx + b.w], targets.xs, tol);
        if (sx) { dx += sx.d; gx.push(sx.at); }
      }
      if (snap && !(e.shiftKey && dy === 0)) {
        const sy = snapTo([b.y + dy, b.y + dy + b.h / 2, b.y + dy + b.h], targets.ys, tol);
        if (sy) { dy += sy.d; gy.push(sy.at); }
      }
      el.style.translate = fmtTranslate(drag.tx + dx, drag.ty + dy);
      drag.label = `Moved ${nameOf(el, sel.sec)} by ${r1(dx)}, ${r1(dy)} px`;
    } else {
      const h = drag.handle;
      let w = b.w, ht = b.h, ox = 0, oy = 0;   // ox/oy: how far the left/top edge moves
      if (h.includes("e")) w = b.w + dx;
      if (h.includes("w")) { w = b.w - dx; ox = dx; }
      if (h.includes("s")) ht = b.h + dy;
      if (h.includes("n")) { ht = b.h - dy; oy = dy; }
      if (snap) {
        let t;
        if (h.includes("e") && (t = snapTo([b.x + w], targets.xs, tol))) { w += t.d; gx.push(t.at); }
        if (h.includes("w") && (t = snapTo([b.x + ox], targets.xs, tol))) { ox += t.d; w -= t.d; gx.push(t.at); }
        if (h.includes("s") && (t = snapTo([b.y + ht], targets.ys, tol))) { ht += t.d; gy.push(t.at); }
        if (h.includes("n") && (t = snapTo([b.y + oy], targets.ys, tol))) { oy += t.d; ht -= t.d; gy.push(t.at); }
      }
      // images and other media keep their aspect ratio (Shift toggles)
      const keep = KEEP_ASPECT.has(el.tagName.toLowerCase()) !== e.shiftKey && b.w > 0 && b.h > 0;
      if (keep) {
        const ratio = b.w / b.h;
        const useW = h.length === 1 ? /[ew]/.test(h) : Math.abs(w / b.w - 1) >= Math.abs(ht / b.h - 1);
        if (useW) { const nh = w / ratio; if (h.includes("n")) oy += ht - nh; ht = nh; }
        else { const nw = ht * ratio; if (h.includes("w")) ox += w - nw; w = nw; }
      }
      w = Math.max(8, w); ht = Math.max(8, ht);
      const setW = keep || /[ew]/.test(h), setH = keep || /[ns]/.test(h);
      // style width/height exclude padding and border for content-box elements
      if (setW) { el.style.width = r1(w - (b.w - drag.cw)) + "px"; if (drag.maxW !== "none") el.style.maxWidth = "none"; }
      if (setH) { el.style.height = r1(ht - (b.h - drag.ch)) + "px"; if (drag.maxH !== "none") el.style.maxHeight = "none"; }
      el.style.translate = fmtTranslate(drag.tx + ox, drag.ty + oy);
      drag.label = `Resized ${nameOf(el, sel.sec)} to ${r1(w)} × ${r1(ht)} px`;
    }
    drawSel();
    showGuides(sel.sec, gx, gy);
    renderPins(pins);
  }
  function onDragEnd() {
    if (!drag) return;
    const d = drag;
    drag = null;
    document.documentElement.classList.remove("__dragging");
    clearGuides();
    if (!sel) return;
    drawSel();
    if (d.started) commit(d.before, d.label);
  }
  function commit(before, label) {
    const el = sel.el, set = {};
    const now = { translate: el.style.translate, width: el.style.width, height: el.style.height,
      "max-width": el.style.maxWidth, "max-height": el.style.maxHeight };
    for (const k of Object.keys(now)) if (now[k] !== before[k]) set[k] = now[k] || null;
    if (Object.keys(set).length) host()?.commitEdit({ eid: el.dataset.eid, set }, label);
    host()?.selectionChanged(selectionInfo());
  }
  function nudge(dx, dy) {
    if (!sel) return;
    if (!editable) return host()?.toast("Claude is working. Moving and resizing resume when it has finished.");
    const el = sel.el;
    const [tx, ty] = translateOf(el);
    el.style.translate = fmtTranslate(tx + dx, ty + dy);
    drawSel();
    renderPins(pins);
    host()?.commitEdit({ eid: el.dataset.eid, set: { translate: el.style.translate || null } },
      { nudge: true, name: nameOf(el, sel.sec), dx, dy });
    host()?.selectionChanged(selectionInfo());
  }
  function setMode(m) {
    if (editing) finishEdit(true);
    mode = m;
    document.documentElement.classList.toggle("__pinmode", mode === "pin");
    document.documentElement.classList.toggle("__selmode", mode === "select");
    hideHover();
    if (mode !== "select" && sel) select(null, null);
  }

  /* ---- Text editing ------------------------------------------------------------------------------
     Double-click (or Enter on a selection) edits the element in place. While editing, the element
     shows its source HTML, so math appears as TeX (\( ... \)) and is saved exactly as typed.
     Enter or a click elsewhere saves, Esc cancels, Shift+Enter adds a line break, ⌘B / ⌘I format.
     In a bullet, Enter splits it at the caret and continues in a new bullet; Enter on an empty new
     bullet removes it and stops. */
  let editing = null, chainDirty = false;   // chainDirty: bullets were split; re-render when editing stops
  const TEXT_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "dt", "dd", "td", "th", "caption",
    "figcaption", "blockquote", "pre", "button", "span", "small", "label"]);
  const hasOwnText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
  const isTextual = (el) => TEXT_TAGS.has(el.tagName.toLowerCase()) || hasOwnText(el) || !!el.querySelector(".katex");

  /* What a double-click on t would edit: the element with an id around it, or a table cell. */
  function textTargetOf(t) {
    // KaTeX draws roots, wide accents and arrows as SVG: those belong to the equation, not to a diagram
    if (t.closest?.("svg") && !t.closest(".katex")) return { why: "Text inside a diagram cannot be edited here yet. Pin it and ask Claude." };
    const tt = targetOf(t);
    if (!tt) return null;
    if (tt.foot || tt.locked) return { why: `${tt.foot ? "The footer is" : "This element is"} set by brand.css and locked.` };
    const cell = t.closest?.("td, th");
    if (cell && cell.parentElement?.dataset.eid && tt.sec.contains(cell))
      return { el: cell, sec: tt.sec, eid: cell.parentElement.dataset.eid, path: [cell.cellIndex] };
    const el = tt.el;
    if (el === tt.sec) return null;
    if (!isTextual(el)) return { why: "Double-click directly on the text you want to edit." };
    return { el, sec: tt.sec, eid: el.dataset.eid, path: [] };
  }
  function editAt(target, x, y) {
    const t = textTargetOf(target);
    if (!t) return;
    if (t.why) return host()?.toast(t.why);
    // a double-click on an equation opens the text with that equation's TeX selected
    const k = target.closest?.(".katex");
    const math = k && t.el.contains(k) ? [...t.el.querySelectorAll(".katex")].indexOf(k) : -1;
    startEdit(t, x, y, math >= 0 ? { math } : {});
  }
  function editSelection(opts) {
    if (!sel) return false;
    const t = textTargetOf(sel.el);
    if (!t) return false;
    if (t.why) { host()?.toast(t.why); return true; }
    startEdit(t, null, null, opts);
    return true;
  }

  async function startEdit(t, x, y, opts = {}) {
    if (!editable) return host()?.toast("Claude is working. Editing resumes when it has finished.");
    if (editing) await finishEdit(true);
    const src = opts.src ?? await host()?.textSource(t.eid, t.path);
    if (src == null || !t.el.isConnected) return;
    const el = t.el;
    if (!sel || sel.el !== el) select(el.dataset.eid ? el : null, t.sec);
    removeSel();
    hideHover();
    editing = { ...t, rendered: el.innerHTML };
    el.innerHTML = src;
    editing.baseline = el.innerHTML;
    if (!el.textContent.trim() && !el.querySelector("img, svg, br")) el.appendChild(document.createElement("br"));   // room for the caret
    editing.orig = new WeakSet(el.querySelectorAll("*"));
    el.contentEditable = "true";
    el.spellcheck = true;
    el.classList.add("__editing");
    try { document.execCommand("styleWithCSS", false, false); } catch {}
    el.addEventListener("keydown", onEditKey);
    el.addEventListener("paste", onEditPaste);
    el.addEventListener("blur", onEditBlur);
    el.focus({ preventScroll: true });
    if (!(opts.math >= 0 && selectMath(el, opts.math))) placeCaret(el, x, y, opts.caret);
    showEditHint(true);
    host()?.editingChanged(true);
  }
  /* Selects the TeX between the delimiters of the n-th equation (\( \) or \[ \]) in the source shown */
  function selectMath(el, n) {
    const nodes = [], w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let text = "";
    for (let node; (node = w.nextNode());) { nodes.push({ node, at: text.length }); text += node.nodeValue; }
    const m = [...text.matchAll(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g)][n];
    if (!m) return false;
    const where = (i) => { const hit = nodes.findLast((x) => x.at <= i); return [hit.node, i - hit.at]; };
    const tex = m[1] ?? m[2], lead = tex.length - tex.trimStart().length;
    const start = m.index + 2 + lead, end = m.index + 2 + tex.trimEnd().length;
    const r = document.createRange();
    r.setStart(...where(start));
    r.setEnd(...where(end));
    const s = getSelection();
    s.removeAllRanges();
    s.addRange(r);
    return true;
  }
  function placeCaret(el, x, y, where) {
    const s = getSelection();
    let r = null;
    if (x != null) {
      if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
      else if (document.caretPositionFromPoint) {
        const p = document.caretPositionFromPoint(x, y);
        if (p) { r = document.createRange(); r.setStart(p.offsetNode, p.offset); }
      }
    }
    if (where === "placeholder") {   // select the first piece of text, so typing replaces it
      const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeValue.trim() ? 1 : 3) });
      const first = w.nextNode();
      if (first) { r = document.createRange(); r.selectNodeContents(first); }
    }
    if (!r || !el.contains(r.startContainer)) { r = document.createRange(); r.selectNodeContents(el); r.collapse(where === "start"); }
    s.removeAllRanges();
    s.addRange(r);
  }
  function showEditHint(on) {
    document.querySelectorAll(".__edit-hint").forEach((h) => h.remove());
    if (!on || !editing) return;
    const b = boxOf(editing.el, editing.sec);
    const h = document.createElement("div");
    h.className = "__edit-hint";
    h.textContent = "Editing · Enter to save · Esc to cancel · Shift+Enter new line";
    Object.assign(h.style, b.y < 30 ? { left: b.x + "px", top: `calc(${b.y + b.h}px + 6px*var(--pindeck-u,1))` }
      : { left: b.x + "px", top: `calc(${b.y}px - 22px*var(--pindeck-u,1))` });
    editing.sec.appendChild(h);
  }
  function onEditKey(e) {
    e.stopPropagation();   // keep Reveal and the editor shortcuts out of typing
    if (e.key === "Escape") { e.preventDefault(); finishEdit(false); }
    else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (editing?.el.tagName === "LI" && !editing.path.length) splitBullet(); else finishEdit(true);
    }
    else if (e.key === "Enter") { e.preventDefault(); document.execCommand("insertLineBreak"); }
  }
  function onEditPaste(e) {
    e.preventDefault();   // plain text only: no fonts or colours from elsewhere
    const text = e.clipboardData?.getData("text/plain") || "";
    document.execCommand("insertText", false, text.replace(/\s*\n\s*/g, " "));
  }
  function onEditBlur() { if (editing) finishEdit(true); }

  /* The browser's editing adds <b>/<i>, styled spans and stray <br>s; turn them into clean HTML. */
  function cleanEdited(el, orig) {
    const rename = (node, tag) => {
      const n = document.createElement(tag);
      while (node.firstChild) n.appendChild(node.firstChild);
      node.replaceWith(n);
    };
    const unwrap = (node) => node.replaceWith(...node.childNodes);
    for (const n of [...el.querySelectorAll("*")]) {
      if (orig.has(n)) continue;
      const tag = n.tagName.toLowerCase();
      if (tag === "b") rename(n, "strong");
      else if (tag === "i") rename(n, "em");
      else if (tag === "font" || (tag === "span" && !n.className && !n.dataset.eid)) unwrap(n);
      else n.removeAttribute("style");
    }
    while (el.lastChild && el.lastChild.nodeName === "BR" && !orig.has(el.lastChild)) el.lastChild.remove();
    el.normalize();
    return el.innerHTML.replace(/\u00a0/g, "&nbsp;");
  }
  function teardownEdit(ed) {
    const el = ed.el;
    el.removeEventListener("keydown", onEditKey);
    el.removeEventListener("paste", onEditPaste);
    el.removeEventListener("blur", onEditBlur);
    el.removeAttribute("contenteditable");
    el.removeAttribute("spellcheck");
    el.classList.remove("__editing");
    showEditHint(false);
  }
  const isBlank = (el) => !el.textContent.trim() && !el.querySelector("img, svg, video, canvas");

  async function finishEdit(save) {
    if (!editing) return;
    const ed = editing;
    editing = null;
    const el = ed.el;
    el.removeEventListener("blur", onEditBlur);   // removing the element below would blur it again
    teardownEdit(ed);
    getSelection().removeAllRanges();
    host()?.editingChanged(false);
    const eid = ed.path.length ? ed.eid : el.dataset.eid || ed.eid;
    if (!save) el.innerHTML = ed.rendered;   // Esc: back to the content before this edit
    // a new bullet left empty is removed again
    if (ed.isNew && isBlank(el)) {
      el.remove();
      if (sel?.el === el) select(null, null);
      host()?.commitRemove(eid);
      chainDirty = false;
      return;
    }
    const html = save ? cleanEdited(el, ed.orig) : null;
    if (!save || html === ed.baseline) {
      el.innerHTML = ed.rendered;   // back to the rendered version (math as KaTeX)
      if (chainDirty) { chainDirty = false; host()?.refresh(); }
      else if (sel) drawSel();
      return;
    }
    chainDirty = false;
    const label = `Edited text of ${ed.path.length ? `${nameOf(el.parentElement, ed.sec)} cell ${ed.path[0] + 1}` : nameOf(el, ed.sec)}`;
    host()?.commitText({ eid, path: ed.path, html, label, text: textOf(el).slice(0, 300) });
  }

  /* A free id for a new bullet on the same slide ("summary/li-4"); the server double-checks. */
  function newBulletEid(el) {
    const prefix = el.closest(SLIDE_OF).dataset.eid;
    const used = new Set([...document.querySelectorAll("[data-eid]")].map((e) => e.dataset.eid));
    let id = `${prefix}/li`, k = 2;
    while (used.has(id)) id = `${prefix}/li-${k++}`;
    return id;
  }
  function splitBullet() {
    const ed = editing, el = ed.el, s = getSelection();
    if (!s.rangeCount) return finishEdit(true);
    const r = s.getRangeAt(0);
    if (!r.collapsed) r.deleteContents();
    if (ed.isNew && isBlank(el)) return finishEdit(true);   // Enter on an empty new bullet: done
    // everything from the caret to the end of this bullet's own text (a sub-list stays where it is)
    const tail = document.createRange();
    tail.setStart(r.startContainer, r.startOffset);
    const subList = [...el.children].find((c) => c.tagName === "UL" || c.tagName === "OL");
    if (subList) tail.setEndBefore(subList); else tail.setEnd(el, el.childNodes.length);
    const frag = tail.extractContents();
    const li = document.createElement("li");
    const cls = [...el.classList].filter((c) => !c.startsWith("__") && c !== "visible" && c !== "current-fragment").join(" ");
    if (cls) li.className = cls;
    li.appendChild(frag);
    el.after(li);
    // no stray spaces at the split
    const trim = (node, end) => {
      const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const all = [];
      while (w.nextNode()) all.push(w.currentNode);
      const t = end ? all.at(-1) : all[0];
      if (t) t.nodeValue = end ? t.nodeValue.replace(/\s+$/, "") : t.nodeValue.replace(/^\s+/, "");
    };
    if (!subList) trim(el, true);
    trim(li, false);
    const html = cleanEdited(el, ed.orig);
    const newHtml = cleanEdited(li, ed.orig);
    const newEid = newBulletEid(el);
    li.dataset.eid = newEid;
    editing = null;
    teardownEdit(ed);
    host()?.editingChanged(false);
    chainDirty = true;
    host()?.commitSplit({ eid: ed.eid, html, newHtml, newEid, cls, text: textOf(el).slice(0, 200) },
      (real) => { if (real && real !== newEid) li.dataset.eid = real; });
    startEdit({ el: li, sec: ed.sec, eid: newEid, path: [], isNew: true }, null, null, { src: newHtml, caret: "start" });
  }

  /* ---- Stylesheet hot swap (no reload, no flicker) -------------------------------------------- */
  function reloadCss(files) {
    const links = [...document.querySelectorAll('link[rel="stylesheet"]')];
    return Promise.all(links.filter((l) => files.some((f) => new URL(l.href).pathname.endsWith("/" + f))).map((l) =>
      new Promise((resolve) => {
        const n = l.cloneNode();
        const u = new URL(l.href);
        u.searchParams.set("v", Date.now());
        n.href = u.href;
        n.onload = n.onerror = () => { l.remove(); resolve(); setTimeout(() => { renderPins(pins); if (sel) drawSel(); }, 0); };
        l.after(n);
      })));
  }

  /* ---- Decks -----------------------------------------------------------------------------------------
     What the editor needs from a deck: its slides, the current one, going to a slide, the slide size and
     scale, and events when the slide or the scale changes. reveal.js provides all of it. */
  function revealDeck() {
    const ix = (index) => { const sec = Reveal.getSlides()[index]; return sec ? Reveal.getIndices(sec) : { h: 0, v: 0 }; };
    return {
      slides: () => Reveal.getSlides(),
      current: () => Reveal.getCurrentSlide(),
      goto(index) { if (Reveal.getSlides()[index]) { const i = ix(index); Reveal.slide(i.h, i.v); } },
      hash(index) { const i = ix(index); return `#/${i.h}${i.v ? "/" + i.v : ""}`; },
      size: () => ({ width: Reveal.getConfig().width, height: Reveal.getConfig().height }),
      scale: () => Reveal.getScale() || 1,
      on: (ev, fn) => Reveal.on(ev === "slide" ? "slidechanged" : ev, fn),
      prepare() {   // no transitions, every build step shown; the measure and headless copies fill their frame
        const base = { transition: "none", backgroundTransition: "none", fragments: false };
        if (MODE === "main") Reveal.configure({ ...base });
        else Reveal.configure({ ...base, margin: 0, keyboard: false });
      },
      ready: (fn) => (Reveal.isReady() ? fn() : Reveal.on("ready", fn)),
      keys() {},   // reveal.js's own keyboard handling stays
    };
  }

  /* A deck made without reveal.js, whose slides <meta name="pindeck:slides"> names (and its size
     <meta name="pindeck:size">). PinDeck shows the slides itself, one at a time and scaled to the frame,
     over whatever the deck's own script does: the elements around the slides lose their transforms, a
     backdrop covers the rest of the page, and the deck's script gets no keys while the editor has them.
     The classes and styles added here live in the page only; the deck file is never written from the DOM. */
  function selectorDeck() {
    const root = document.documentElement;
    const found = () => { const all = [...document.querySelectorAll(SLIDE_SEL)]; return all.filter((s) => !all.some((o) => o !== s && s.contains(o))); };
    let list = [], cur = 0, scale = 1, sz = null;
    const listeners = { slide: [], resize: [] };
    const emit = (ev) => listeners[ev].forEach((fn) => fn());
    function mark() {   // the slides, and the elements between them and <body>
      list = found();
      for (const s of list) {
        s.classList.add("__pindeck_slide");
        for (let a = s.parentElement; a && a !== document.body && a !== root; a = a.parentElement) a.classList.add("__pindeck_anc");
      }
    }
    function size() {
      if (sz) return sz;
      mark();
      const m = /^(\d{2,5})\s*[x×*,\s]\s*(\d{2,5})$/i.exec(deckMeta("size") || "");
      const s = list[0];
      sz = m ? { width: +m[1], height: +m[2] } : s?.offsetWidth && s.offsetHeight ? { width: s.offsetWidth, height: s.offsetHeight } : { width: 1280, height: 720 };
      return sz;
    }
    // what takes a slide and its containers out of the deck's own layout (scaling, stacking, page views)
    const LOOSE = "transform:none !important; translate:none !important; scale:none !important; rotate:none !important; " +
      "zoom:1 !important; filter:none !important; backdrop-filter:none !important; perspective:none !important; " +
      "contain:none !important; will-change:auto !important; opacity:1 !important; isolation:auto !important; " +
      "mix-blend-mode:normal !important; clip-path:none !important; transition:none !important;";
    function addStyle(text) { const st = document.createElement("style"); st.textContent = text; document.head.appendChild(st); }
    function fit() {
      const { width, height } = size(), m = MODE === "main" ? 0.04 : 0;   // the margin reveal.js leaves in the editor
      scale = Math.min(innerWidth * (1 - m) / width, innerHeight * (1 - m) / height) || 1;
      root.style.setProperty("--pindeck-s", String(scale));
      root.style.setProperty("--pindeck-x", `${(innerWidth - width * scale) / 2}px`);
      root.style.setProperty("--pindeck-y", `${(innerHeight - height * scale) / 2}px`);
    }
    // a slide the deck's own CSS hides with display: none is shown as a block
    function display(s) { s.classList.remove("__pindeck_block"); if (getComputedStyle(s).display === "none") s.classList.add("__pindeck_block"); }
    function show(i) {
      const s = list[i];
      if (!s) return false;
      const changed = i !== cur;
      list[cur]?.classList.remove("__pindeck_cur");
      cur = i;
      s.classList.add("__pindeck_cur");
      s.removeAttribute("inert"); s.removeAttribute("hidden");   // the deck's script marks the slides it does not show
      display(s);
      return changed;
    }
    return {
      slides: () => list,
      current: () => list[cur],
      goto(index) { if (show(index)) emit("slide"); },
      hash(index) { const s = list[index]; return s?.id ? `#${encodeURIComponent(s.id)}` : `#${index + 1}`; },
      size,
      scale: () => scale,
      on: (ev, fn) => listeners[ev]?.push(fn),
      prepare() {
        const { width, height } = size();
        addStyle(`
          html.__pindeck_deck, html.__pindeck_deck body { overflow:hidden !important; }
          html.__pindeck_deck .__pindeck_anc { ${LOOSE} position:static !important; z-index:auto !important; }
          html.__pindeck_deck .__pindeck_slide:not(.__pindeck_cur) { visibility:hidden !important; }
          html.__pindeck_deck .__pindeck_slide.__pindeck_cur { ${LOOSE} position:fixed !important; inset:0 auto auto 0 !important;
            margin:0 !important; width:${width}px !important; height:${height}px !important; min-width:0 !important; min-height:0 !important;
            max-width:none !important; max-height:none !important; transform-origin:0 0 !important;
            transform:translate(var(--pindeck-x, 0px), var(--pindeck-y, 0px)) scale(var(--pindeck-s, 1)) !important;
            visibility:visible !important; z-index:2147483001 !important; }
          html.__pindeck_deck .__pindeck_slide.__pindeck_block { display:block !important; }
          html.__pindeck_deck .__pindeck_backdrop { position:fixed; inset:0; z-index:2147483000; background:var(--pindeck-bg, #fff); }
          html.__pindeck_deck aside.notes { display:none !important; }`);
        // the backdrop has the page's own background
        const bg = [document.body, root].map((e) => getComputedStyle(e).backgroundColor).find((c) => !/^(transparent|rgba\(.*,\s*0\))$/.test(c));
        if (bg) root.style.setProperty("--pindeck-bg", bg);
        const backdrop = document.createElement("div");
        backdrop.className = "__pindeck_backdrop";
        document.body.appendChild(backdrop);
        root.classList.add("__pindeck_deck");
        fit();
        show(cur);
        addEventListener("resize", () => { fit(); emit("resize"); });
        // the deck's script may hide the slide again (when it changes slides itself)
        new MutationObserver((recs) => { if (recs.some((r) => r.target === list[cur])) { list[cur].removeAttribute("inert"); list[cur].removeAttribute("hidden"); display(list[cur]); } })
          .observe(document.body, { subtree: true, attributes: true, attributeFilter: ["inert", "hidden", "style"] });
      },
      ready: (fn) => (document.readyState === "complete" ? fn() : addEventListener("load", () => fn(), { once: true })),
      keys() {   // after the editor's own key handler: slide keys change the slide here, and the deck's script gets none
        const field = (t) => t.closest?.("input, textarea, select, [contenteditable]");
        const STEP = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 };
        addEventListener("keydown", (e) => {
          if (field(e.target)) return;
          if (!e.metaKey && !e.ctrlKey && !e.altKey) {
            const k = e.key, step = k === " " ? (e.shiftKey ? -1 : 1) : STEP[k];
            const to = step ? cur + step : k === "Home" ? 0 : k === "End" ? list.length - 1 : null;
            if (to != null) { e.preventDefault(); this.goto(Math.max(0, Math.min(list.length - 1, to))); }
          }
          e.stopImmediatePropagation();
        }, true);
        for (const t of ["keyup", "keypress"]) addEventListener(t, (e) => { if (!field(e.target)) e.stopImmediatePropagation(); }, true);
      },
      /* ?editor=pdf: every slide as a page of its own size, for PinDeck's PDF export (lib/pdf.mjs prints
         this page's DOM as it is once laid out, so the layout is all CSS) */
      print() {
        const { width, height } = size();
        const all = params.get("showHiddenSlides") === "true";
        const shown = list.filter((s) => all || s.getAttribute("data-visibility") !== "hidden");
        for (const s of list) { s.classList.add("pdf-page"); if (!shown.includes(s)) s.classList.add("__pindeck_skip"); }
        shown.at(-1)?.classList.add("__pindeck_last");
        const OUT = ":not(.__pindeck_anc):not(.__pindeck_slide)";
        addStyle(`
          @page { size:${width}px ${height}px; margin:0; }
          html.__pindeck_print, html.__pindeck_print body { margin:0 !important; padding:0 !important; width:auto !important;
            height:auto !important; overflow:visible !important; }
          html.__pindeck_print .__pindeck_anc { ${LOOSE} position:static !important; display:block !important; width:auto !important;
            height:auto !important; margin:0 !important; padding:0 !important; border:0 !important; overflow:visible !important; }
          html.__pindeck_print body > ${OUT}:not(svg), html.__pindeck_print .__pindeck_anc > ${OUT}:not(svg) { display:none !important; }
          html.__pindeck_print body > svg${OUT}, html.__pindeck_print .__pindeck_anc > svg${OUT} { position:absolute !important;
            width:0 !important; height:0 !important; overflow:hidden !important; }
          html.__pindeck_print .__pindeck_slide { ${LOOSE} position:relative !important; inset:auto !important; margin:0 !important;
            width:${width}px !important; height:${height}px !important; max-width:none !important; max-height:none !important;
            visibility:visible !important; overflow:hidden !important; break-inside:avoid; break-after:page; page-break-after:always; }
          html.__pindeck_print .__pindeck_slide.__pindeck_last { break-after:auto; page-break-after:auto; }
          html.__pindeck_print .__pindeck_slide.__pindeck_block { display:block !important; }
          html.__pindeck_print .__pindeck_skip { display:none !important; }
          html.__pindeck_print aside.notes { display:none !important; }`);
        root.classList.add("__pindeck_print");
        shown.forEach(display);
      },
    };
  }

  /* ---- Start ------------------------------------------------------------------------------------- */
  async function start() {
    ({ width: W, height: H } = deck.size());
    const setUnit = () => document.documentElement.style.setProperty("--pindeck-u", String(1 / (deck.scale() || 1)));
    deck.on("resize", setUnit);
    deck.prepare();
    setUnit();
    await document.fonts.ready;

    if (MODE === "shot" || MODE === "dump") {
      const sec = byEid(params.get("slide") || "") || slides()[0];
      goto(indexOf(sec));
      await nextFrame();
      if (MODE === "shot") {
        try { renderPins(JSON.parse(params.get("pins") || "[]").map((p) => ({ ...p, slide: { eid: sec.dataset.eid } }))); } catch {}
      } else {
        let out;
        try { out = measureSection(sec); } catch (err) { out = { error: String(err) }; }
        const s = document.createElement("script");
        s.id = "__editor_layout"; s.type = "application/json";
        s.textContent = JSON.stringify(out).replace(/</g, "\\u003c");
        document.body.appendChild(s);
      }
      return;
    }

    const api = {
      info, goto, presentHash, highlight, reloadCss,
      setMode, selectEid, nudge, editSelection,
      // a new slide: select its title and open it for typing
      editTitle() {
        const sec = deck.current();
        const h = sec?.querySelector("h1[data-eid], h2[data-eid], h3[data-eid]");
        if (!h || mode !== "select") return;
        select(h, sec);
        editSelection({ caret: "placeholder" });
      },
      finishEdit: () => finishEdit(true),
      isEditing: () => !!editing,
      deselect() { select(null, null); },
      hasSelection: () => !!sel,
      setEditable(on) { editable = !!on; if (!editable && editing) finishEdit(true); if (sel) drawSel(); },
      renderPins,
      async measure(index) {
        goto(index);
        await nextFrame();
        return measureSection(slides()[index]);
      },
    };
    window.__editorBridge = api;

    if (MODE === "main") {
      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("click", onClick, true);
      document.addEventListener("mousemove", onMove, true);
      document.addEventListener("mouseleave", hideHover);
      // files dropped onto a slide become chat attachments, with the drop position for Claude
      const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
      document.addEventListener("dragover", (e) => { if (hasFiles(e)) { e.preventDefault(); host()?.dragOver(true); } });
      document.addEventListener("dragleave", (e) => { if (hasFiles(e) && !e.relatedTarget) host()?.dragOver(false); });
      document.addEventListener("drop", (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        host()?.dragOver(false);
        let at = null;
        const t = targetOf(document.elementFromPoint(e.clientX, e.clientY));
        if (t) {
          const { r, s } = frame(t.sec);
          at = { slide: slideInfo(t.sec), point: { x: r1((e.clientX - r.left) / s), y: r1((e.clientY - r.top) / s) },
            eid: t.el !== t.sec ? t.el.dataset.eid : null };
        }
        host()?.dropFiles(e.dataTransfer.files, at);
      });
      document.documentElement.addEventListener("pointermove", onDragMove);
      document.documentElement.addEventListener("pointerup", onDragEnd);
      document.documentElement.addEventListener("pointercancel", onDragEnd);
      window.addEventListener("keydown", (e) => {
        if (e.target.closest?.("input, textarea, [contenteditable]")) return;
        const k = e.key, meta = e.metaKey || e.ctrlKey;
        if (sel && mode === "select" && !meta && (k === "Delete" || k === "Backspace")) {
          e.preventDefault(); e.stopImmediatePropagation();
          host()?.requestDelete(sel.el.dataset.eid);
          return;
        }
        // arrows nudge the selection (Shift: 10 px) instead of changing slides
        if (sel && mode === "select" && !meta && k.startsWith("Arrow")) {
          e.preventDefault(); e.stopImmediatePropagation();
          const step = e.shiftKey ? 10 : 1;
          nudge(k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0, k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0);
          return;
        }
        if ("pPvVhH".includes(k) && !meta || k === "Escape" || (k === "Enter" && !e.shiftKey) ||
            (meta && (k === "z" || k === "Z" || k === "k"))) {
          e.preventDefault(); e.stopImmediatePropagation();
          host()?.key(k, { meta, shift: e.shiftKey });
        }
      }, true);
      deck.on("slide", () => { if (editing) finishEdit(true); hideHover(); if (sel) select(null, null); host()?.slideChanged(indexOf(deck.current())); });
      deck.on("resize", () => { if (sel) drawSel(); });
      setMode("select");
      // a banner on hidden slides, so nobody edits one without noticing (only in the editor view)
      for (const sec of slides()) {
        if (sec.getAttribute("data-visibility") !== "hidden") continue;
        const b = document.createElement("div");
        b.className = "__hidden-banner";
        b.textContent = SLIDE_SEL ? "Hidden slide · skipped in PDFs" : "Hidden slide · skipped when presenting and in PDFs";
        sec.appendChild(b);
      }
      const startAt = +params.get("start");
      if (startAt) goto(startAt);
      deck.keys();
    }
    host()?.bridgeReady(MODE, api, window);
  }
  if (SLIDE_SEL) {
    deck = selectorDeck();
    deck.ready(() => (MODE === "pdf" ? deck.print() : start()));
    return;
  }
  if (typeof Reveal === "undefined" || MODE === "pdf") return;   // reveal.js lays out its own print view
  deck = revealDeck();
  deck.ready(start);
})();
