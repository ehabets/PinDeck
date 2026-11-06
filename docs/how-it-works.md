# How it works

[← README](../README.md)

## How it works

* **One port, a server per deck.** `pindeck` starts the front (`front.mjs`): it holds the port, the login and the deck list, and serves each open deck at `/d/<deck>/`. Every deck runs its own deck server (`server.mjs`) on a private port of 127.0.0.1 with a token of its own; the front passes each request on with that token. A deck's server, its assistant and its undo history are those of that deck alone. The editor tabs of a browser share one event stream from the front (a shared worker), since browsers open only six connections to one port; if a deck server stops, the front opens the deck again and the tab catches up. Each PinDeck process notes its address in `~/.pindeck-v3/servers/` for `pindeck login` and `cli.mjs`, and a deck server holds its deck's `open.json`, so a deck opens in one PinDeck only.
* **Deck pages are sandboxed.** The deck page in the editor's frames runs with a sandbox policy in an origin of its own, at a per-run address that serves the deck's files and nothing else. A script in a deck, a template, or written by the assistant cannot reach the login cookie, the API, the chat or other decks. The editor and its bridge in the slide frame talk by `postMessage`. Present opens the same address on `localhost` without the sandbox, so reveal.js's speaker view (`S`) works: browsers treat `localhost` and `127.0.0.1` as different sites, PinDeck takes no login and no cookie there, and the tab is opened without a handle on the editor. Headless Chrome (screenshots, layout, PDFs) does not log in at all; the page it asks for is served without the sandbox, which its screenshot and print modes cannot handle, only with a key made for that one run.
* **Element ids.** On start, the server gives every slide and every visible element a readable `data-eid` attribute (`summary`, `summary/callout`, `summary/li-2`). Only the attribute is inserted; the rest of the file stays as it was. A backup of the file before the first change is kept in `~/.pindeck-v3/decks/<deck>/backups/`. Ids survive edits, so pins, layout reports and the assistant all name the same element.
* **Hand edits.** A move is stored as the CSS `translate` property and a resize as `width`/`height`, inline on the element in `index.html`. `translate` moves an element without changing the layout around it, for elements in the flow and absolutely positioned ones alike. Only that one style attribute is rewritten; the rest of the file stays as it was. The assistant gets a note about each hand edit. Brand-locked elements (footer, logos) cannot be selected.
* **Text edits.** While you type, the element holds its source HTML from `index.html`, not the rendered slide, so math stays TeX and nothing that KaTeX or the deck script generates ends up in the file. On save only that element's content is replaced. Browser editing artefacts are cleaned up: `<b>`/`<i>` become `<strong>`/`<em>`, styled spans from formatting are removed, trailing `<br>`s dropped.
* **Pins.** A pin records the element id, its box in slide coordinates (1280 x 720), the click point, the clicked word and, in tables, the cell. Pins on the footer or logos are marked as locked.
* **Layout instead of screenshots.** With each message the editor measures the current slide and every pinned slide in your browser: position and size of every element, font sizes, and issues (content below the footer rule, outside the slide, overlaps, clipped text). The assistant gets this as text. To check its own work it runs the PinDeck CLI's `layout <slide>...` (`--issues` for the issues only). Screenshots are only taken when you tick the box or the assistant needs a visual judgement.
* **One selected backend.** Claude runs as a long-lived `claude -p` stream-json process; Codex runs as a local app-server over stdio. Both run in the deck folder under your own login, with the instructions from `lib/system-prompt.md` and the deck's `CLAUDE.md` and `AGENTS.md`. Codex model and effort changes reuse the active thread writer and apply to the next turn. Claude changes and provider switches prepare a replacement process before retiring the old one. Events from replaced sessions are ignored.
* **Permissions.** The assistant may read the deck folder, its screenshots, attached PDFs and asset roots, edit and create files in the deck folder, and run the editor's CLI. Nothing else: no other commands, and no edits to `brand.css`, `vendor/`, `.git/` or, for a named deck file, the other decks in its folder. Claude Code loads no settings files and no MCP servers, so no allow rule in your own, the deck's or a parent folder's settings widens this. Codex has no shell and no file access of its own: it reads and edits through PinDeck's own tools, which apply the same rules and refuse symlinks out of the deck. If `brand.css` changes during a turn anyway, the server restores it and says so in the chat. Subfolders that hold a deck of their own count as other decks.
* **Undo.** The server keeps a copy of every file a change touched, from before and after it (an AI turn, which may change, create or delete several files of the deck, or a hand edit). Files over 2 MB are not copied: the chat says when a turn changed one, and Undo leaves it as it is. Hidden files, `vendor/` and `export/` are not part of undo. Undo and redo walk that history and tell the assistant on the next message. They first check that the files are still as that change left them; if something else changed them since, they do nothing and say which file differs, rather than overwrite that work. Decks that share a folder share its files: while another deck's assistant works there too, a turn keeps only the files its own assistant said it wrote, and says which it left out.
* **Saving.** Every file PinDeck writes into the deck is written to a temporary file next to it and then renamed into place, so other programs never see half a file. Each change from the editor carries the revision of the files it was made on; if the files have changed since, the change is refused, the slide reloads, and edited text can be copied from the message to type in again.

## Files

| File | Purpose |
|---|---|
| `front.mjs` | What `pindeck` starts (127.0.0.1 only, random token per run, one-time login links): the login, the deck list and one deck server per open deck at `/d/<deck>/`; `login`. |
| `server.mjs` | The server for one deck: UI, deck files, events, backend session, undo, CLI endpoints. Behind the front, or on its own (`node server.mjs <deck>`). |
| `lib/login.mjs`, `lib/deck-target.mjs`, `lib/deck-list.mjs` | Login links and cookies, which deck a path names (and its state folder), and the decks the menu lists. |
| `lib/servers.mjs` | The PinDecks running for this user, and which one serves a deck (`pindeck login`, `cli.mjs`). |
| `cli.mjs` | `layout`, `shot`, `slides`, `pdf handout` / `pdf presentation` and `pdf-figure` commands for the backends (and for you), and `git-setup`. |
| `public/` | The editor page; `bridge.js`, which is injected into the deck in edit mode (never saved to it); `events-worker.js`, the event stream the tabs of a browser share. |
| `lib/pptx.mjs`, `lib/zip.mjs`, `lib/xml.mjs` | Reading `.pptx` files (no dependencies): slides, text, shapes and their positions, notes. |
| `lib/pptx-import.mjs` | Turns PowerPoint slides into slides of the deck: figures, tables, build steps, audio, layout, HTML in the deck's style. |
| `lib/waveform.mjs` | Waveform SVGs for imported audio. |
| `lib/omml.mjs` | PowerPoint equations (Office Math) to TeX. |
| `lib/pptx-render.mjs`, `lib/pdf-render.jxa.js` | Slide and PDF pictures: PowerPoint or Keynote (macOS) or LibreOffice (Linux) saves a PDF; macOS PDFKit or Poppler renders pages and regions of it. |
| `lib/pdf.mjs` | PDF export: reveal.js print layout in headless Chrome, then print to PDF. |
| `lib/eids.mjs` | Adds the `data-eid` attributes by editing the HTML as text. |
| `lib/claude.mjs`, `lib/codex.mjs`, `lib/agent-process.mjs` | Backend adapters and JSON-line transport. |
| `lib/models.mjs`, `lib/agent-tools.mjs` | Model/settings normalization, handover, and restricted Codex tools. |
| `lib/capabilities.mjs` | What this server can do on this system (macOS, Linux), for the editor, the API, the CLI and the assistant. |
| `lib/deck-files.mjs` | Atomic writes and the revision of the deck's files. |
| `lib/system-prompt.md` | What the assistant is told about the editor. |
| `CONTRIBUTING.md` | How to report bugs and contribute. |
| `docs/` | Images for this README. |
| `LICENSE` | MIT. |

## Current Limitations

* reveal.js decks, and decks that name their slides with `<meta name="pindeck:slides">` (see [Decks made without reveal.js](preparing-decks.md#decks-made-without-revealjs)). Any other deck made with another framework (Marp, Slidev, impress.js, remark, Spectacle, Shower, deck.js, bespoke.js) is recognised and refused with its name before PinDeck changes anything.
* Quarto: the rendered HTML must be next to its source (no `output-dir` in `_quarto.yml`), and only reveal.js output is supported. A render takes a few seconds; the slide shows the previous render meanwhile.
* Text inside inline SVG diagrams cannot be edited in place; pin it and ask the assistant.
* Parts of an inline SVG move with the whole SVG; inline text (bold, spans) moves with its block.
* No indenting or outdenting of bullets with `Tab` yet, and `Backspace` at the start of a bullet does not merge it with the one above; ask the assistant for those.
* Moves are offsets (`translate`), so the space an element came from stays reserved. Ask the assistant to turn hand edits into proper CSS when a layout should really change.
* The undo history lives on the server and starts fresh when PinDeck restarts, or when a deck closes after 30 minutes without an open editor.
* One writer at a time: PinDeck is not made for editing the same deck from two editors or tools at once.
* A deck's own scripts run sandboxed in the editor: they cannot use `localStorage`, cookies or the editor page. A deck that needs them for its slides to work should catch the error. In Present they can, on `localhost`, where every deck of one PinDeck shares the same `localStorage`.
* Linux: pictures of PDF pages and PowerPoint slides, and waveforms of non-WAV audio, need Poppler, LibreOffice and ffmpeg on the server (see [Running on a Linux server](linux-server.md#running-on-a-linux-server)).
