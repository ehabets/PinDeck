/* One event stream for all of this browser's PinDeck tabs on one port, behind the front.

   Browsers open at most 6 connections to one host and port, and each editor tab held one open for its deck's
   events, so a sixth tab never loaded and the others stalled. The tabs now share this worker's stream: each
   tab (a port here) names its deck, and the front (front.mjs, /events) passes that deck's events on, marked
   with the tab. Each tab still gets its deck's events as if it had its own stream, starting with "hello". */

const tabs = new Map();   // tab id -> { port, deck }
const stream = crypto.randomUUID?.() || String(Math.random()).slice(2) + String(Date.now());
let source = null, seq = 0;

const tell = (body) => fetch("/events/subscribe", { method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ stream, ...body }) }).catch(() => {});

function open() {
  source = new EventSource(`/events?stream=${encodeURIComponent(stream)}`);
  // "ready" comes first on every (re)connect: the front has a new stream, with no decks yet
  source.addEventListener("ready", () => { for (const [tab, t] of tabs) tell({ tab, deck: t.deck, on: true }); });
  source.addEventListener("deck", (ev) => {
    const m = JSON.parse(ev.data);
    tabs.get(m.tab)?.port.postMessage({ type: m.type, data: m.data });
  });
  source.onerror = () => { for (const t of tabs.values()) t.port.postMessage({ type: "error" }); };
}

onconnect = (e) => {
  const port = e.ports[0];
  let tab = null;
  const leave = () => {
    if (!tab) return;
    tabs.delete(tab);
    tell({ tab, on: false });
    tab = null;
    if (!tabs.size) { source?.close(); source = null; }
  };
  port.onmessage = ({ data }) => {
    if (data?.subscribe) {
      leave();
      tab = String(++seq);
      tabs.set(tab, { port, deck: String(data.subscribe) });
      if (!source) open();
      else if (source.readyState === EventSource.OPEN) tell({ tab, deck: String(data.subscribe), on: true });
    }
    if (data?.close) leave();
  };
  port.start();
};
