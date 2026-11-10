# Changelog

What each PinDeck version brought, newest first. Releases are on [GitHub](https://github.com/ehabets/PinDeck/releases).


* **4.1.0-beta.1**: select several elements at once.
  - `⌘`-click selects several elements on a slide: they move and nudge together (one undo step), `Delete` removes them after one confirmation, and the assistant gets all of them as "these".
  - `cli.mjs element <eid>...` prints elements' HTML as written in the deck, so the assistant can read one element of a long slide line.
  - The PinDeck version shows beside the logo.
  - A "Created by PinDeck" badge with a QR code for a closing slide, in light and dark (see the README).

* **4.0.0-beta.1**: review comments, and Quarto decks.
  - **Comment** keeps a note on a pinned element or a slide for later, outside the deck. Comments are found again after changes or flagged, listed in the Comments panel, sent to the assistant as one request, and written as a review packet for an agent outside PinDeck. After Sebastian J. Schlecht's review mode.
  - `pindeck talk.qmd` opens a Quarto deck: the assistant edits the source, PinDeck renders after every change, and hand edits of the output are off. An example deck in `quarto-mathjax-example/`.
  - **Edit** in the Comments panel changes a comment's text.
  - A comment the assistant cannot do stays open with its reason on it (`cli.mjs reply <id> <why>`); **Reply** to answer, and the thread goes with the comment to the assistant or an outside agent.
  - The assistant marks the comments it has addressed as resolved (`cli.mjs resolve <id> <what it did>`).
  - The command-line tools also find a slide by its id attribute (a Quarto heading's anchor).
  - Ocean for Quarto: a format extension (`format: ocean-revealjs`) with Ocean's layouts, brand layer and footer; the example deck uses it.
  - **Comment** opens the Comments panel on the new comment; the panel's button that sends the open comments is now **Process Comments**.
  - More Quarto examples: `quarto-katex-example/` (math with KaTeX) and `quarto-python-example/` (figures from Python).
  - The message box is taller and can be resized like the notes: drag its top edge, double-click for the default size.
  - The documentation is split out of the README into `docs/`, with this changelog.
  - Settings and chats are kept in `~/.pindeck-v4`, apart from PinDeck 3's `~/.pindeck-v3`, so the beta runs next to 3.x; nothing is copied over (see [Models, providers and configuration](docs/configuration.md#models-providers-and-configuration)).

* **3.4.0**: formatted speaker notes, and the speaker view works.
  - The Notes field shows the notes' formatting: `⌘B`, `⌘I` and `⌘U` format the selection, `Enter` starts a new line, and pasted text comes in plain. Notes with markup the field cannot show safely are still edited as HTML, and nothing in them is lost on save.
  - Present opens the deck on localhost, so reveal.js's speaker view (`S`) shows the notes and the next slide.
  - Claude runs PinDeck's commands by this server's path when the deck's `CLAUDE.md` names another (such as `node ../pindeck/cli.mjs`), and a chat that used an old path is told the right one.

* **3.3.0**: fixes from a code audit.
  - After a PowerPoint import, refining the slides no longer deletes pictures that the deck still uses (when the turn was stopped, failed or only changed `theme.css`); Undo brings removed pictures back.
  - Long texts with non-ASCII characters (large notes, tables, SVG) no longer get broken characters.
  - Claude reads only the deck, its screenshots, attached PDFs and asset roots, as Codex already did, and cannot create a `.git` file in the deck folder.

* **3.2.0**: PinDeck 3, the first stable release of version 3: everything from the 3.0, 3.1 and 3.2 betas below. Compared with 2.11:
  - OpenAI Codex as a second assistant next to Claude Code, with the models and efforts each backend offers; each deck keeps its own provider, model and effort.
  - Several decks on one port: a deck menu above the slide, each deck with its own chat, assistant session and Undo.
  - Deck pages run sandboxed, so a deck's script cannot use the API or read other decks.
  - Linux is no longer a beta.
  - Settings and chats are kept in `~/.pindeck-v3`, apart from PinDeck 2's `~/.pindeck`; nothing is copied over (see [Models, providers and configuration](docs/configuration.md#models-providers-and-configuration)). PinDeck 2 stays on npm as `pindeck@2`.

* **3.2.0-beta.1**: fixes from a code review and a round of user tests.
  - Security: deck pages run sandboxed, so a deck's script can no longer use the API, read other decks or send messages; the login link's `next` stays on PinDeck. A deck's own script cannot use `localStorage` there either (it throws).
  - Typing in a bullet that cannot be saved because the deck changed meanwhile can be copied, as other text can; a deck that never chose a model keeps the one its conversation started with.
  - Several decks in one folder: a turn no longer records or undoes another deck's files, and deleting a picture keeps a file another deck uses. Subfolder decks are locked for the assistant.
  - Each deck keeps its provider, model and effort; config.json is merged, not overwritten; unusable saved settings are made usable before the first message.
  - Many tabs on one port; a deck server that stops reconnects; `pindeck login` and `cli.mjs` find the right PinDeck; a deck opens in one PinDeck only.
  - Screenshots show the pins of their own message; Stop during a screenshot; failures reach the assistant.
  - New chat keeps Undo; undone marks survive a restart; only the latest change offers Undo.
  - A deck page that cannot start says why, and Send no longer hangs; typing survives an outside save; the deck menu at every width; keyboard use of the model menus; Enter in a bullet leaves no copied ids.
  - Large decks get their ids in linear time; symlinked decks; a deck that is gone; Chrome's own errors, and `--no-sandbox` as root; a warning when PinDeck 2 writes to the same state folder.
  - On a Mac, Enter in the terminal opens PinDeck in the browser.
  - From the code review: locked paths regardless of case (macOS) and `.git/config` restored after each turn; Codex reads PDFs of a deck reached through a symlink; "not signed in" only when Claude says so; betas tested before they are staged; model lists shared between decks; a faster deck list; smaller status updates; asset roots read alike by the front and the deck servers.

* **3.1.0-beta.1**: several decks on one port, and screenshots you can open from the chat.
  - A deck menu: click the deck's name above the slide to open another deck from its folder or the asset roots (and one folder down). Each open deck keeps its own chat, assistant session and Undo; listing decks changes no file. `pindeck` now starts a small front that holds the port and the login and runs one deck server per open deck. A deck with no editor open for 30 minutes closes (its Undo history goes, as on a restart) and reopens when chosen again.
  - A folder without `index.html` opens a page listing its decks instead of failing.
  - `pindeck login talk.html` prints a link that opens that deck.
  - Screenshots the assistant took show as a small picture on the chat line; click it to see it large. A screenshot PinDeck no longer keeps says so.

* **3.0.0-beta.3**: everything from 2.10.0, for both assistants.
  - Decks made without reveal.js: a deck that names its slides with `<meta name="pindeck:slides">` and their size with `<meta name="pindeck:size">` is edited like a reveal.js deck (contributed by Zeyu Xu). Claude and Codex are both told what the deck's slides are.
  - Screenshots fill the picture instead of being letterboxed into a shorter page.

* **3.0.0-beta.2**: everything from 2.9 and 2.10, with Codex brought up to it.
  - Security: the fix from 2.9. The editor page no longer contains the token, and the deck needs it too, so other users of the same machine cannot read either. PinDeck prints a one-time login link at start (`pindeck login` prints a new one). Update from beta.1.
  - Linux as a beta, safe saving, Undo/Redo that refuses to overwrite outside changes, decks with their own file names, `--asset-root`, `@imports` in the deck's `CLAUDE.md` and `AGENTS.md`, and the other 2.9 and 2.10 changes (see below).
  - Both assistants may edit and create other files of the deck, never `brand.css`, `vendor/`, `.git/` or other decks in the folder; one Undo takes back a whole turn. Codex creates files with a new `pindeck_write` tool and edits through PinDeck's safe saving.
  - Claude may run only PinDeck's own commands (layout, shot, slides, pdf, pdf-figure), each named.
  - Starting with `--provider codex` and no saved model now picks Codex's default model, also while the model lists are still loading.
  - Stopping PinDeck waits for every backend process, including those that list models.

* **3.0.0-beta.1**: Claude and Codex adapters, discovered model/effort menu, explicit provider switching with optional handover, curated model lists, a separate effort selector with per-model preferences, restricted Codex tools, and separate v3 runtime state. On npm as `pindeck@beta`.

* **2.11**: screenshots in the chat. A screenshot sent with a message, and one Claude reads, shows as a small picture that opens larger with a click (Esc or a click closes it). PinDeck keeps the 40 newest screenshots of a deck; an older one says "no longer kept". Chats from before 2.11 keep their plain label. (In 3.x since 3.1.0-beta.1.)

* **2.10**: decks with their own file names and shared files, decks made without reveal.js, and Claude working on the whole deck.
  - A deck file by name: `pindeck path/to/talk.html` (a folder still opens its `index.html`). Several decks can share a folder, each with its own chat and undo history.
  - Claude may edit and create other files of the deck (scripts, style sheets, notes), never `brand.css`, `vendor/` or other decks in the folder. One Undo takes back everything a turn changed, created or deleted; files over 2 MB are not copied, and the chat says so.
  - Files outside the deck folder: `--asset-root <folder>` (or `"assetRoots"` in config.json) serves the deck from inside that folder, so paths such as `../shared/style.css` work in the editor, screenshots and PDF exports. A symlink that leads out of the deck and its asset roots is refused.
  - Shared instructions: the deck's `CLAUDE.md` and `AGENTS.md` may import other files with `@path`. `CLAUDE.md` files in parent folders are still not loaded, on purpose (see the README).
  - Decks made without reveal.js (a script of their own, Shower, deck.js, a hand-written deck): a deck that names its slides with `<meta name="pindeck:slides">` (a CSS selector) and their size with `<meta name="pindeck:size">` is edited like a reveal.js deck, with screenshots at the slide size and one PDF page per slide (contributed by Zeyu Xu). Decks made with other slide frameworks (Marp, Slidev, impress.js, remark and others) without these tags are recognised and refused with their name, before PinDeck changes anything; the message says how to add the tags.
  - Screenshots fill the picture: headless Chrome lays the page out shorter than its window, which left the slide letterboxed in some Chrome versions (reported by Zeyu Xu).
  - Linux: pictures of PDF pages with Poppler, the PowerPoint import with slide pictures from LibreOffice, and waveforms of non-WAV audio with ffmpeg, each when installed.

* **2.9**: Linux as a beta, and safer editing.
  - Linux (beta): PinDeck runs as a headless server, used from a Mac's browser through an SSH tunnel, with Claude Code running on the server. The tunnel may use another local port than the server. Screenshots, layout checks without an open editor and PDF export work when Chrome or Chromium is found (`PINDECK_LINUX_CHROME=0` turns them off). Features a system cannot provide are switched off, with the reason shown in the editor. Changes made to the deck by other programs are seen every time, also after a file was replaced by a rename.
  - Security: the editor page no longer contains the token, and the deck needs it too, so other users of the same machine cannot read either. PinDeck prints a one-time login link at start (`pindeck login` prints a new one), which keeps the token in an HttpOnly cookie named after the server's port; headless Chrome logs in the same way, so the token is never on a command line. After a restart, log in again with a new link.
  - Saving is atomic; edits made on files that changed meanwhile are refused, and Undo/Redo no longer overwrite changes made outside PinDeck.
  - Audio and video play in Safari: deck files are sent with their length and byte ranges, and ogg, opus, m4a, aac, flac and mov get their media types.
  - Claude gets the right CLI command for decks outside the PinDeck folder; the example's `CLAUDE.md` no longer names a path. The deck's `AGENTS.md` reaches Claude along with its `CLAUDE.md`.
  - macOS: pictures of PDF pages (`pdf-figure`) and of PowerPoint slides have a white page instead of a transparent one, so dark text no longer disappears on a dark slide.
  - Screenshots and PDF exports are no longer now and then reported as failed although Chrome wrote them.
  - `git-setup` works for decks behind symlinks or with spaces in their path. The tests run on Linux and macOS in CI, including a real Chrome.

* **2.8.2**: declares macOS-only support in npm metadata and the README to prevent accidental installation on unsupported operating systems. Source launches on other platforms show a support notice without opening the deck.

* **2.8.1**: fixes from a review. Speaker notes that fail to load leave the field empty and locked, instead of showing the previous slide's notes and saving your edits over them. A save that fails because the server cannot be reached is reported, and the edits after it (drags, text, bullets, notes) are still saved instead of being dropped without a word. Stop no longer ends a turn started after it. Slides in vertical stacks keep their order and ids, and a slide moved to the end goes after a final stack. A first automated test suite (`npm test`).
* **2.8**: a code review: safer, sturdier, and a PowerPoint import that keeps more. The server answers only to `127.0.0.1` and `localhost`, so another website cannot read the editor's token (DNS rebinding). A missing `claude` command ends the turn with a message instead of leaving the chat working forever, and a replaced Claude Code process can no longer end the next turn. Esc in the import dialog no longer repeats the last import, and an import never overwrites edits made while it runs. The PowerPoint import keeps animations that play by themselves off the clicks, wraps shapes that come and go in fragments of their own, skips hidden shapes and `javascript:` links, reads packages with absolute part names, takes only the first line of a subtitle placeholder as the subtitle, keeps equations in titles and notes, writes numbered lists as `<ol>`, keeps the text of coloured boxes without PowerPoint or Keynote, and makes valid TeX of escaped text, equation arrays, odd delimiters and primes after superscripts. Damaged WAV or XML parts no longer stop an import. The toolbar wraps instead of overlapping when the slide area is narrow.
* **2.7**: attach PDFs to chat messages (a figure, a table, a paper or report). They stay outside the deck; Claude reads them, rebuilds tables as HTML and renders figures into `figures/` with `cli.mjs pdf-figure` (a page or a cropped part, macOS).
* **2.6.1**: tinted table rows are one rectangle per row instead of one per cell, so PDF viewers show no hairline seams between the cells.
* **2.6**: booktabs-style tables in both example decks (rules at top, under the header and at the bottom, short rules under grouped headings, numbers right-aligned); the import writes row groups without `rowspan`.
* **2.5**: a notes field under the slide for the speaker notes, saved as hand edits with undo.
* **2.4.1**: the layout check judges a plain container by what it draws (its children), not by its box, so a body stretched down to the references no longer counts as an overlap; a real overlap is reported once, for the outermost pair.
* **2.4**: move slides by dragging them in the slide list; undo puts them back.
* **2.3**: lessons from a PowerPoint hand-off. Claude Code runs without settings files or MCP servers (the deck's `CLAUDE.md` goes into the system prompt instead), so stray allow rules no longer let it run scripts; `layout` takes several slides and `--issues`; the chat no longer labels a refused script as a layout check; shared SVG arrowheads live outside the slides, where hidden slides cannot hide them.
* **2.2**: PowerPoint import with equations as TeX for KaTeX, and the hand-off to Claude: complex slides are tagged in the import dialog and, if wanted, improved by Claude right after the import, with a picture of each original slide.
* **2.1**: PowerPoint import with build steps (fragments in click order), HTML tables in the deck's table style, audio in the deck's player with a waveform, video with its poster, coloured words as `.hl`.
* **2.0**: import slides from PowerPoint (`.pptx`): text as HTML in the deck's layouts, pictures copied, diagrams, tables and charts as pictures cut from PowerPoint's rendering; thumbnails in the import dialog; undo removes the imported slides and their figures.
* **1.12.1**: the PinDeck pin as the browser tab icon (SVG, with PNG versions for Safari).
* **1.12**: double-clicking an equation opens its text with the equation's TeX selected, also for equations on their own line and for parts KaTeX draws as SVG (roots, wide accents, arrows).
* **1.11.3**: a calmer interface: no slide count, no Hide/Show button in the header (eye and `H` remain), no messages or chat entries for hiding and showing, shorter export descriptions.
* **1.11.2**: the header shows the deck's name instead of the slide title; the browser tab is named after the deck.
* **1.11.1**: the Hide and Show icons sit at the same height.
* **1.11**: hide and show slides (eye in the slide list, toolbar button, `H`); hidden slides are skipped when presenting and in PDFs unless the export includes them.
* **1.10**: model and effort without "Default" entries (default Sonnet, medium), set in `~/.pindeck-v3/config.json`.
* **1.9**: `node cli.mjs git-setup` keeps PinDeck's ids out of git with a clean filter; id-only changes no longer show in `git status`.
* **1.8**: ＋ New slide (content slide, section divider, duplicate); model (Opus, Sonnet) and effort menu in the chat header; a + menu in the chat for files and screenshots.
* **1.7**: `Delete` removes the selected element after a confirmation, a picture with its caption, and optionally the files nothing else uses; undo restores elements and files. Claude reads attached images directly instead of trying to convert them; refused commands are explained in the chat.
* **1.6**: attach figures and audio to chat messages (file picker, drag and drop, paste); audio gets a waveform SVG; files dropped on a slide carry their position.
* **1.5**: PDF export (handout and presentation with build steps on separate pages).
* **1.4**: decks describe their footer and locked brand elements with `<meta name="pindeck:...">` tags; the layout check ignores invisible elements. New public example deck: `ocean-example/`.
* **1.3**: `Enter` in a bullet starts a new bullet (split at the cursor); empty new bullets are removed again.
* **1.2**: text editing on the slide (double-click or Enter), with math as TeX, table cells, bold and italic, plain-text paste; text edits are part of the undo history and reported to Claude.
* **1.1**: select, drag, resize and nudge with snapping guides; one undo/redo history for hand edits and Claude's changes; the selected element is sent to Claude.
* **1.0**: pins, chat with Claude Code, layout reports, element ids, diff and undo.
