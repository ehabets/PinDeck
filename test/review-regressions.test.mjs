import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assignEids, findSlides, insertSlide, moveSlide, parse } from '../lib/eids.mjs';

const source = (file) => fs.readFileSync(new URL(file, import.meta.url), 'utf8');
const server = source('../server.mjs');
const editor = source('../public/editor.js');

// Exercise the actual route with controlled timers, without starting Claude or waiting five seconds.
function stopHarness(overrides = {}) {
  const state = { busy: true, turn: {}, ...overrides }, timers = [];
  let stops = 0, interrupts = 0;
  const context = vm.createContext({
    state, p: '/api/stop', req: { method: 'POST' }, res: {}, json() {},
    starting: null,
    finishTurn() { state.busy = false; },
    session: { running: true, interrupt() { interrupts++; }, stop() { stops++; } },
    setTimeout(fn) { timers.push(fn); },
  });
  const route = server.slice(server.indexOf('    if (p === "/api/stop"'), server.indexOf('    if (p === "/api/new-chat"'));
  vm.runInContext(`(() => { ${route} })()`, context);
  return { state, expire: () => timers.forEach((fn) => fn()), counts: () => ({ stops, interrupts }) };
}

test('Stop does not terminate a subsequent turn', () => {
  const h = stopHarness();
  h.state.busy = false;
  h.state.turn = null;
  h.state.turn = {};
  h.state.busy = true;
  h.expire();
  assert.deepEqual(h.counts(), { stops: 0, interrupts: 1 });
});

test('Stop still terminates the original unresponsive turn', () => {
  const h = stopHarness();
  h.expire();
  assert.deepEqual(h.counts(), { stops: 1, interrupts: 1 });
});

test('Stop cancels message preparation before a backend turn starts', () => {
  const controller = new AbortController();
  const h = stopHarness({ turn: null, preparing: { cancelled: false, controller } });
  assert.equal(h.state.preparing.cancelled, true);
  assert.equal(controller.signal.aborted, true, "the screenshot's Chrome is stopped too");
  assert.deepEqual(h.counts(), { stops: 0, interrupts: 0 });
});

function notesHarness() {
  const listeners = {}, elements = {
    notes: { value: '', addEventListener: (event, fn) => { listeners[event] = fn; } },
    'notes-status': {},
  };
  const stored = { one: 'Original notes', two: 'Second slide notes' }, saves = [];
  let fail = null, failLoad = false;
  const context = vm.createContext({
    $: (id) => elements[id], document: { activeElement: null },
    state: { slides: [{ eid: 'one' }, { eid: 'two' }], current: 0 },
    editChain: Promise.resolve(), flushNudge() {}, toast() {}, setTimeout() {}, URLSearchParams,
    async api(p, body) {
      if (body) {
        saves.push(body);
        if (fail === 'network') throw new Error('offline');
        if (fail === 'rejected') return { ok: false, json: async () => ({ error: 'Claude is working.' }) };
        stored[body.eid] = body.text;
        return { ok: true, json: async () => ({}) };
      }
      if (failLoad) return { ok: false, json: async () => ({ error: 'Not found' }) };
      const eid = new URLSearchParams(p.split('?')[1]).get('eid');
      return { ok: true, json: async () => ({ text: stored[eid], html: false }) };
    },
  });
  vm.runInContext(editor.slice(editor.indexOf('function queueEdit'), editor.indexOf('function postEdit')), context);
  const code = editor.slice(editor.indexOf('const notesBox ='), editor.indexOf('notesBox.addEventListener("keydown"'));
  vm.runInContext(code, context);
  return {
    box: elements.notes, stored, saves,
    load: () => vm.runInContext('loadNotes()', context),
    blur: () => listeners.blur(),
    fail: (kind) => { fail = kind; },
    failLoad: (on) => { failLoad = on; },
    breakQueue: () => { context.editChain = Promise.reject(new Error('An earlier drag failed')); },
    navigate: () => { context.state.current = 1; },
  };
}

for (const failure of ['rejected', 'network']) {
  test(`Notes survive a ${failure} save and retry against their original slide`, async () => {
    const h = notesHarness();
    await h.load();
    h.box.value = 'My unsaved draft';
    h.fail(failure);
    h.navigate();
    await h.blur();
    await h.load(); // navigation and background reloads must also preserve a failed draft
    assert.equal(h.box.value, 'My unsaved draft');
    assert.equal(h.stored.one, 'Original notes');
    h.fail(null);
    await h.blur();
    await h.load();
    assert.equal(h.stored.one, 'My unsaved draft');
    assert.equal(h.stored.two, 'Second slide notes');
    assert.equal(h.box.value, 'Second slide notes');
    assert.equal(h.saves.at(-1).eid, 'one');
  });
}

test('Successful note saves allow navigation to the next slide', async () => {
  const h = notesHarness();
  await h.load();
  h.box.value = 'Updated notes';
  h.navigate();
  await h.blur();
  await h.load();
  assert.equal(h.stored.one, 'Updated notes');
  assert.equal(h.box.value, 'Second slide notes');
});

test('A failed notes load does not leave the previous slide\'s notes attached', async () => {
  const h = notesHarness();
  await h.load();
  h.navigate();
  h.failLoad(true);
  await h.load();
  assert.equal(h.box.value, '');
  assert.equal(h.box.disabled, true);
  h.box.value = 'Typed into the wrong slide';
  await h.blur();
  assert.equal(h.stored.one, 'Original notes');
  assert.equal(h.saves.length, 0);
  h.failLoad(false);
  await h.load();
  assert.equal(h.box.disabled, false);
  assert.equal(h.box.value, 'Second slide notes');
});

test('A notes save still runs after an earlier edit in the queue failed', async () => {
  const h = notesHarness();
  await h.load();
  h.box.value = 'Saved despite the failed drag';
  h.breakQueue();
  await h.blur();
  assert.equal(h.stored.one, 'Saved despite the failed drag');
});

test('Hand edits keep saving after one fails with a network error', async () => {
  const toasts = [], saved = [];
  let calls = 0;
  const context = vm.createContext({
    toast: (msg) => toasts.push(msg), loadMain() {},
    async api(p, body) {
      if (calls++ === 0) throw new Error('offline');   // only the first save fails
      saved.push(body.label);
      return { ok: true, json: async () => ({}) };
    },
  });
  vm.runInContext(editor.slice(editor.indexOf('let editChain ='), editor.indexOf('function flushNudge')), context);
  const first = vm.runInContext('postEdit({}, "Drag")', context);
  await vm.runInContext('postEdit({}, "Resize")', context);
  await first;
  assert.deepEqual(saved, ['Resize']);
  assert.deepEqual(toasts, ['Could not save the change.']);
});

const verticalDeck = `<div class="slides">
<section data-eid="intro"><h2>Intro</h2></section>
<section data-eid="stack">
  <section data-eid="a"><h2>Vertical A</h2></section>
  <section data-eid="b"><h2>Vertical B</h2></section>
</section>
</div>`;
const ids = (html) => findSlides(parse(html)).map((s) => s.attrs['data-eid'].value);

test('Vertical stacks have the same leaf-slide order before and after assigning ids', () => {
  assert.deepEqual(ids(verticalDeck), ['intro', 'a', 'b']);
  const assigned = assignEids(verticalDeck).html;
  assert.deepEqual(ids(assigned), ['intro', 'a', 'b']);
  assert.equal(assignEids(assigned).changed, false);
});

test('Duplicating a vertical slide returns its visible insertion index', () => {
  const result = insertSlide(verticalDeck, 'duplicate', 'a');
  const html = assignEids(result.html).html;
  assert.equal(result.index, 2);
  const slides = findSlides(parse(html));
  assert.equal(slides.length, 4);
  assert.equal(slides[result.index].parent.attrs['data-eid'].value, 'stack');
  assert.equal(slides[result.index + 1].attrs['data-eid'].value, 'b');
});

test('New slide ids do not collide with existing stack ids', () => {
  const html = assignEids('<div class="slides"><section data-eid="example"><section><h2>Example</h2></section></section></div>').html;
  assert.notEqual(ids(html)[0], 'example');
  assert.equal(assignEids(html).changed, false);
});

test('Moving a horizontal slide to the end places it after the final vertical stack', () => {
  const moved = moveSlide(verticalDeck, 'intro', null);
  assert.equal(moved.changed, true);
  assert.equal(moved.index, 2);
  assert.deepEqual(ids(moved.html), ['a', 'b', 'intro']);
  const intro = findSlides(parse(moved.html)).at(-1);
  assert.equal(intro.parent.attrs.class.value, 'slides');
  assert.match(moveSlide(verticalDeck, 'a', 'intro').error, /vertical stack/);
});

test('assignEids stays fast on a large deck without ids, and numbers repeated names in order', () => {
  const slide = '<section><h2>Same title</h2><ul>' + '<li>point <strong>bold</strong></li>'.repeat(12) + '</ul></section>\n';
  const html = `<html><body><div class="reveal"><div class="slides">\n${slide.repeat(1000)}</div></div></body></html>`;
  const t0 = Date.now();
  const r = assignEids(html);
  assert.ok(Date.now() - t0 < 3000, `${Date.now() - t0} ms for 1000 slides`);
  assert.equal(r.assigned.length, 1000 * 15);   // the slide, its h2, ul and 12 li
  const eids = [...r.html.matchAll(/<section data-eid="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(eids.slice(0, 3), ['same-title', 'same-title-2', 'same-title-3']);
  assert.equal(new Set(eids).size, 1000);
  assert.match(r.html, /<li data-eid="same-title\/li-12">/);
});
