/* PinDeck UI: slide list, canvas with pins, chat with the selected assistant. */

const $ = (id) => document.getElementById(id);
/* The editor's own folder: / when it runs alone, /d/<deck>/ behind the front (pindeck), which serves several
   decks on one port. Every URL of this deck's server starts here. */
const BASE = new URL(".", location.href).pathname;
const FRONT = BASE.startsWith("/d/");
const SLIDE_KEY = FRONT ? `editor.slide:${BASE}` : "editor.slide";   // decks share the origin, not their slide
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
/* Changes to the deck carry the revision of the files this tab shows (state.rev); the server refuses them
   (409, code "stale") if the files have changed since. A change that went through gives the new revision. */
const CHANGES = new Set(["edit", "text", "split", "remove", "notes", "slide-hidden", "move-slide", "add-slide",
  "delete", "import-apply", "undo", "redo"]);
const api = async (p, body) => {
  const change = body !== undefined && CHANGES.has(p.split("?")[0]);
  if (change && state.rev) body = { ...body, rev: state.rev };
  const res = await fetch(BASE + "api/" + p, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (change && res.ok && res.headers.get("x-deck-rev")) state.rev = res.headers.get("x-deck-rev");
  return res;
};

const savedSlide = (() => { try { return +localStorage.getItem(SLIDE_KEY) || 0; } catch { return 0; } })();
const state = {
  status: {}, slides: [], current: savedSlide, pins: [], mode: "select", sel: null, // mode: "select" (move, resize) or "pin"
  busy: false, status: {}, turns: new Map(), // turnId -> { undone }
};

/* ---- Frames ---------------------------------------------------------------------------- */
let main = null;        // { iframe, bridge }
let pendingMain = null; // iframe being loaded (double buffering avoids a white flash)
let measure = null;     // { iframe, bridge }
let measureReady = null, measureResolve = null;

// showHiddenSlides: PinDeck shows hidden slides so they can be edited (reveal.js drops them otherwise)
// deck/ is the deck file the server was started with (index.html, or a named file such as talk.html)
function deckSrc(mode, extra = "") { return `${BASE}deck/?editor=${mode}&showHiddenSlides=true${extra}`; }

function loadMain() {
  const f = document.createElement("iframe");
  f.className = "loading";
  f.title = "Slide";
  f.src = deckSrc("main", `&start=${state.current}`);
  $("stage").appendChild(f);
  if (pendingMain) pendingMain.remove();
  pendingMain = f;
  // a deck page whose slides never start (a script that fails, broken HTML, the file gone): say so
  setTimeout(() => { if (pendingMain === f) stageProblem("The deck page did not start within 15 seconds."); }, 15000);
}
/* Why the stage stays empty. Messages still go to the assistant, which can be asked to fix the deck. */
function stageProblem(why) {
  let el = $("stage-problem");
  if (!why) return el?.remove();
  if (!el) { el = document.createElement("div"); el.id = "stage-problem"; el.className = "stage-problem"; $("stage").appendChild(el); }
  el.innerHTML = `<b>PinDeck cannot show this deck.</b><span>${esc(why)}</span>` +
    `<span>Fix the file, or describe the problem in the chat and the assistant can fix it.</span>`;
}
let measureReject = null;
function loadMeasure() {
  measure?.iframe.remove();
  measureReady = new Promise((resolve, reject) => { measureResolve = resolve; measureReject = reject; });
  measureReady.catch(() => {});
  const f = document.createElement("iframe");
  f.className = "measure";
  f.setAttribute("aria-hidden", "true");
  f.tabIndex = -1;
  f.src = deckSrc("measure");
  measure = { iframe: f, bridge: null };
  $("stage").appendChild(f);
}

/* The slide frames run the deck sandboxed, in an origin of their own (see VIEW in server.mjs): the editor and
   the bridge in each frame talk by messages. A frame's bridge is a proxy whose calls answer with promises;
   the bridge calls the methods of editorHost below. Only the editor's own frames are listened to, and a deck's
   own script, which shares its frame with the bridge, can do no more than the bridge: hand edits to its deck. */
let callSeq = 0;
const answers = new Map();   // id -> resolve
function bridgeOf(win) {
  // not a thenable: a promise resolved with the proxy must not call it
  return new Proxy({}, { get: (_, method) => method === "then" ? undefined : (...args) => new Promise((resolve) => {
    const id = ++callSeq;
    answers.set(id, resolve);
    win.postMessage({ pindeck: "bridge", id, method, args }, "*");
  }) });
}
addEventListener("message", async (e) => {
  const m = e.data;
  if (!m || typeof m !== "object" || !e.source) return;
  const from = [main?.iframe, pendingMain, measure?.iframe].find((f) => f?.contentWindow === e.source);
  if (!from) return;
  if (m.pindeck === "bridge-answer") { answers.get(m.id)?.(m.value); answers.delete(m.id); return; }
  if (m.pindeck !== "host" || !Object.hasOwn(editorHost, m.method)) return;
  // only a frame that is showing may edit; a frame still loading may only say that it is ready, or why not
  if (m.method !== "bridgeReady" && m.method !== "deckFailed" && from !== main?.iframe) return;
  let value = null;
  try { value = await editorHost[m.method](...(Array.isArray(m.args) ? m.args : []), e.source); } catch (err) { console.error(err); }
  e.source.postMessage({ pindeck: "host-answer", id: m.id, value: value ?? null }, "*");
});

const editorHost = {
  deckFailed(role, why, win) {
    if (role === "measure") { if (measure?.iframe.contentWindow === win) measureReject?.(new Error(why)); return; }
    if (pendingMain?.contentWindow === win || main?.iframe.contentWindow === win) stageProblem(why);
  },
  bridgeReady(role, inf, win) {
    if (role === "measure") {
      if (measure && measure.iframe.contentWindow === win) { measure.bridge = bridgeOf(win); measureResolve(measure.bridge); }
      return;
    }
    if (!pendingMain || pendingMain.contentWindow !== win) return;
    const old = main;
    const bridge = bridgeOf(win);
    main = { iframe: pendingMain, bridge };
    pendingMain = null;
    main.iframe.classList.remove("loading");
    old?.iframe.remove();
    stageProblem(null);
    state.slides = inf.slides;
    state.current = Math.min(state.current, state.slides.length - 1);
    if (inf.current !== state.current) bridge.goto(state.current);
    bridge.setMode(state.mode);
    bridge.setEditable(!state.busy);
    refreshPinsFromSlides();
    bridge.renderPins(state.pins);
    if (state.sel) bridge.selectEid(state.sel.eid);
    if (state.pendingTitleEdit) { state.pendingTitleEdit = false; setTimeout(() => bridge.editTitle(), 50); }
    renderSlides();
    renderToolbar();
    loadNotes();
  },
  slideChanged(index) {
    state.current = index;
    try { localStorage.setItem(SLIDE_KEY, String(index)); } catch {}
    renderSlides();
    renderToolbar();
    loadNotes();
    api("current", { index, eid: state.slides[index]?.eid });
  },
  addPin(pin) {
    const n = state.pins.reduce((m, p) => Math.max(m, p.n), 0) + 1;
    state.pins.push({ ...pin, n });
    pinsChanged();
  },
  removePin(n) {
    state.pins = state.pins.filter((p) => p.n !== n);
    pinsChanged();
  },
  key(k, mod) { handleKey(k, mod); },
  selectionChanged(info) { state.sel = info; renderPinTray(); },
  commitEdit(op, label) { commitEdit(op, label); },
  async textSource(eid, path) {
    flushNudge();
    await editChain;
    const res = await api(`source?${new URLSearchParams({ eid, path: JSON.stringify(path || []) })}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { toast(d.error || "Could not load the text."); return null; }
    return d.html;
  },
  commitText(edit) {
    queueEdit(async () => {
      const res = await api("text", edit);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        if (d.code === "stale") keepRejectedText(edit.text, d);
        else toast(d.error || "Could not save the text.");
      }
      loadMain();   // re-render: math, footer numbers, and the file as saved
    }, "Could not save the text.");
  },
  commitSplit(op) {   // answers with the new bullet's id as saved (null if it was not)
    let eid = null;
    return queueEdit(async () => {
      const { whole, ...req } = op;
      const res = await api("split", req);
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (d.code === "stale") keepRejectedText(whole ?? op.text, d);
        else toast(d.error || "Could not add the bullet.");
        loadMain();
        return;
      }
      eid = d.eid;
    }, "Could not add the bullet.").then(() => eid);
  },
  commitRemove(eid) {
    queueEdit(async () => {
      const res = await api("remove", { eid });
      if (!res.ok) toast((await res.json().catch(() => ({}))).error || "Could not remove the bullet.");
      loadMain();
    }, "Could not remove the bullet.");
  },
  refresh() { queueEdit(() => loadMain(), "Could not reload the slide."); },
  editingChanged(on) {
    state.editing = on;
    // after the edit's own save, which the bridge asks for next
    if (!on && heldFiles) setTimeout(() => queueEdit(() => { const d = heldFiles; heldFiles = null; if (d) applyFiles(d); }), 0);
  },
  requestDelete(eid) { requestDelete(eid); },
  dropFiles(files, at) { attachFiles(files, at); },
  dragOver(on) { $("drop-hint").hidden = !on; },
  toast(msg) { toast(msg); },
};

/* ---- Hand edits (drag, resize, nudge) ---------------------------------------------------------- */
let editChain = Promise.resolve(), nudgeAcc = null, nudgeTimer = null;
// Saves run one after another. An edit that throws (offline, server gone) is reported and the queue
// carries on, so one failure never silently skips the edits after it.
function queueEdit(fn, failMsg = "Could not save the change.") {
  editChain = editChain.catch(() => {}).then(fn).catch(() => { toast(failMsg); });
  return editChain;
}
function postEdit(op, label) {
  return queueEdit(async () => {
    const res = await api("edit", { ops: [op], label });
    if (!res.ok) {
      toast((await res.json().catch(() => ({}))).error || "Could not save the change.");
      loadMain();   // show the file as it is
    }
  });
}
function flushNudge() {
  clearTimeout(nudgeTimer);
  if (!nudgeAcc) return;
  const n = nudgeAcc;
  nudgeAcc = null;
  postEdit(n.op, `Moved ${n.name} by ${n.dx}, ${n.dy} px`);
}
function commitEdit(op, label) {
  if (label?.nudge) {   // arrow keys: one change per burst of key presses
    if (nudgeAcc && nudgeAcc.op.eid !== op.eid) flushNudge();
    nudgeAcc ??= { name: label.name, dx: 0, dy: 0 };
    nudgeAcc.dx += label.dx; nudgeAcc.dy += label.dy; nudgeAcc.op = op;
    clearTimeout(nudgeTimer);
    nudgeTimer = setTimeout(flushNudge, 600);
    return;
  }
  flushNudge();
  postEdit(op, label);
}
async function undoRedo(which) {
  flushNudge();
  await editChain;
  const res = await api(which, {});
  if (!res.ok) toast((await res.json().catch(() => ({}))).error || `Nothing to ${which}.`);
}
/* A text edit refused because the file changed meanwhile: the slide reloads with the file as it is now,
   and the user's text stays available to copy and type in again. Nothing is merged automatically. */
let rejectedText = "";
function keepRejectedText(text, d) {
  if (d.rev) state.rev = d.rev;
  rejectedText = String(text ?? "");
  toast(`${esc(d.error)}<a href="#" data-copy-rejected>Copy your text</a>`, { html: true, ms: 20000 });
}
document.addEventListener("click", (e) => {
  if (!e.target.closest?.("[data-copy-rejected]")) return;
  e.preventDefault();
  navigator.clipboard?.writeText(rejectedText).then(() => toast("Your text is on the clipboard."), () => toast(rejectedText, { ms: 20000 }));
});
let toastTimer = null;
function toast(msg, { html = false, ms = 3200 } = {}) {
  $("toast")[html ? "innerHTML" : "textContent"] = msg;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), ms);
}

// a deck page that never starts, or stops answering, must not hold up a message: give up after a while
const within = (ms, p, what) => Promise.race([p, new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms))]);
async function measureSlide(index) {
  const b = await within(8000, measureReady, "The measuring frame");
  return within(8000, b.measure(index), "Measuring the slide");
}
// one measurement at a time: the measure frame has a single "current slide"
let measureChain = Promise.resolve();
const queueMeasure = (index) => (measureChain = measureChain.then(() => measureSlide(index), () => measureSlide(index)));

/* ---- Slides ---------------------------------------------------------------------------------- */
function goto(i) {
  if (i < 0 || i >= state.slides.length) return;
  main?.bridge.goto(i);
}
function renderSlides() {
  const counts = {};
  state.pins.forEach((p) => (counts[p.slide.index] = (counts[p.slide.index] || 0) + 1));
  $("slide-list").innerHTML = state.slides.map((s, i) => `
    <li data-i="${i}" class="${i === state.current ? "active" : ""} ${s.hidden ? "hidden-slide" : ""}" title="${esc(s.eid)}" draggable="true">
      <span class="num">${i + 1}</span>
      <span><div class="t">${esc(s.title)}</div>${s.sub ? `<div class="s">${esc(s.sub)}</div>` : ""}
        ${s.kind !== "content" ? `<span class="kind">${esc(s.kind.replace(/-slide$/, ""))}</span>` : ""}
        ${s.hidden ? '<span class="kind hid">hidden</span>' : ""}</span>
      ${counts[i] ? `<span class="badge" title="${counts[i]} pin(s)">${counts[i]}</span>` : "<span></span>"}
      <button class="eye" data-eye="${i}" title="${s.hidden ? "Show this slide again" : state.status?.slideSelector ?
        "Hide this slide (left out of PDFs)" : "Hide this slide (skipped when presenting)"}"
        aria-label="${s.hidden ? "Show" : "Hide"} slide ${i + 1}">${s.hidden ? EYE_ICON : EYE_OFF_ICON}</button>
    </li>`).join("");
  $("slide-list").querySelector("li.active")?.scrollIntoView({ block: "nearest" });
}
$("slide-list").addEventListener("click", (e) => {
  const eye = e.target.closest("[data-eye]");
  if (eye) { e.stopPropagation(); return toggleHidden(+eye.dataset.eye); }
  const li = e.target.closest("li[data-i]");
  if (li) goto(+li.dataset.i);
});

/* ---- Move slides: drag one in the slide list -------------------------------------------------------
   A line shows where it will go; the editor then opens the moved slide at its new place. */
const slideList = $("slide-list");
let dragFrom = null;
// insertion index for a pointer at y: before the first slide whose middle is below it, else at the end
function dropIndex(y) {
  const lis = [...slideList.querySelectorAll("li[data-i]")];
  const i = lis.findIndex((li) => { const r = li.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return i < 0 ? lis.length : i;
}
function showDrop(i) {
  slideList.querySelectorAll(".drop-before, .drop-after").forEach((li) => li.classList.remove("drop-before", "drop-after"));
  if (i == null || i === dragFrom || i === dragFrom + 1) return;   // dropping there would not move it
  const lis = slideList.querySelectorAll("li[data-i]");
  if (i < lis.length) lis[i].classList.add("drop-before");
  else lis[lis.length - 1]?.classList.add("drop-after");
}
slideList.addEventListener("dragstart", (e) => {
  const li = e.target.closest("li[data-i]");
  if (!li || state.busy) return e.preventDefault();
  dragFrom = +li.dataset.i;
  li.classList.add("dragging");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", state.slides[dragFrom]?.eid || "");
});
slideList.addEventListener("dragover", (e) => {
  if (dragFrom == null) return;   // not one of our slides (a file, say)
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  showDrop(dropIndex(e.clientY));
});
slideList.addEventListener("dragleave", (e) => { if (!slideList.contains(e.relatedTarget)) showDrop(null); });
slideList.addEventListener("dragend", () => {
  showDrop(null);
  slideList.querySelector(".dragging")?.classList.remove("dragging");
  dragFrom = null;
});
slideList.addEventListener("drop", (e) => {
  if (dragFrom == null) return;
  e.preventDefault();
  const from = dragFrom, to = dropIndex(e.clientY);
  showDrop(null);
  if (to !== from && to !== from + 1) moveSlideTo(from, to);
});
async function moveSlideTo(from, to) {   // to: insertion index in the current list
  const s = state.slides[from];
  if (!s) return;
  if (state.busy) return toast("The assistant is working. Wait until it has finished.");
  flushNudge();
  await editChain;
  const res = await api("move-slide", { eid: s.eid, before: state.slides[to]?.eid ?? null });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return toast(d.error || "Could not move the slide.");
  if (d.unchanged) return;
  state.current = d.index;   // the reload opens the moved slide
  try { localStorage.setItem(SLIDE_KEY, String(d.index)); } catch {}
  loadMain();
}

/* ---- Speaker notes: the field under the slide -------------------------------------------------------
   Shows the current slide's <aside class="notes"> and saves it as a hand edit when the field loses focus
   or on ⌘Enter; Esc puts back what the file says. Notes with markup other than line breaks are edited
   as their HTML ("HTML" in the header). Typing is never overwritten by a reload. */
const notesBox = $("notes");
let notes = { eid: null, text: "", html: false };   // the notes as the file has them
let notesSeq = 0;
const notesDirty = () => !!notes.eid && notesBox.value.trim() !== notes.text.trim();
function notesStatus(msg) {
  $("notes-status").textContent = msg ?? (notes.html ? "HTML" : "");
  $("notes-status").title = msg ? "" : notes.html ? "These notes contain formatting, so you edit them as HTML" : "";
}
async function loadNotes() {
  const eid = state.slides[state.current]?.eid;
  if (!eid || document.activeElement === notesBox) return;
  const seq = ++notesSeq;
  await editChain.catch(() => {});   // a save still on its way would otherwise be read back as the old text
  if (seq !== notesSeq || notesDirty()) return;
  const res = await api(`notes?${new URLSearchParams({ eid })}`).catch(() => null);
  const d = res?.ok ? await res.json().catch(() => null) : null;
  if (seq !== notesSeq || document.activeElement === notesBox || notesDirty()) return;
  if (!d) {   // detach from the previous slide, so its notes are not shown, or saved over, as this one's
    notes = { eid: null, text: "", html: false };
    notesBox.value = "";
    notesBox.disabled = true;
    return notesStatus("Could not load");
  }
  notes = { eid, text: d.text || "", html: !!d.html };
  notesBox.value = notes.text;
  notesBox.disabled = false;
  notesStatus();
}
function saveNotes() {
  if (!notesDirty()) return Promise.resolve(true);
  const edit = { eid: notes.eid, text: notesBox.value, html: notes.html };
  flushNudge();
  const run = async () => {
    notesStatus("Saving…");
    let res, d;
    try {
      res = await api("notes", edit);
      d = await res.json().catch(() => ({}));
    } catch {}   // a network failure must not break the shared edit queue
    if (!res?.ok) {
      notesStatus("Not saved");
      toast(d?.error || "Could not save the notes.");
      return false;
    }
    if (notes.eid === edit.eid) notes.text = edit.text;
    notesStatus("Saved");
    setTimeout(() => { if ($("notes-status").textContent === "Saved") notesStatus(); }, 1500);
    return true;
  };
  return queueEdit(run, "Could not save the notes.");
}
notesBox.addEventListener("blur", async () => {
  if (await saveNotes()) loadNotes();   // retain a failed draft and its original slide id for retry
});
notesBox.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); notesBox.blur(); }
  else if (e.key === "Escape") { e.preventDefault(); notesBox.value = notes.text; notesBox.blur(); }
});
// closing the tab while typing: send what is there (sendBeacon cannot set headers, hence the token in the URL)
addEventListener("pagehide", () => {
  if (notesDirty() && !state.busy)
    navigator.sendBeacon(BASE + "api/notes", new Blob([JSON.stringify({ eid: notes.eid, text: notesBox.value, html: notes.html })]));
});
function setNotesOpen(open) {
  $("notes-panel").classList.toggle("collapsed", !open);
  $("notes-toggle").setAttribute("aria-expanded", String(open));
  try { localStorage.setItem("editor.notes", open ? "open" : "closed"); } catch {}
}
$("notes-toggle").onclick = () => setNotesOpen($("notes-panel").classList.contains("collapsed"));
// height of the notes: drag the panel's top edge (or ↑ ↓ on it); double-click for the default size
const NOTES_H = 96, NOTES_MIN = 44;
function setNotesHeight(h, save = true) {
  const max = Math.max(NOTES_MIN, $("stage").parentElement.clientHeight * 0.6);
  h = Math.round(Math.min(max, Math.max(NOTES_MIN, h)));
  notesBox.style.height = h + "px";
  $("notes-split").setAttribute("aria-valuenow", String(h));
  if (save) try { localStorage.setItem("editor.notesHeight", String(h)); } catch {}
}
$("notes-split").addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  const split = $("notes-split"), y0 = e.clientY, h0 = notesBox.offsetHeight;
  split.setPointerCapture(e.pointerId);
  document.body.classList.add("resizing-notes");
  const move = (ev) => setNotesHeight(h0 - (ev.clientY - y0));
  const up = () => {
    document.body.classList.remove("resizing-notes");
    split.removeEventListener("pointermove", move);
    split.removeEventListener("pointerup", up);
    split.removeEventListener("pointercancel", up);
  };
  split.addEventListener("pointermove", move);
  split.addEventListener("pointerup", up);
  split.addEventListener("pointercancel", up);
});
$("notes-split").addEventListener("dblclick", () => setNotesHeight(NOTES_H));
$("notes-split").addEventListener("keydown", (e) => {
  const step = e.shiftKey ? 64 : 16;
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
  e.preventDefault();
  e.stopPropagation();   // not a slide change
  setNotesHeight(notesBox.offsetHeight + (e.key === "ArrowUp" ? step : -step));
});
setNotesHeight((() => { try { return +localStorage.getItem("editor.notesHeight") || NOTES_H; } catch { return NOTES_H; } })(), false);
setNotesOpen((() => { try { return localStorage.getItem("editor.notes") !== "closed"; } catch { return true; } })());

/* ---- Hide and show slides -------------------------------------------------------------------------
   A hidden slide gets data-visibility="hidden" (reveal.js): it stays in the deck and in PinDeck, but is
   skipped when presenting and in PDF exports. */
const EYE_ICON = `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3C4.4 3 1.7 5.6.8 8c.9 2.4 3.6 5 7.2 5s6.3-2.6 7.2-5C14.3 5.6 11.6 3 8 3zm0 8.2A3.2 3.2 0 1 1 8 4.8a3.2 3.2 0 0 1 0 6.4zM8 6.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4z"/></svg>`;
const EYE_OFF_ICON = `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.2 1.5 1.1 2.6l2.3 2.3C2.2 5.8 1.3 6.9.8 8c.9 2.4 3.6 5 7.2 5 1.3 0 2.5-.3 3.5-.9l2.3 2.3 1.1-1.1zM8 11.2A3.2 3.2 0 0 1 4.9 7.2l1.3 1.3a1.7 1.7 0 0 0 1.3 1.3l1.3 1.3c-.3.1-.5.1-.8.1zM8 3c-1 0-1.9.2-2.7.5l1.4 1.4A3.2 3.2 0 0 1 11 9.2l2.2 2.2c.9-.9 1.6-2 2-3.4C14.3 5.6 11.6 3 8 3z"/></svg>`;
async function toggleHidden(index = state.current) {
  const s = state.slides[index];
  if (!s) return;
  if (state.busy) return toast("The assistant is working. Wait until it has finished.");
  flushNudge();
  await editChain;
  const res = await api("slide-hidden", { eid: s.eid, hidden: !s.hidden });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return toast(d.error || "Could not change the slide.");
  loadMain();
}
function renderToolbar() {
  const s = state.slides[state.current];
  $("slide-pos").textContent = s ? `${state.current + 1} / ${state.slides.length}` : "– / –";
  $("pin-toggle").setAttribute("aria-pressed", String(state.mode === "pin"));
  $("select-toggle").setAttribute("aria-pressed", String(state.mode === "select"));
  $("pin-hint").hidden = state.mode !== "pin";
  const st = state.status;
  $("undo").disabled = !st.undo || state.busy;
  $("redo").disabled = !st.redo || state.busy;
  $("undo").title = st.undo ? `Undo: ${st.undo} (⌘Z)` : "Undo (⌘Z)";
  $("redo").title = st.redo ? `Redo: ${st.redo} (⇧⌘Z)` : "Redo (⇧⌘Z)";
}
$("prev").onclick = () => goto(state.current - 1);
$("next").onclick = () => goto(state.current + 1);
$("pin-toggle").onclick = () => setMode(state.mode === "pin" ? "select" : "pin");
$("select-toggle").onclick = () => setMode("select");
$("undo").onclick = () => undoRedo("undo");
$("redo").onclick = () => undoRedo("redo");
/* ---- PDF export ---------------------------------------------------------------------------- */
/* Drop-down menus: one open at a time; an outside click or Esc closes them. */
function setMenu(btn, menu, open) {
  document.querySelectorAll(".menu").forEach((m) => {
    const show = m === menu && open;
    m.hidden = !show;
    m.parentElement.querySelector("[aria-haspopup]")?.setAttribute("aria-expanded", String(show));
  });
}
function wireMenu(btnId, menuId, beforeOpen) {
  $(btnId).addEventListener("click", (e) => {
    e.stopPropagation();
    const open = $(menuId).hidden;
    if (open) beforeOpen?.();
    setMenu($(btnId), $(menuId), open);
  });
}
const closeMenus = () => setMenu(null, null, false);
document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) closeMenus(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); }, true);
/* The deck menu, behind the front only: the decks in the deck's folder and the asset roots (and one folder
   down). Each is a link, so a deck opens in place, or in a new tab with ⌘-click; the deck left behind keeps
   its chat and undo, and the assistant goes on with a turn it has begun. */
if (FRONT) {
  $("deck-btn").disabled = false;
  $("deck-btn").title = "Open another deck";
  $("deck-btn").querySelector(".caret").hidden = false;
  wireMenu("deck-btn", "deck-menu", async () => {
    const menu = $("deck-menu");
    menu.innerHTML = '<div class="menu-note">Looking for decks…</div>';
    let decks = [];
    try { decks = (await (await fetch("/api/decks")).json()).decks; }
    catch { menu.innerHTML = '<div class="menu-note">The deck list is not available.</div>'; return; }
    const roots = [...new Set(decks.map((d) => d.root))];
    menu.innerHTML = roots.map((root) => (roots.length > 1 ? `<div class="group" title="${esc(root)}">${esc(root.split("/").pop())}</div>` : "") +
      decks.filter((d) => d.root === root).map((d) => {
        const here = BASE === `/d/${d.key}/`;
        return d.problem
          ? `<button class="opt" role="menuitem" disabled title="${esc(d.problem)}"><span class="tick"></span><span><b>${esc(d.rel)}</b><span class="why">${esc(d.problem.replace(/^\S+ /, "").split(". ")[0])}.</span></span></button>`
          : `<a class="opt" role="menuitem" href="/d/${esc(d.key)}/" ${here ? 'aria-current="page"' : ""}><span class="tick">${here ? "✓" : ""}</span>` +
            `<b>${esc(d.rel)}</b>${here ? "" : d.open ? '<span class="d">open</span>' : ""}</a>`;
      }).join("")).join("") +
      '<div class="menu-note">A deck opens here (⌘-click: in a new tab), with its own chat and undo. The assistant finishes its turn in the deck you leave.</div>';
  });
}
const setExportMenu = (open) => setMenu($("export-btn"), $("export-menu"), open);
wireMenu("export-btn", "export-menu");
$("export-menu").addEventListener("click", async (e) => {
  const item = e.target.closest("[data-export]");
  if (!item) return;
  setExportMenu(false);
  const kind = item.dataset.export, label = kind === "presentation" ? "presentation" : "handout";
  const btn = $("export-btn");
  btn.disabled = true;
  btn.textContent = "Exporting…";
  toast(`Creating the ${label} PDF…`, { ms: 60000 });
  try {
    flushNudge();
    await editChain;   // export what is saved, including the latest hand edits
    const res = await api("export", { kind, includeHidden: $("export-hidden").checked });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(d.error || "Export failed.");
    toast(`Saved ${esc(d.rel)} (${Math.round(d.bytes / 1024)} kB)<a href="${d.url}" target="_blank" rel="noopener">Open</a>`,
      { html: true, ms: 10000 });
  } catch (err) {
    toast(String(err.message || err), { ms: 6000 });
  } finally {
    btn.disabled = false;
    btn.textContent = "Export ▾";
  }
});

$("present").onclick = () => {
  window.open(`${BASE}deck/${state.slides[state.current]?.hash || ""}`, "_blank");
};

/* ---- Pins --------------------------------------------------------------------------------------- */
function setMode(m) {
  state.mode = m;
  if (m !== "select") state.sel = null;
  main?.bridge.setMode(m);
  renderToolbar();
  renderPinTray();
}
function refreshPinsFromSlides() {
  // after a reload, slide indices may have moved: re-resolve by slide id, drop pins whose slide is gone
  state.pins = state.pins.flatMap((p) => {
    const i = state.slides.findIndex((s) => s.eid === p.slide.eid);
    return i < 0 ? [] : [{ ...p, slide: { ...p.slide, index: i } }];
  });
}
function pinsChanged() {
  main?.bridge.renderPins(state.pins);
  renderPinTray();
  renderSlides();
}
function shortEid(p) {
  if (p.tag?.startsWith("footer")) return "footer";
  return p.eid === p.slide.eid ? "slide" : p.eid.replace(/^[^/]+\//, "");
}
function renderPinTray() {
  const sel = state.sel;
  $("pin-tray").innerHTML = (sel ? `
    <span class="chip sel" data-sel title="Selected: ${esc(sel.eid)}. The assistant sees it as “this”.">
      <span class="n">▢</span> S${sel.slide.index + 1} · ${esc(sel.eid.replace(/^[^/]+\//, ""))} <span class="dim">${sel.box.w} × ${sel.box.h}</span>
      <button class="x" data-unsel aria-label="Deselect">×</button></span>` : "") + state.pins.map((p) => `
    <span class="chip" data-n="${p.n}" title="${esc(p.eid)}${p.text ? " — " + esc(p.text.slice(0, 80)) : ""}">
      <span class="n">${p.n}</span> S${p.slide.index + 1} · ${esc(shortEid(p))}${p.word ? ` “${esc(p.word)}”` : ""}
      ${p.locked ? '<span class="lock" title="Brand-locked">🔒</span>' : ""}
      <button class="x" data-x="${p.n}" aria-label="Remove pin ${p.n}">×</button></span>`).join("");
  $("clear-pins").hidden = !state.pins.length;
}
$("pin-tray").addEventListener("click", (e) => {
  const x = e.target.closest("[data-x]");
  if (x) return editorHost.removePin(+x.dataset.x);
  if (e.target.closest("[data-unsel]")) return main?.bridge.deselect();
  if (e.target.closest("[data-sel]")) return main?.bridge.highlight(state.sel.eid);
  const chip = e.target.closest(".chip");
  if (!chip) return;
  const p = state.pins.find((p) => p.n === +chip.dataset.n);
  if (!p) return;
  if (p.slide.index !== state.current) goto(p.slide.index);
  setTimeout(() => main?.bridge.highlight(p.eid), 60);
});
$("pin-tray").addEventListener("mouseover", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip || chip.dataset.hl) return;
  chip.dataset.hl = "1";
  setTimeout(() => delete chip.dataset.hl, 1500);
  const p = state.pins.find((p) => p.n === +chip.dataset.n);
  if (p && p.slide.index === state.current) main?.bridge.highlight(p.eid);
});
$("clear-pins").onclick = () => { state.pins = []; pinsChanged(); };

/* ---- Chat ----------------------------------------------------------------------------------------- */
const chatEl = $("chat");
const entryEls = new Map();
function md(s) {
  // small, safe subset: code blocks, inline code, bold, lists, paragraphs
  const blocks = [];
  s = esc(s).replace(/```[\w-]*\n?([\s\S]*?)```/g, (_, c) => { blocks.push(c); return `\u0000${blocks.length - 1}\u0000`; });
  const inline = (t) => t.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  const out = s.split(/\n{2,}/).map((para) => {
    const lines = para.split("\n");
    if (lines.every((l) => /^\s*[-*•]\s/.test(l) || !l.trim()))
      return "<ul>" + lines.filter((l) => l.trim()).map((l) => `<li>${inline(l.replace(/^\s*[-*•]\s/, ""))}</li>`).join("") + "</ul>";
    return `<p>${inline(lines.join("<br>"))}</p>`;
  }).join("");
  return out.replace(/<p>\u0000(\d+)\u0000<\/p>|\u0000(\d+)\u0000/g, (_, a, b) => `<pre>${blocks[a ?? b]}</pre>`);
}
/* A screenshot in the chat: a small picture that opens large. Only the newest ones are kept on disk;
   an older one says so (see the error listener below). */
const shotChip = (file, label = "") => `<button type="button" class="chip shot-chip" data-shot="${esc(file)}" title="Open the screenshot">` +
  `<img src="${BASE}shots/${encodeURIComponent(file)}" alt="" loading="lazy">${label ? ` ${esc(label)}` : ""}</button>`;
// only the most recent change still in effect can be undone: it alone gets an Undo button
const lastLive = () => state.status?.undoId;
function entryHtml(e) {
  switch (e.kind) {
    case "user":
      return `${esc(e.text)}${e.pins?.length || e.screenshot || e.selection || e.attachments?.length ? `<div class="chips">${e.selection ?
        `<span class="chip sel" title="${esc(e.selection.eid)}"><span class="n">▢</span> S${e.selection.slide} · ${esc(e.selection.label)}</span>` : ""}${(e.pins || []).map((p) =>
        `<span class="chip" title="${esc(p.eid)}"><span class="n">${p.n}</span> S${p.slide} · ${esc(p.label || p.eid)}</span>`).join("")}${
        e.screenshot?.file ? shotChip(e.screenshot.file, `screenshot S${e.screenshot.slide}`) : e.screenshot ? '<span class="chip">📷 screenshot</span>' : ""}${(e.attachments || []).map((a) =>
        `<span class="chip att-chip" title="${esc(a.path)}">${a.kind === "image" ? `<img src="${BASE}deck/${esc(a.path)}" alt="">` : a.kind === "pdf" ? "📄" : "🔊"} ${esc(a.path.split("/").pop())}</span>`).join("")}</div>` : ""}`;
    case "assistant": return md(e.text);
    case "tool":
      return `<span><span class="tn">${esc(e.name)}</span> ${esc(e.detail || "")}${e.shot ? " " + shotChip(e.shot) : ""}${e.error ? `<span class="err">${esc(e.error)}</span>` : ""}</span>`;
    case "edit": {
      const t = state.turns.get(e.turnId), undone = t ? t.undone : e.undone;
      return `<span class="files ${undone ? "undone" : ""}">✎ ${esc(e.label)}</span>
        ${t ? `<button class="small" data-diff="${e.turnId}">Diff</button>` : ""}
        ${t && !t.undone && t.id === lastLive() ? `<button class="small" data-undo="${e.turnId}">Undo</button>` : undone ? "<span>undone</span>" : ""}`;
    }
    case "turn": {
      // a change from before PinDeck restarted: its undo history (and diff) ended with that run
      const t = e.turnId ? state.turns.get(e.turnId) : null, undone = t ? t.undone : e.undone;
      const parts = [];
      if (e.error) parts.push(`<span class="warn">${esc(e.error)}</span>`);
      if (e.files?.length) {
        parts.push(`<span class="files ${undone ? "undone" : ""}" ${t ? "" : 'title="From before PinDeck restarted: no diff or undo any more"'}>Changed ${e.files.map((f) =>
          `${esc(f.file)} ` + (f.binary ? `<span class="add">(binary)</span>`
            : `<span class="add">+${f.added}</span> <span class="del">−${f.removed}</span>`)).join(", ")}</span>`);
        if (t) parts.push(`<button class="small" data-diff="${e.turnId}">Diff</button>`);
        if (t && !t.undone && t.id === lastLive()) parts.push(`<button class="small" data-undo="${e.turnId}">Undo</button>`);
        if (undone) parts.push("<span>undone</span>");
      } else if (!e.error) parts.push("No file changes");
      if (e.restored?.length) parts.push(`<span class="warn">${esc(e.restored.join(", "))} is locked; the change was reverted.</span>`);
      if (e.denials?.length) parts.push(`<span class="warn" title="PinDeck lets the assistant run only its own commands (layout, shot, slides, pdf) and edit ${esc(state.status?.deckFile || "index.html")}, theme.css and the deck's other files, never brand.css">` +
        `Not allowed in PinDeck, so skipped: ${e.denials.map((d) => esc(`${d.name} ${d.detail}`)).join(", ")}</span>`);
      if (e.duration) parts.push(`<span class="meta">${(e.duration / 1000).toFixed(1)} s</span>`);
      return parts.join(" ");
    }
    default: return esc(e.text);
  }
}
function renderEntry(e) {
  $("chat-empty").hidden = true;
  let el = entryEls.get(e.id);
  if (!el) {
    el = document.createElement("div");
    entryEls.set(e.id, el);
    chatEl.appendChild(el);
  }
  el.className = `msg ${e.kind}`;
  el.innerHTML = entryHtml(e);
  el.__entry = e;
}
function rerenderTurns() { entryEls.forEach((el) => { if (["turn", "edit"].includes(el.__entry?.kind)) el.innerHTML = entryHtml(el.__entry); }); }
const scrollChat = () => { chatEl.scrollTop = chatEl.scrollHeight; };
function clearChat() {
  entryEls.forEach((el) => el.remove());
  entryEls.clear();
  $("chat-empty").hidden = false;
}

// a picture that is no longer kept: the chip says so and opens nothing (errors do not bubble: capture)
chatEl.addEventListener("error", (e) => {
  const chip = e.target.closest?.("[data-shot]");
  if (!chip || e.target.tagName !== "IMG") return;
  chip.removeAttribute("data-shot");
  chip.classList.add("gone");
  chip.title = "Only the newest screenshots are kept";
  chip.textContent = "📷 no longer kept";
}, true);
chatEl.addEventListener("click", async (e) => {
  const s = e.target.closest("[data-shot]");
  if (s) {
    $("shot-img").src = `${BASE}shots/${encodeURIComponent(s.dataset.shot)}`;
    $("shot-title").textContent = s.dataset.shot;
    $("shot-dialog").showModal();
    return;
  }
  const d = e.target.closest("[data-diff]");
  if (d) {
    const res = await api(`turn/${d.dataset.diff}/diff`);
    const txt = await res.text();
    $("diff-body").innerHTML = txt.split("\n").map((l) => {
      const c = l.startsWith("+++") || l.startsWith("---") ? "f" : l.startsWith("@@") ? "h" : l[0] === "+" ? "a" : l[0] === "-" ? "d" : "";
      return `<span class="${c}">${esc(l) || " "}</span>`;
    }).join("");
    $("diff-dialog").showModal();
    return;
  }
  const u = e.target.closest("[data-undo]");
  if (u) {
    u.disabled = true;
    flushNudge();
    await editChain;
    const res = await api(`turn/${u.dataset.undo}/undo`, {});
    if (!res.ok) { u.disabled = false; toast((await res.json()).error); }
  }
});
$("diff-close").onclick = () => $("diff-dialog").close();
$("shot-close").onclick = () => $("shot-dialog").close();
// Esc closes it (the browser does that for a modal dialog), and so does a click beside the picture
$("shot-dialog").addEventListener("click", (e) => { if (e.target === $("shot-dialog")) $("shot-dialog").close(); });

function setBusy(busy) {
  state.busy = busy;
  $("notes").readOnly = busy;   // hand edits wait until the assistant has finished
  $("working").hidden = !busy;
  main?.bridge.setEditable(!busy);
  $("send").hidden = busy;
  $("stop").hidden = !busy;
}

async function send() {
  const text = $("input").value.trim();
  if (!text || state.busy) return;
  if (attachments.some((a) => a.status === "uploading")) return toast("Wait until the attachments have finished uploading.");
  $("send").disabled = true;
  try {
    // measure every pinned slide plus the current one, in the user's own browser
    flushNudge();
    await editChain;
    const idx = [...new Set([...state.pins.map((p) => p.slide.index), state.current])].slice(0, 4);
    const layouts = [];
    for (const i of idx) { try { layouts.push(await queueMeasure(i)); } catch {} }
    const s = state.slides[state.current];
    const res = await api("message", {
      text, pins: state.pins, selection: state.sel, layouts, screenshot: state.shot || false,
      attachments: attachments.filter((a) => a.status === "ready").map(({ path, kind, name, bytes, width, height, duration,
        sampleRate, channels, waveform, pages, pageSize, droppedAt }) =>
        ({ path, kind, name, bytes, width, height, duration, sampleRate, channels, waveform, pages, pageSize, droppedAt })),
      current: s ? { index: state.current, eid: s.eid } : null,
    });
    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      let d = null;
      try { d = JSON.parse(raw); } catch {}
      const why = d?.error || (/too large/i.test(raw) ? "The message is too large to send (the limit is 5 MB)." : `Could not send the message (${res.status}).`);
      // a missing backend needs the user's attention; the rest is said in passing, the message stays in the box
      if (d?.code?.endsWith("-unavailable")) alert(why); else toast(why, { ms: 8000 });
      return;
    }
    $("input").value = "";
    autosize();
    state.shot = null;
    clearAttachments();
    state.pins = [];
    pinsChanged();
    if (state.mode === "pin") setMode("select");
  } finally {
    $("send").disabled = false;
  }
}
$("send").onclick = send;
$("stop").onclick = () => { $("working-text").textContent = "Stopping…"; api("stop", {}); };
$("new-chat").onclick = async () => {
  if (!confirm("Start a new conversation? The assistant forgets this chat; your slides, and Undo and Redo, stay as they are.")) return;
  await api("new-chat", {});
};
function autosize() {
  const t = $("input");
  t.style.height = "auto";
  t.style.height = Math.min(220, Math.max(64, t.scrollHeight + 2)) + "px";
}
$("input").addEventListener("input", autosize);
$("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
  if (e.key === "Escape") { $("input").blur(); if (state.mode === "pin") setMode("select"); }
});

/* ---- Keyboard ------------------------------------------------------------------------------------ */
function handleKey(k, mod = {}) {
  if (mod.meta && (k === "z" || k === "Z")) return undoRedo(mod.shift ? "redo" : "undo");
  if (mod.meta) return;
  if (k === "p" || k === "P") setMode(state.mode === "pin" ? "select" : "pin");
  else if (k === "v" || k === "V") setMode("select");
  else if (k === "h" || k === "H") toggleHidden();
  else if (k === "Escape") { if (state.mode === "pin") setMode("select"); else main?.bridge.deselect(); }
  else if (k === "Enter") {
    if (!(state.sel && state.mode === "select" && main)) $("input").focus();
    else main.bridge.editSelection().then((editing) => { if (!editing) $("input").focus(); });
  }
  else if ((k === "Delete" || k === "Backspace") && state.sel && state.mode === "select") requestDelete(state.sel.eid);
  else if (k.startsWith("Arrow") && state.sel && state.mode === "select") {
    const step = mod.shift ? 10 : 1;
    main?.bridge.nudge(k === "ArrowLeft" ? -step : k === "ArrowRight" ? step : 0, k === "ArrowUp" ? -step : k === "ArrowDown" ? step : 0);
  }
  else if (k === "ArrowLeft" || k === "ArrowUp" || k === "PageUp") goto(state.current - 1);
  else if (k === "ArrowRight" || k === "ArrowDown" || k === "PageDown" || k === " ") goto(state.current + 1);
}
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea, dialog")) return;
  // a menu and the button that opens it keep Enter, Space and the arrow keys (a menu opens, an item is chosen):
  // no slide change, no jump to the chat. Other buttons do not: after a click on ‹ › the focus stays there
  // while the slide is clicked (the slide frame keeps it), and Enter must still edit the selected text.
  if (["Enter", " ", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key) && e.target.closest?.(".menu, [aria-haspopup]")) return;
  const meta = e.metaKey || e.ctrlKey;
  if (meta && (e.key === "z" || e.key === "Z")) { e.preventDefault(); return handleKey(e.key, { meta, shift: e.shiftKey }); }
  if (meta || e.altKey) return;
  if (["p", "P", "v", "V", "h", "H", "Escape", "Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "PageUp", "PageDown", "Delete", "Backspace"].includes(e.key)) {
    e.preventDefault();
    handleKey(e.key, { shift: e.shiftKey });
  }
});

/* ---- Server events ---------------------------------------------------------------------------------- */
let shownProblem = null;   // the deck problem last shown, so a status update does not repeat it
function applyStatus(s) {
  if (!s.models) s.models = state.status?.models;   // sent only when they change
  const undoMoved = s.undoId !== state.status?.undoId;
  state.status = s;
  if (undoMoved) rerenderTurns();   // the Undo button moves to the change that is now the most recent
  // the deck's name in the header ("ocean-example", or "talk.html" for a named deck file), its full path on hover
  if (s.deck) {
    const folder = s.deck.split(/[\\/]/).filter(Boolean).pop() || s.deck;
    const name = s.deckFile && s.deckFile !== "index.html" ? s.deckFile : folder;
    $("deck-name").textContent = name;
    $("deck-btn").title = `${s.deck}/${s.deckFile || "index.html"}${FRONT ? " (click for other decks)" : ""}`;
    if ($("deck-file")) $("deck-file").textContent = s.deckFile || "index.html";
    document.title = `${name} · PinDeck`;
  }
  setBusy(!!s.busy);
  $("model").textContent = modelLabel(s);
  $("model-btn").disabled = !!s.busy;
  $("model-btn").title = `${providerLabel(s.settings?.provider)} model`;
  renderEffortMenu();
  $("new-chat").disabled = !!s.busy;
  $("stop").hidden = !s.busy || !!s.switching;
  $("working-text").textContent = s.switching ? "Updating model…" : s.preparing ? "Taking the screenshot…" : "The assistant is working…";
  $("conn").classList.toggle("on", !!s.running);
  $("conn").title = s.running ? "The selected backend is running" : "The selected backend starts with the next message";
  // only the selected backend's availability matters: Codex missing is no news to someone using Claude
  const provider = s.settings?.provider || "claude";
  const caps = Object.fromEntries(Object.entries(s.capabilities || {})
    .filter(([k]) => !["claude", "codex"].includes(k) || k === provider));
  const why = (c) => (c && c.available === false ? c.reason : "");
  $("add-shot").disabled = !s.chrome;
  $("add-shot").title = s.chrome ? "" : why(caps.screenshot) || "Screenshots need Chrome or Chromium";
  for (const item of $("export-menu").querySelectorAll("[data-export]")) {
    item.disabled = !!why(caps.pdfExport);
    item.title = why(caps.pdfExport);
  }
  const imp = $("add-slide-menu").querySelector('[data-slide="import"]');
  imp.disabled = !!why(caps.pptxImport);
  imp.title = why(caps.pptxImport);
  if (why(caps[provider])) $("conn").title = caps[provider].reason;
  // where the server runs, when it is not this Mac's usual setup: "Linux", with what is off
  const names = { claude: "Claude", codex: "OpenAI Codex", screenshot: "Screenshots", headlessLayout: "Layout without an open editor",
    pdfExport: "PDF export", pdfPages: "Pictures of PDF pages", pptxImport: "PowerPoint import",
    pptxPictures: "Pictures of PowerPoint slides", audioConvert: "Waveforms of non-WAV audio" };
  const off = Object.entries(caps).filter(([, c]) => c && c.available === false).map(([k]) => "• " + (names[k] || k));
  const reasons = [...new Set(Object.values(caps).filter((c) => c && c.available === false).map((c) => c.reason))];
  $("server-note").hidden = !caps.platform || caps.platform === "darwin";
  $("server-note").textContent = caps.label ? `Server: ${caps.label}` : "";
  $("server-note").title = off.length ? `Not available on this server:\n${off.join("\n")}\n\nWhy:\n${reasons.join("\n")}` : "";
  $("add-slide-btn").disabled = !!s.busy;
  // the deck's slide tags stopped working while PinDeck runs (at start, such a deck is refused)
  if (s.deckProblem && s.deckProblem !== shownProblem) toast(s.deckProblem, { ms: 20000 });
  shownProblem = s.deckProblem;
  renderToolbar();
}
let heldFiles = null;   // file changes that came while a text edit was open
function applyFiles({ files, manual, rev }) {
  if (rev) state.rev = rev;
  const cssOnly = files.every((f) => f.endsWith(".css"));
  if (manual && main) {
    loadMeasure();   // the visible slide already shows the hand edit
  } else if (cssOnly && main) {
    main.bridge.reloadCss(files);
    measure?.bridge?.reloadCss(files);
  } else {
    loadMain();
    loadMeasure();
  }
}
/* The deck's events: behind the front through the worker all of this browser's tabs share (browsers open at
   most 6 connections to one port; see public/events-worker.js), on its own server straight from it */
function openEvents(on, onError) {
  if (FRONT && typeof SharedWorker === "function") {
    const deck = BASE.split("/")[2];
    const w = new SharedWorker("/editor/events-worker.js", { name: "pindeck-events" });
    w.port.onmessage = ({ data: m }) => (m.type === "error" ? onError() : on[m.type]?.(m.data));
    w.port.start();
    w.port.postMessage({ subscribe: deck });
    addEventListener("pagehide", () => w.port.postMessage({ close: true }));
    addEventListener("pageshow", (e) => { if (e.persisted) w.port.postMessage({ subscribe: deck }); });
    return;
  }
  const es = new EventSource(BASE + "api/events");
  for (const [type, fn] of Object.entries(on)) es.addEventListener(type, (ev) => fn(JSON.parse(ev.data)));
  es.onerror = onError;
}
function connect() {
  openEvents({
    hello(d) {
      // reconnected after missing file events (tunnel dropped, laptop asleep, deck server restarted): show the
      // files as they are now
      if (state.rev && d.rev && d.rev !== state.rev && main) { loadMain(); loadMeasure(); }
      if (d.rev) state.rev = d.rev;
      clearChat();
      state.turns = new Map(d.turns.map((t) => [t.id, t]));
      d.chat.forEach(renderEntry);
      applyStatus(d.status);
      scrollChat();
    },
    chat(e) {
      const change = (e.kind === "turn" || e.kind === "edit") && e.turnId;
      if (change) state.turns.set(e.turnId, { id: e.turnId, undone: false });
      renderEntry(e);
      scrollChat();
    },
    "chat-update": (e) => renderEntry(e),
    import: (d) => showImportThumbs(d),
    status: (s) => applyStatus(s),
    reset() { clearChat(); state.turns.clear(); },
    undone(d) {
      const t = state.turns.get(d.turnId);
      if (t) t.undone = d.undone !== false;
      rerenderTurns();
    },
    files(d) {
      // typing in the slide: the reload waits until the edit ends, and the edit is saved against the files
      // it began with (changed meanwhile: refused, with the text to copy; see keepRejectedText)
      if (state.editing) {
        heldFiles = heldFiles ? { files: [...new Set([...heldFiles.files, ...d.files])], manual: heldFiles.manual && d.manual, rev: d.rev } : d;
        return;
      }
      applyFiles(d);
    },
    async measure({ id, index }) {
      try { api("measure-result", { id, result: await queueMeasure(index) }); }
      catch (err) { api("measure-result", { id, error: String(err) }); }
    },
    // the deck server stopped: the front opens it again and its "hello" brings the state as it is then
    gone(d) {
      $("conn").classList.remove("on");
      $("conn").title = d?.error || "The deck's server stopped; reconnecting…";
      if (d?.error) toast(d.error, { ms: 20000 });
    },
  // EventSource reconnects by itself; if the server restarted, the login cookie is stale: reload the page,
  // which asks for a new login link
  }, async () => {
    try { if ((await api("ping")).status === 403) location.reload(); } catch {}
  });
}

/* ---- New slides --------------------------------------------------------------------------------------
   Content slide, section divider or a copy of the current slide, inserted after the current one and
   modelled on the deck's own slides. The editor jumps to it and opens its title for typing. */
wireMenu("add-slide-btn", "add-slide-menu", () => {
  const cur = state.slides[state.current];
  $("add-slide-menu").querySelector('[data-slide="duplicate"] span').textContent =
    cur ? `A copy of slide ${state.current + 1} to start from` : "A copy to start from";
});
$("add-slide-menu").addEventListener("click", async (e) => {
  const item = e.target.closest("[data-slide]");
  if (!item) return;
  closeMenus();
  if (item.dataset.slide === "import") return $("import-file").click();
  if (state.busy) return toast("The assistant is working. Wait until it has finished.");
  flushNudge();
  await editChain;
  const after = state.slides[state.current]?.eid;
  const res = await api("add-slide", { kind: item.dataset.slide, after });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return toast(d.error || "Could not add the slide.");
  state.current = d.index;   // the reload opens the new slide ...
  state.pendingTitleEdit = item.dataset.slide !== "duplicate";   // ... with its title ready for typing
  try { localStorage.setItem(SLIDE_KEY, String(d.index)); } catch {}
  loadMain();
});

/* ---- Import from PowerPoint -------------------------------------------------------------------------
   The file goes to the server, which lists its slides at once and makes thumbnails in the background
   (with PowerPoint or Keynote). The chosen slides are added after the current one. */
let importing = null;   // { id, name, slides }
$("import-file").addEventListener("change", async () => {
  const file = $("import-file").files[0];
  $("import-file").value = "";
  if (!file) return;
  toast(`Reading ${file.name}…`);
  const res = await fetch(BASE + "api/import", { method: "POST", body: file,
    headers: { "x-filename": encodeURIComponent(file.name), "content-type": "application/octet-stream" } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return toast(d.error || `Could not read ${file.name}.`);
  importing = d;
  $("import-title").textContent = `Import from ${d.name}`;
  importStatus(d.render ? "Making slide pictures with PowerPoint…" : "PowerPoint or Keynote is needed for thumbnails and for diagrams; text is imported without them.");
  $("import-list").innerHTML = d.slides.map((s) => `<li><label>
      <div class="thumb"><input type="checkbox" value="${s.n}" ${s.hidden ? "" : "checked"}><span>${s.n}</span></div>
      <div class="cap"><span class="n">${s.n}</span><span class="t">${esc(s.title || s.subtitle || "Untitled")}${s.title && s.subtitle ? ` · ${esc(s.subtitle)}` : ""}</span>${s.hidden ? '<span class="tag">hidden</span>' : ""}${s.complex.length ? `<span class="tag complex" title="${esc("Only approximated: " + s.complex.join("; "))}">complex</span>` : ""}</div>
    </label></li>`).join("");
  updateImportButton();
  $("import-dialog").returnValue = "";   // Esc keeps the old value: it must not be "import" from the last time
  $("import-dialog").showModal();
});
function importStatus(msg, error = false) {
  $("import-status").textContent = msg;
  $("import-status").classList.toggle("error", error);
}
const importChecks = () => [...$("import-list").querySelectorAll("input[type=checkbox]")];
function updateImportButton() {
  const n = importChecks().filter((c) => c.checked).length;
  // The assistant's help with what the import only approximates (diagrams as pictures, lost build steps, ...)
  const complex = importChecks().filter((c) => c.checked && importing.slides.find((s) => s.n === +c.value)?.complex.length).length;
  $("import-refine-wrap").hidden = !complex;
  $("import-refine-label").textContent = complex === 1 ? "Then ask the assistant to improve the complex slide"
    : `Then ask the assistant to improve the ${complex} complex slides`;
  $("import-go").textContent = n === 1 ? "Import 1 slide" : `Import ${n} slides`;
  $("import-go").disabled = !n;
  $("import-all").textContent = n === importChecks().length ? "Select none" : "Select all";
}
$("import-list").addEventListener("change", updateImportButton);
$("import-all").addEventListener("click", () => {
  const all = importChecks().some((c) => !c.checked);
  importChecks().forEach((c) => { c.checked = all; });
  updateImportButton();
});
function showImportThumbs(ev) {
  if (!importing || ev.id !== importing.id) return;
  if (ev.error) return importStatus(`No slide pictures (${ev.error}). Text is imported; diagrams are left out.`, true);
  importStatus(`Slide pictures by ${ev.app || "PowerPoint"}. Hidden slides are not selected.`);
  for (const c of importChecks()) {
    const img = new Image();
    img.alt = "";
    img.src = `${BASE}api/import-thumb?id=${importing.id}&n=${c.value}`;
    c.closest(".thumb").append(img);
  }
}
$("import-dialog").addEventListener("close", async () => {
  if ($("import-dialog").returnValue !== "import" || !importing) return;
  const slides = importChecks().filter((c) => c.checked).map((c) => +c.value);
  if (state.busy) return toast("The assistant is working. Wait until it has finished.");
  flushNudge();
  await editChain;
  toast(`Importing ${slides.length} slide${slides.length > 1 ? "s" : ""}…`, { ms: 60000 });
  const refine = !$("import-refine-wrap").hidden && $("import-refine").checked;
  const res = await api("import-apply", { id: importing.id, slides, after: state.slides[state.current]?.eid, refine });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return toast(d.error || "The import failed.");
  toast(`Imported ${d.count} slide${d.count > 1 ? "s" : ""}.` + (d.missing ? ` ${d.missing} diagram${d.missing > 1 ? "s" : ""} could not be pictured (no PowerPoint or Keynote).` : "") +
    (d.refining ? ` The assistant is improving ${d.refining === 1 ? "the complex slide" : `${d.refining} complex slides`}.` : ""), { ms: 5000 });
  state.current = d.index;
  try { localStorage.setItem(SLIDE_KEY, String(d.index)); } catch {}
  loadMain();
});

/* ---- Model and effort --------------------------------------------------------------------------------- */
let modelCatalog = {};
let showAllModels = false;
try { showAllModels = localStorage.getItem("editor.showAllModels") === "true"; } catch {}
const providerLabel = p => p === "codex" ? "OpenAI / ChatGPT" : "Claude";
function modelLabel(s) {
  const st = s.settings || {};
  const model = (s.models?.[st.provider]?.models || []).find(m => m.id === st.model);
  return model?.label || st.model || providerLabel(st.provider);
}
function renderModelMenu() {
  const st = state.status.settings || {};
  modelCatalog = state.status.models || modelCatalog;
  const groups = ["claude", "codex"].map(provider => {
    const group = modelCatalog[provider] || {};
    const visible = (group.models || []).filter(m => showAllModels || m.curated || (st.provider === provider && st.model === m.id));
    return `<div class="group">${providerLabel(provider)}</div>` +
      visible.map(m => `<button class="opt" role="menuitemradio" aria-checked="${st.provider === provider && st.model === m.id}"
        data-provider="${provider}" data-model="${esc(m.id)}"><span class="tick">${st.provider === provider && st.model === m.id ? "✓" : ""}</span>
        <strong>${esc(m.label)}${!showAllModels && !m.curated ? " (current)" : ""}</strong><span class="d muted">${esc(m.description)}</span></button>`).join("") +
      (!visible.length ? `<div class="muted">${esc(group.error || (group.models?.length ? "No models match this filter. Choose Show all available models below." : "No models available. Try Refresh models."))}</div>` : "");
  });
  $("model-menu").innerHTML = groups.join('<div class="sep"></div>') +
    `<div class="sep"></div><button data-model-filter>${showAllModels ? 'Show curated models' : 'Show all available models'}</button><button data-refresh>Refresh models</button>`;
}
const effortLabel = value => ({ none: "None", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high", max: "Max", ultra: "Ultra" }[value] || value);
function renderEffortMenu() {
  const st = state.status.settings || {};
  const model = state.status.models?.[st.provider]?.models?.find(m => m.id === st.model);
  const efforts = model?.efforts || [];
  $("effort").textContent = efforts.length ? effortLabel(st.effort) || "Effort" : "Effort N/A";
  $("effort-btn").disabled = !!state.status.busy || !efforts.length;
  $("effort-btn").title = efforts.length ? `Reasoning effort: ${effortLabel(st.effort)}` : "No adjustable reasoning effort reported for this model";
  $("effort-menu").innerHTML = '<div class="group">Reasoning effort</div>' + efforts.map(value => {
    const hint = value === model.defaultEffort ? (model.effortDefaultSource === "provider" ? "Model default" : "PinDeck default") : "";
    const description = model.effortDescriptions?.[value] || "";
    return `<button class="opt" role="menuitemradio" aria-checked="${st.effort === value}" data-effort="${esc(value)}"><span class="tick">${st.effort === value ? "✓" : ""}</span><strong>${esc(effortLabel(value))}${hint ? ` · ${hint}` : ""}</strong>${description ? `<span class="d muted">${esc(description)}</span>` : ""}</button>`;
  }).join("");
}
wireMenu("effort-btn", "effort-menu", renderEffortMenu);
$("effort-menu").addEventListener("click", async e => {
  const button = e.target.closest("[data-effort]");
  if (!button || state.status.busy) return;
  e.stopPropagation();
  try { await setModelChoice({ effort: button.dataset.effort }); } catch (e) { toast(e.message); }
});
wireMenu("model-btn", "model-menu", renderModelMenu);
async function setModelChoice(choice) {
  const res = await api("settings", choice);
  const d = await res.json().catch(() => ({}));
  if (!res.ok) return toast(d.error || "Could not change the model.");
  state.status.settings = d.settings; renderModelMenu(); renderEffortMenu(); $("model").textContent = modelLabel(state.status);
}
let pendingModel = null;
$("model-menu").addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) return;
  e.stopPropagation();
  if (b.hasAttribute("data-model-filter")) {
    showAllModels = !showAllModels;
    try { localStorage.setItem("editor.showAllModels", String(showAllModels)); } catch {}
    renderModelMenu(); return;
  }
  if (b.hasAttribute("data-refresh")) {
    b.disabled = true;
    try { const r = await api("models"); if (!r.ok) throw new Error("Model discovery failed."); state.status.models = await r.json(); renderModelMenu(); renderEffortMenu(); }
    catch (e) { toast(e.message); b.disabled = false; }
    return;
  }
  if (state.status.busy) return;
  const st = state.status.settings || {};
  const choice = b.dataset.effort ? { effort: b.dataset.effort } : { provider: b.dataset.provider, model: b.dataset.model };
  if (choice.provider && choice.provider !== st.provider) {
    pendingModel = choice;
    $("provider-switch-title").textContent = `Switch to ${providerLabel(choice.provider)}?`;
    $("provider-switch").returnValue = "";
    $("provider-switch").showModal();
  } else { try { await setModelChoice(choice); } catch (e) { toast(e.message); } }
});
$("provider-switch").addEventListener("close", async () => {
  const choice = pendingModel; pendingModel = null;
  const handover = $("provider-switch").returnValue;
  if (!choice || !["summary", "fresh"].includes(handover)) return;
  try { await setModelChoice({ ...choice, handover }); } catch (e) { toast(e.message); }
});

/* ---- Delete the selected element ---------------------------------------------------------------------
   Asks first. Lists the files the element uses; those nothing else in the deck uses can be deleted
   with it (ticked by default). Undo brings back the element and the files. */
let deleting = false;
async function requestDelete(eid) {
  if (deleting || !eid) return;
  if (state.busy) return toast("The assistant is working. Wait until it has finished.");
  deleting = true;
  try {
    flushNudge();
    await editChain;
    const res = await api(`delete-info?${new URLSearchParams({ eid })}`);
    const info = await res.json().catch(() => ({}));
    if (!res.ok) return toast(info.error || "Cannot delete this element.");
    const name = info.eid.replace(/^[^/]+\//, "/");
    const slide = state.slides.findIndex((s) => info.eid === s.eid || info.eid.startsWith(s.eid + "/"));
    const isFig = info.tag.startsWith("figure") && info.eid !== eid;
    $("delete-title").textContent = isFig ? "Delete this figure?" : `Delete ${name}?`;
    $("delete-what").textContent = `${isFig ? `The picture and its caption (${name})` : info.tag}` +
      (slide >= 0 ? ` on slide ${slide + 1}` : "") + " will be removed from the slide.";
    $("delete-files").innerHTML = info.files.map((f, i) => f.usedElsewhere
      ? `<div class="file kept"><span>📄</span><span><code>${esc(f.rel)}</code>
           <span class="why">${f.usedBy?.length ? `Also used by ${esc(f.usedBy.join(", "))}` : "Still used elsewhere in the deck"}, so it is kept.</span></span></div>`
      : `<label class="file"><input type="checkbox" data-file="${esc(f.rel)}" checked>
           <span>Also delete <code>${esc(f.rel)}</code> (${fmtBytes(f.bytes)})
           <span class="why">Not used anywhere else in the deck, or by the other decks in its folder.</span></span></label>`).join("");
    const choice = await new Promise((resolve) => {
      const d = $("delete-dialog");
      d.addEventListener("close", () => resolve(d.returnValue), { once: true });
      d.returnValue = "cancel";
      d.showModal();
    });
    if (choice !== "delete") return;
    const files = [...$("delete-files").querySelectorAll("input[data-file]:checked")].map((c) => c.dataset.file);
    const r2 = await api("delete", { eid, files });
    const d2 = await r2.json().catch(() => ({}));
    if (!r2.ok) return toast(d2.error || "Could not delete the element.");
    main?.bridge.deselect();
    state.sel = null;
    renderPinTray();
    toast(`Deleted ${name}${d2.files.length ? ` and ${d2.files.length === 1 ? d2.files[0] : d2.files.length + " files"}` : ""}. ⌘Z to undo.`, { ms: 4500 });
  } finally {
    deleting = false;
  }
}

/* ---- Attachments: figures, audio and PDFs for the next message ----------------------------------------
   Files are uploaded at once into <deck>/figures/ (PDFs, reading material for the assistant, outside the deck). Images get their pixel size, audio its duration and a
   waveform SVG (bars, viewBox 1000 x 120, like the template's audio player), all computed here in the
   browser. Removing an attachment before sending deletes the uploaded file again. */
let attachments = [], attachSeq = 0;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i, AUDIO_EXT = /\.(wav|mp3|ogg|oga|m4a|aac|flac|opus)$/i;
const kindOf = (f) => (f.type.startsWith("image/") || IMAGE_EXT.test(f.name) ? "image"
  : f.type.startsWith("audio/") || AUDIO_EXT.test(f.name) ? "audio"
  : f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "pdf" : null);
const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} kB`);

async function uploadBlob(blob, name) {
  const res = await fetch(BASE + "api/upload", { method: "POST", body: blob,
    headers: { "x-filename": encodeURIComponent(name), "content-type": blob.type || "application/octet-stream" } });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || `Could not upload ${name}.`);
  return d;
}
function imageSize(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img.naturalWidth ? { width: img.naturalWidth, height: img.naturalHeight } : {});
    img.onerror = () => resolve({});
    img.src = URL.createObjectURL(file);
  });
}
async function audioInfo(file) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const audio = await ctx.decodeAudioData(await file.arrayBuffer());
    ctx.close();
    const n = 220, W = 1000, H = 120, len = audio.length;
    const chans = [...Array(audio.numberOfChannels)].map((_, c) => audio.getChannelData(c));
    const peaks = [];
    for (let i = 0; i < n; i++) {
      let m = 0;
      const a = Math.floor((i * len) / n), b = Math.floor(((i + 1) * len) / n);
      for (const ch of chans) for (let j = a; j < b; j += 4) m = Math.max(m, Math.abs(ch[j]));
      peaks.push(m);
    }
    const top = Math.max(...peaks) || 1;
    const bars = peaks.map((p, i) => {
      const h = Math.max(3, (p / top) * (H - 10));
      return `<rect x="${(i * W / n + 1.2).toFixed(1)}" y="${((H - h) / 2).toFixed(1)}" width="${(W / n - 2.4).toFixed(1)}" height="${h.toFixed(1)}" rx="2"/>`;
    }).join("");
    return { meta: { duration: audio.duration, sampleRate: audio.sampleRate, channels: audio.numberOfChannels },
      svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none"><g fill="#6B7785">${bars}</g></svg>` };
  } catch {
    return { meta: {}, svg: null };   // a format the browser cannot decode: attach it without waveform
  }
}
async function attachFile(file, droppedAt) {
  const name = file.name && file.name !== "image.png" ? file.name : `pasted-image-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
  const kind = kindOf({ type: file.type || "", name });
  if (!kind) return toast(`${file.name || "This file"} is not an image, audio file or PDF.`);
  const a = { id: ++attachSeq, name, kind, status: "uploading", bytes: file.size, droppedAt,
    preview: kind === "image" ? URL.createObjectURL(file) : null };
  attachments.push(a);
  renderAttachments();
  try {
    let wave = null;
    if (kind === "image") Object.assign(a, await imageSize(file));
    else if (kind === "audio") { const info = await audioInfo(file); Object.assign(a, info.meta); wave = info.svg; }
    Object.assign(a, await uploadBlob(file, name));
    if (wave) {
      const w = await uploadBlob(new Blob([wave], { type: "image/svg+xml" }), a.path.split("/").pop().replace(/\.[^.]+$/, "") + "-wave.svg");
      a.waveform = w.path;
    }
    a.status = attachments.includes(a) ? "ready" : "removed";
    if (a.status === "removed") api("upload-remove", { path: a.path, waveform: a.waveform });   // removed while uploading
  } catch (err) {
    a.status = "error";
    a.error = String(err.message || err);
  }
  renderAttachments();
}
function attachFiles(files, droppedAt) { [...files].forEach((f) => attachFile(f, droppedAt)); }
function removeAttachment(id) {
  const a = attachments.find((x) => x.id === id);
  if (!a) return;
  attachments = attachments.filter((x) => x !== a);
  if (a.status === "ready") api("upload-remove", { path: a.path, waveform: a.waveform });
  if (a.preview) URL.revokeObjectURL(a.preview);
  renderAttachments();
}
function clearAttachments() {
  attachments.forEach((a) => a.preview && URL.revokeObjectURL(a.preview));
  attachments = [];
  renderAttachments();
}
function renderAttachments() {
  const shot = state.shot ? `<span class="att" title="A screenshot is taken when you send the message">
      <span class="icon-box">📷</span><span class="meta"><b>Screenshot</b><span>slide ${state.shot.index + 1}, with its pins</span></span>
      <button class="x" data-unshot aria-label="Remove the screenshot">×</button></span>` : "";
  $("attach-tray").innerHTML = shot + attachments.map((a) => {
    const info = a.status === "uploading" ? "uploading…" : a.status === "error" ? a.error
      : [a.kind === "image" && a.width ? `${a.width} × ${a.height}` : "", a.duration ? `${a.duration.toFixed(1)} s` : "",
         a.pages ? `${a.pages} page${a.pages > 1 ? "s" : ""}` : "",
         fmtBytes(a.bytes), a.droppedAt ? `dropped on slide ${a.droppedAt.slide.index + 1}` : ""].filter(Boolean).join(" · ");
    return `<span class="att ${a.status}" title="${esc(a.path || a.name)}">
      ${a.kind === "image" ? `<img class="thumb" src="${a.preview || BASE + "deck/" + esc(a.path)}" alt="">` : `<span class="icon-box">${a.kind === "pdf" ? "📄" : "🔊"}</span>`}
      <span class="meta"><b>${esc(a.path ? a.path.split("/").pop() : a.name)}</b><span>${esc(info)}</span></span>
      ${a.status === "uploading" ? '<span class="spinner"></span>' : ""}
      <button class="x" data-unattach="${a.id}" aria-label="Remove ${esc(a.name)}">×</button></span>`;
  }).join("");
}
$("attach-tray").addEventListener("click", (e) => {
  const x = e.target.closest("[data-unattach]");
  if (x) removeAttachment(+x.dataset.unattach);
  if (e.target.closest("[data-unshot]")) { state.shot = null; renderAttachments(); }
});
/* The + menu in the composer: a file, or a screenshot of the current slide */
wireMenu("add-btn", "add-menu");
$("add-menu").addEventListener("click", (e) => {
  const item = e.target.closest("[data-add]");
  if (!item || item.disabled) return;
  closeMenus();
  if (item.dataset.add === "file") return $("file-input").click();
  const s = state.slides[state.current];
  if (s) { state.shot = { index: state.current, eid: s.eid }; renderAttachments(); }
});
$("file-input").onchange = () => { attachFiles($("file-input").files); $("file-input").value = ""; };
$("input").addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  attachFiles(files);
});
// drag and drop onto the chat (the slide frame forwards its own drops through the bridge)
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");
document.addEventListener("dragenter", (e) => { if (hasFiles(e)) { dragDepth++; $("drop-hint").hidden = false; } });
document.addEventListener("dragleave", (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; $("drop-hint").hidden = true; } });
document.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener("drop", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();   // never let the browser open the file instead
  dragDepth = 0;
  $("drop-hint").hidden = true;
  attachFiles(e.dataTransfer.files);
});

/* ---- Start ------------------------------------------------------------------------------------------- */
loadMain();
loadMeasure();
renderPinTray();
connect();
