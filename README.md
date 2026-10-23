# PinDeck

> **macOS, and Linux as a beta.** On Linux, PinDeck runs as a headless server that you use from your
> Mac's browser through an SSH tunnel (see [Running on a Linux server](#running-on-a-linux-server-beta)).
> Windows is not supported.

**Pin it. Say it. Done.** PinDeck is a local editor for HTML slide decks (reveal.js): the slides on
the left, the slide in the middle, and a chat with Claude Code on the right. You click elements to
pin them, write what to change, and Claude edits the HTML and CSS. The slide updates in place.

![PinDeck: the slide list, slide 10 of the example deck with two numbered pins, and the chat with Claude's answer to an earlier request and a new one being typed](docs/pindeck.png)

*The example deck in PinDeck. Claude has lined up the three numbers from the first request and
checked the layout; the next request, still being typed, refers to the new pins 1 and 2.*

## What it does

* **Point instead of describe.** Pins name the exact element, word or table cell; "make 2 match 1"
  is enough. Claude also gets the measured layout of the slide, so it sees overlaps and overflow
  without screenshots.
* **Edit by hand, too.** Move, resize and nudge elements with snapping, edit text in place (math stays
  TeX), write speaker notes, add, hide, move and delete slides. One undo history covers your edits and
  Claude's.
* **Stay on brand.** `brand.css` is locked: Claude edits the deck, its styles and other files of the deck
  folder, never `brand.css` or `vendor/`, and checks its own work with PinDeck's layout command.
* **Bring material in.** Attach figures, audio and PDFs to a message, or import slides from PowerPoint
  into the deck's own layouts.
* **Get it out.** Present from the browser, or export a handout or presentation PDF.
* **Local and small.** One Node process on 127.0.0.1, no npm dependencies, your normal Claude login.

## Quick start

Runs on macOS, and on Linux as a beta. The npm package declares `"os": ["darwin", "linux"]`, so normal
npm installation rejects other operating systems. Overriding that check does not make those platforms
supported. Running the server from a cloned repository on another OS shows a local support notice
instead of opening the deck or starting Claude.

```bash
npx pindeck path/to/deck        # from npm

git clone https://github.com/ehabets/PinDeck.git && cd PinDeck
node server.mjs ocean-example   # or from source, with the example deck in this repository
```

Then open the login link PinDeck prints (`PinDeck: http://127.0.0.1:5180/login?code=...`). It works
once and logs this browser in; for a new one, run `pindeck login` (or `node server.mjs login`). Requirements: Node 20 or later and the `claude` CLI, signed in
with your normal Claude account. Chrome (or Chromium, Edge, Brave) is optional and is used for
screenshots and PDF export; PowerPoint or Keynote (macOS) for pictures in the PowerPoint import; on
Linux, Poppler, LibreOffice and ffmpeg (see [Running on a Linux server](#running-on-a-linux-server-beta)).

The deck is a file (`pindeck path/to/talk.html`) or a folder, which opens its `index.html`; without
one, the current folder. Several decks can share a folder, each with its own chat and undo history;
they share the folder's `theme.css` and `brand.css`, and Claude edits only the deck that is open.
PinDeck adds element ids to the deck file when it opens it (see below), so try it on a copy of a deck
first. Options: `--port 5180`, `--model <name>` (for this run only; otherwise the model in
`~/.pindeck/config.json`), `--help`. Runtime files (chat history, screenshots, backups) are kept in `~/.pindeck/` (change with
`PINDECK_HOME`), not in the deck. `ocean-example/` is a complete example deck to start from.

## Preparing a deck

PinDeck works with reveal.js decks whose slides are `<section>` elements inside `.slides`, and with other
decks that name their slides (see [Decks made without reveal.js](#decks-made-without-revealjs)). Two
optional `<meta>` tags in the deck's `<head>` tell it about the design:

```html
<meta name="pindeck:footer-top" content="652">          <!-- y of the footer rule: content must stay above it -->
<meta name="pindeck:locked" content=".slide-foot, .logo"> <!-- brand elements that cannot be selected or moved -->
```

Hidden slides use reveal.js's `data-visibility="hidden"`. If the deck numbers its slides itself (as
the example's `deck.js` does for the footer), count only slides without that attribute, or the
numbers will jump where a slide is hidden.

Without them PinDeck runs no footer check and locks only `.slide-foot` and `.logo`. A file called
`brand.css` in the deck folder is locked for Claude. See `ocean-example/` for a complete deck.

### Decks made without reveal.js

A deck with a script of its own, or made with a framework whose slides are elements of their own
(Shower, deck.js, a hand-written deck), can be edited too once it names its slides in its `<head>`:

```html
<meta name="pindeck:slides" content="main.deck > section.slide">  <!-- a CSS selector for the slides -->
<meta name="pindeck:size" content="1440x1080">                     <!-- their size in px -->
```

The selector may use tag names, `#id`, `.class`, `[attr]` and `[attr="value"]`, joined by spaces or `>`,
and a list of them separated by commas. In the editor, PinDeck shows the slides itself, one at a time and
scaled to the window, and switches off the deck's own scaling, slide keys and inert or hidden marks while
you edit; that changes nothing in the deck file. Everything in [Working with it](#working-with-it) works as
with a reveal.js deck, with these differences:

* Build steps (`.fragment`) belong to reveal.js: other decks show every element at once.
* Hidden slides (`data-visibility="hidden"`) are left out of PinDeck's PDF exports; whether presenting
  skips them is up to the deck's own script.
* Speaker notes are an `<aside class="notes">` in the slide, as in reveal.js. PinDeck hides them in the
  editor; the deck's CSS should hide them too (`aside.notes { display: none }`).
* **Present** opens the deck at `#<slide id>`, or `#<number>` (counting from 1) for a slide without an id.
  Present may open on the first slide if the deck does not go to slides by their address.
* **＋ New slide** models a new slide on the deck's own (see [Making your own template](#making-your-own-template)):
  a content slide gets placeholder bullets in a `.slide-body`; without one it has only its title. A new or
  duplicated slide does not take the original's `id`.

Both tags are needed: PinDeck opens the slides at the given size for screenshots and PDF pages. A missing
size, or a selector that finds no slides or that PinDeck cannot read, is reported before anything changes.
While PinDeck runs, it reads the tags again for every screenshot, PDF and Claude session; the editor reads
them when the slide reloads. If a tag stops working meanwhile, the editor shows the same message and Claude
is told. A Claude session already running keeps the slide selector it started with; **New chat** starts one
with the new selector.

## Making your own template

PinDeck has no template generator; a template is simply a deck folder. Start from a copy of the example:

```bash
cp -R ocean-example my-template
```

1. **Brand in `brand.css`:** palette, backgrounds, footer and logo positions. PinDeck locks this file
   for Claude, so edit it by hand (or with Claude Code outside PinDeck). Replace the logos in
   `assets/` too.
2. **Everything else in `theme.css`:** type sizes, spacing, layouts and components. This can be done
   in PinDeck with Claude.
3. **`index.html`:** the footer text in the `data-` attributes of `<div class="reveal">`, and the
   `pindeck:footer-top` and `pindeck:locked` meta tags if the footer or the brand elements move.
   `deck.js` holds the math macros, the footer markup and the audio player.
4. **`README.md` and `CLAUDE.md`:** Claude follows both, so describe the new classes and rules there.
   Refer to PinDeck's commands as "the PinDeck CLI command given in the system prompt", as the
   example's `CLAUDE.md` does; PinDeck tells Claude the right path wherever the deck is. An older
   `node ../cli.mjs` in a deck's `CLAUDE.md` is replaced with that command.

**Instructions for Claude.** PinDeck gives Claude the deck folder's own `CLAUDE.md` and `AGENTS.md`.
It does not load `CLAUDE.md` files from parent folders, as Claude Code does in a terminal: those are
usually written for coding (run the tests, commit), which PinDeck's Claude cannot do; they would change
with where the deck happens to sit; and on a shared server a parent folder may be writable by others.
To share rules between decks, say so in the deck's own file, in one of two ways:

- **Import:** `Follow @../shared/STYLE.md for wording.` includes that file's text. Paths are relative to
  the file they are in (or absolute, or `~/...`); imported files may import others, up to 5 levels,
  each file once, 200 KB in all. Only text files are imported; an e-mail address, an `@name` that is
  not a file, and anything in code are left as written.
- **Pointer:** `The style rules are in ../shared/STYLE.md; read them first.` Claude reads the file when
  it needs it.

**New slide** and the PowerPoint import model new slides on the deck's own: keep a slide with class
`title-slide`, one with `section-slide`, and a content slide with `.slide-head` (`h2`, optionally a
`.kicker` or `.sub`) and `.slide-body`. Imported tables take the class of the deck's first table,
and imported audio copies the first `.demo-row` (with a `data-target`). Without a title or section
slide, those PowerPoint slides are imported as content slides; without a `.demo-row`, audio gets
plain players.

## Configuration

`~/.pindeck/config.json` (or `$PINDECK_HOME/config.json`) is created on first start:

```json
{
  "model": "sonnet",
  "effort": "medium"
}
```

`model` is `opus` or `sonnet`; `effort` is `low`, `medium`, `high`, `xhigh` or `max`. A choice in the
chat header's menu is written to this file, so it always shows what PinDeck uses. Edit it while
PinDeck is stopped, or simply use the menu.

### Files outside the deck folder

A deck can use files from a folder around it, such as a style sheet or figures shared by several
talks: start PinDeck with `--asset-root <folder>` (repeatable), or list the folders in config.json as
`"assetRoots": ["~/talks"]`. When the folder contains the deck, PinDeck serves the deck from inside
it, so relative paths such as `../shared/style.css` work, in the editor, in screenshots and in PDF
exports. Claude may read those files but does not edit them.

Symlinks: PinDeck serves a file only if, with symlinks followed, it lies inside the deck folder or an
asset root. A symlink in the deck that leads anywhere else is refused (403). To use a symlinked
library folder, add the folder it points to as an asset root; it does not have to contain the deck.

## Running on a Linux server (beta)

PinDeck can run on a Linux machine where the deck lives, with the editor in your Mac's browser. The
deck, PinDeck, Claude Code and the deck's git clone all stay on the server; the browser only shows the
editor. The server listens on 127.0.0.1 there, as on a Mac, and an SSH tunnel brings that port to your Mac.

On the server you need Node 20 or later (22 or 24 recommended), git if the deck is in a repository, and
the `claude` CLI installed and logged in under your account there, if you want the chat. Without it,
editing by hand still works. Then, in one SSH session on the server:

```bash
node server.mjs path/to/deck --port 5180
```

and on your Mac, in another terminal (`myserver` is your usual SSH host):

```bash
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:5180:127.0.0.1:5180 myserver
```

Open the login link PinDeck printed on the server in the Mac's browser. The local port may differ from
the server's: with `-L 127.0.0.1:8080:127.0.0.1:5180`, change 5180 in the link to 8080. PinDeck accepts any
port, as long as the address is `127.0.0.1` or `localhost`. If the tunnel drops, a message you have already sent keeps running on the
server. Restart the tunnel and the editor reconnects and shows the files as they are then; it never sends a
message twice. If PinDeck restarts, the editor asks you to log in again: run `node server.mjs login
path/to/deck` on the server for a new link.

Other users of a shared server cannot open the editor or read the deck through PinDeck: the token that
protects it is only in your browser's cookie and in PinDeck's own files in `~/.pindeck` (readable only by
you), never in a page or on a command line.

What works on Linux in this beta: editing by hand, speaker notes, slides, pins, the chat with Claude,
Undo/Redo, live reload when files change on the server, layout checks, attaching figures, audio and
PDFs, `git-setup` and the PowerPoint import. Some features use programs on the server, and are on when
they are installed (on Debian or Ubuntu: `sudo apt install poppler-utils libreoffice-impress ffmpeg`):

| Feature | Needs |
|---|---|
| Screenshots, layout checks without an open editor, PDF export | Chrome or Chromium (`PINDECK_LINUX_CHROME=0` turns these off) |
| Pictures of PDF pages (`pdf-figure`) | Poppler (`pdftoppm`, `pdfinfo`) |
| Pictures of PowerPoint slides in the import (thumbnails, diagrams) | LibreOffice (`soffice`) and Poppler |
| Waveforms of audio other than WAV in the import | ffmpeg |

Without them the editor says what is missing (hover over "Server: Linux (beta)"), and Claude is told
which commands are not available. LibreOffice may draw some slides a little differently from PowerPoint;
the pictures are references and figures, the slides themselves are rebuilt from the file. Chromium from snap may not be
allowed to use hidden folders in your home folder such as `~/.pindeck`; if screenshots fail with it, set
`PINDECK_HOME` to a folder that is not hidden, or install Chrome or Chromium from a package.

Run one PinDeck per deck. While PinDeck or Claude is working on a deck, do not edit it with other tools
or switch git branches at the same time. Stop first, or wait until Claude has finished. PinDeck notices
changes made by other programs and reloads, and it refuses Undo, Redo or an edit that would overwrite
them. Its checks cannot rule out every race with a program that writes at the same moment.

## Keeping the ids out of git

PinDeck adds `data-eid` attributes to the deck it opens. If the deck is in git, run once per clone:

```bash
node cli.mjs git-setup path/to/deck
```

This adds a line like `path/to/deck/*.html filter=pindeck-ids` to `.gitattributes` (commit it) and
defines the filter in the clone's git config: git then strips the ids whenever it reads the deck's
HTML. The ids stay in the file on disk, where PinDeck and Claude need them, but commits and diffs
never contain them, and a change that only adds ids does not show in `git status`. Your own edits
show and commit as usual. Clones without the filter configured simply see the file as it is.

## Working with it

| Action | How |
|---|---|
| Select, move, resize | Select mode (`V`, the default): click an element to select it, drag to move, pull a handle to resize. Elements snap to the slide edges and centre, the footer rule and other elements (pink guides); hold `Alt` to turn snapping off, `Shift` to move along one axis. Images keep their aspect ratio (`Shift` toggles). Arrow keys nudge by 1 px, `Shift`+arrows by 10 px. `Delete` removes the selected element after a confirmation; a picture goes with its caption, and files nothing else in the deck uses can be deleted with it. `⌘Z` brings both back. |
| Edit text | Double-click the text (or select it and press `Enter`). The element shows its source, so math appears as TeX, e.g. `\(\mu=0.5\)`. `Enter` or a click elsewhere saves, `Esc` cancels, `Shift+Enter` adds a line break, `⌘B` / `⌘I` make text bold or italic. In a bullet, `Enter` splits it at the cursor and continues in a new bullet below; `Enter` on an empty new bullet removes it and stops. Pasted text arrives as plain text. Table cells are edited one at a time. |
| Undo, redo | `⌘Z` / `⇧⌘Z` or the toolbar arrows. One history for your hand edits and Claude's changes. |
| Pin elements | Press `P` (or the Pin button), click elements; each click gets a number. Click a marker to remove it, `Esc` to stop. |
| Ask Claude | Write in the sidebar and refer to pins by number: "1: align with 2, make 3 smaller". The selected element is sent too, so "make this smaller" works. `Enter` sends, `Shift+Enter` adds a new line. |
| Visual questions | **+** in the chat, then **Screenshot**: the current slide with its pin markers is attached when you send. |
| Review | Each answer ends with the changed files, a **Diff** button and an **Undo** button (most recent change). |
| Stop | **Stop** interrupts Claude; the conversation continues. **New chat** starts over. |
| New slide | **＋ New slide** above the slide list: a **content slide** (title and bullets), a **section divider**, or a **duplicate** of the current slide. It is added after the current slide, modelled on the deck's own slides, and its title opens for typing. |
| Import from PowerPoint | **＋ New slide** → **Import from PowerPoint…**, then choose a `.pptx` file and tick the slides you want (hidden PowerPoint slides start unticked). They are added after the current slide in this deck's own layouts, and Claude can improve the complex ones; see [PowerPoint import](#powerpoint-import). `⌘Z` removes them again, with their figures. |
| Speaker notes | The **Notes** field under the slide shows the current slide's notes (the speaker view, `S`, shows them when presenting). Type to change them; they are saved when you click elsewhere or press `⌘Enter`, and `Esc` puts back what was there. A slide without notes gets them; emptying the field removes them. Notes with formatting other than line breaks are edited as HTML. Drag the line above the notes to give them more or less room (double-click it for the default size); collapse them with their header. |
| Move a slide | Drag it up or down in the slide list; an orange line shows where it will go. It moves with its notes and the comment above it, and `⌘Z` puts it back. Slides inside vertical stacks cannot be moved yet. |
| Hide a slide | The eye on a slide in the list, or `H`. A hidden slide stays in the deck and in PinDeck (greyed out, with a banner) but is skipped when presenting and in PDFs; **Export ▾** can include hidden slides. Show it the same way. |
| Model and effort | Click **Claude ▾** in the chat header: Opus or Sonnet, and the effort (how long Claude thinks: low to max). The conversation continues after a change. The choice is saved in `~/.pindeck/config.json` (default: Sonnet, medium). |
| Attach figures and audio | **+** in the chat, then **File…**, drag and drop onto the chat or a slide, or paste an image. Files are saved in `<deck>/figures/` straight away; audio also gets a waveform SVG. Then ask Claude, e.g. "put this figure on a new slide after 4". Removing an attachment before sending deletes the file again. |
| Attach a PDF | The same way: a figure or table to take over, or a paper or report with more details. PDFs stay outside the deck (in `~/.pindeck`); Claude reads them, rebuilds tables as HTML, and renders a figure (a page or a cropped part of one) into `<deck>/figures/` as PNG with `cli.mjs pdf-figure` (macOS, or Linux with Poppler). E.g. "put Fig. 3 of this paper on slide 7" or "add the results of Table 2 to slide 9". |
| Export PDF | **Export ▾** in the toolbar. **Handout PDF**: one page per slide, build steps shown complete. **Presentation PDF**: one page per click, so a slide with two build steps gives three pages. Files go to `<deck>/export/`. Needs Chrome or Chromium. |
| Navigate | Slide list, `←` `→`, or the toolbar. **Present** opens the deck in a new tab. |

You can also edit `index.html` or `theme.css` in any editor; the slide reloads, and Claude is told
the files changed. CSS changes are swapped in without a reload.

## PowerPoint import

The import keeps what can be carried over exactly and makes pictures of the rest:

* **Text becomes HTML** in the deck's layouts: the title (and the subtitle, as a `.sub` line or a
  kicker, as the deck does it), bullets with their levels, numbered lists, bold, italics, coloured words (as `.hl`),
  superscripts, web and mail links and line breaks, other text as paragraphs, references at the bottom of a slide
  as `.refs`, and the speaker notes. Side notes and labels clearly smaller than the body text stay smaller.
* **Tables become HTML tables** with the class of the deck's own tables, merged header cells, header rows
  and a caption from the text above them. Cells merged down in the body become a label on the group's
  first row with empty cells below it, and each later group's first row gets `class="group"`. A table with shapes drawn over it (e.g. boxes marking rows)
  is kept as a picture instead.
* **Build steps:** shapes and paragraphs that appear (or disappear) on a click become reveal.js
  fragments in the same order, also when several things appear on one click. A picture made of several
  shapes appears on a click only if all of its shapes do.
* **Audio** goes into the deck's own audio player (a copy of its first `.demo-row`, with a waveform made
  from the sound), labelled with the nearest text on the slide; without such a player, plain players.
  **Video** keeps its place, with its poster frame.
  The first slide is filled into the deck's title slide (title, subtitle, authors, event, institute)
  and PowerPoint section headers into its section divider.
* **Pictures are copied** to `figures/` (`<file>-s04-1.png`, ...).
* **Everything drawn** (diagrams built from shapes and arrows, charts, pictures with labels on
  them, EMF graphics) becomes a picture cut from the slide as PowerPoint renders it. For this PinDeck
  asks PowerPoint (or else Keynote) to save the presentation as a PDF; macOS asks once whether PinDeck
  may control the app. The same PDF gives the thumbnails in the import dialog.
* **Layout:** blocks that sit side by side become `.cols` with the slide's proportions, others are
  stacked top to bottom; figures and, if needed, the text are scaled so that the slide fits.
* **Equations** (PowerPoint's equation editor) become TeX for the deck's KaTeX: `\( \)` in the text,
  `\[ \]` on their own line; fractions, scripts, roots, sums and integrals, functions and limits,
  accents, braces, matrices and the bold, italic and double-struck math letters are converted.
* **Hidden slides** stay hidden (`data-visibility="hidden"`).

**Hand-off to Claude.** Slides the import can only approximate are tagged *complex* in the dialog:
diagrams of many shapes or tables with shapes over them that became pictures, pictures placed inside
text (often equations as images), build steps on parts of a diagram, slides without a title, and
text that had to shrink to fit. With **Then ask Claude to improve the complex slides** ticked, Claude
gets these slides right after the import, each with a picture of the original slide and the texts of
its diagrams, and rebuilds diagrams as SVG, equations as TeX and tables as HTML in the deck's style.
The request shows in the chat like your own messages, and its changes can be undone as usual.

Without PowerPoint or Keynote (or on other systems than macOS) only the text and the pictures are imported.

## How it works

* **Element ids.** On start, the server gives every slide and every visible element a readable
  `data-eid` attribute (`summary`, `summary/callout`, `summary/li-2`). Only the attribute is
  inserted; the rest of the file stays as it was. A backup of the file before the first change is
  kept in `~/.pindeck/decks/<deck>/backups/`. Ids survive edits, so pins, layout reports and Claude all name
  the same element.
* **Hand edits.** A move is stored as the CSS `translate` property and a resize as `width`/`height`,
  inline on the element in `index.html`. `translate` moves an element without changing the layout
  around it, for elements in the flow and absolutely positioned ones alike. Only that one style
  attribute is rewritten; the rest of the file stays as it was. Claude gets a note about each hand
  edit. Brand-locked elements (footer, logos) cannot be selected.
* **Text edits.** While you type, the element holds its source HTML from `index.html`, not the
  rendered slide, so math stays TeX and nothing that KaTeX or the deck script generates ends up in
  the file. On save only that element's content is replaced. Browser editing artefacts are cleaned
  up: `<b>`/`<i>` become `<strong>`/`<em>`, styled spans from formatting are removed, trailing
  `<br>`s dropped.
* **Pins.** A pin records the element id, its box in slide coordinates (1280 x 720), the click
  point, the clicked word and, in tables, the cell. Pins on the footer or logos are marked as
  locked.
* **Layout instead of screenshots.** With each message the editor measures the current slide and
  every pinned slide in your browser: position and size of every element, font sizes, and issues
  (content below the footer rule, outside the slide, overlaps, clipped text). Claude gets this as
  text. To check its own work it runs the PinDeck CLI's `layout <slide>...` (`--issues` for the
  issues only). Screenshots are
  only taken when you tick the box or Claude needs a visual judgement.
* **One Claude Code process.** The server starts `claude -p` in stream-json mode once and keeps it
  running, so there is no start-up delay per message. It runs in the deck folder under your Claude
  login, with `--append-system-prompt` from `lib/system-prompt.md` and the deck's `CLAUDE.md`.
* **Permissions.** Claude may read files, edit and create files in the deck folder, and run the editor's
  CLI. Nothing else: no other commands, and no edits to `brand.css`, `vendor/`, `.git/` or, for a named
  deck file, the other decks in its folder. Claude Code loads no settings files
  and no MCP servers, so no allow rule in your own, the deck's or a parent folder's settings widens this. If `brand.css` changes during a
  turn anyway, the server restores it and says so in the chat.
* **Undo.** The server keeps a copy of every file a change touched, from before and after it (a Claude
  turn, which may change, create or delete several files of the deck, or a hand edit). Files over 2 MB
  are not copied: the chat says when a turn changed one, and Undo leaves it as it is. Hidden files,
  `vendor/` and `export/` are not part of undo. Undo and redo walk that history and tell Claude on the next message. They first check
  that the files are still as that change left them; if something else changed them since, they do
  nothing and say which file differs, rather than overwrite that work.
* **Saving.** Every file PinDeck writes into the deck is written to a temporary file next to it and then
  renamed into place, so other programs never see half a file. Each change from the editor carries the
  revision of the files it was made on; if the files have changed since, the change is refused, the
  slide reloads, and edited text can be copied from the message to type in again.

## Files

| File | Purpose |
|---|---|
| `server.mjs` | Local server (127.0.0.1 only, random token per run, one-time login links): UI, deck files, events, Claude session, undo, CLI endpoints, `login`. |
| `cli.mjs` | `layout`, `shot`, `slides`, `pdf handout` / `pdf presentation` and `pdf-figure` commands for Claude (and for you), and `git-setup`. |
| `public/` | The editor page, and `bridge.js`, which is injected into the deck in edit mode (never saved to it). |
| `lib/pptx.mjs`, `lib/zip.mjs`, `lib/xml.mjs` | Reading `.pptx` files (no dependencies): slides, text, shapes and their positions, notes. |
| `lib/pptx-import.mjs` | Turns PowerPoint slides into slides of the deck: figures, tables, build steps, audio, layout, HTML in the deck's style. |
| `lib/waveform.mjs` | Waveform SVGs for imported audio. |
| `lib/omml.mjs` | PowerPoint equations (Office Math) to TeX. |
| `lib/pptx-render.mjs`, `lib/pdf-render.jxa.js` | Slide and PDF pictures: PowerPoint or Keynote (macOS) or LibreOffice (Linux) saves a PDF; macOS PDFKit or Poppler renders pages and regions of it. |
| `lib/pdf.mjs` | PDF export: reveal.js print layout in headless Chrome, then print to PDF. |
| `lib/eids.mjs` | Adds the `data-eid` attributes by editing the HTML as text. |
| `lib/claude.mjs` | The long-running Claude Code process. |
| `lib/capabilities.mjs` | What this server can do on this system (macOS, Linux), for the editor, the API, the CLI and Claude. |
| `lib/deck-files.mjs` | Atomic writes and the revision of the deck's files. |
| `lib/system-prompt.md` | What Claude is told about the editor. |
| `CONTRIBUTING.md` | How to report bugs and contribute. |
| `docs/` | Images for this README. |
| `LICENSE` | MIT. |

## Current Limitations

* reveal.js decks, and decks that name their slides with `<meta name="pindeck:slides">` (see [Decks made
  without reveal.js](#decks-made-without-revealjs)). Any other deck made with another framework (Marp, Slidev,
  impress.js, remark, Spectacle, Shower, deck.js, bespoke.js) is recognised and refused with its name before
  PinDeck changes anything.
* Text inside inline SVG diagrams cannot be edited in place; pin it and ask Claude.
* Parts of an inline SVG move with the whole SVG; inline text (bold, spans) moves with its block.
* No indenting or outdenting of bullets with `Tab` yet, and `Backspace` at the start of a bullet does not merge it with the one above; ask Claude for those.
* Moves are offsets (`translate`), so the space an element came from stays reserved. Ask Claude to turn hand edits into proper CSS when a layout should really change.
* The undo history lives on the server and starts fresh when PinDeck restarts.
* One writer at a time: PinDeck is not made for editing the same deck from two editors or tools at once.
* Linux (beta): pictures of PDF pages and PowerPoint slides, and waveforms of non-WAV audio, need
  Poppler, LibreOffice and ffmpeg on the server (see [Running on a Linux server](#running-on-a-linux-server-beta)).

## Versions

* **2.10.0-beta.1** (2.10 beta): decks with their own file names and shared files, and Claude working
  on the whole deck.
  - A deck file by name: `pindeck path/to/talk.html` (a folder still opens its `index.html`). Several
    decks can share a folder, each with its own chat and undo history.
  - Claude may edit and create other files of the deck (scripts, style sheets, notes), never
    `brand.css`, `vendor/` or other decks in the folder. One Undo takes back everything a turn changed,
    created or deleted; files over 2 MB are not copied, and the chat says so.
  - Files outside the deck folder: `--asset-root <folder>` (or `"assetRoots"` in config.json) serves
    the deck from inside that folder, so paths such as `../shared/style.css` work in the editor,
    screenshots and PDF exports. A symlink that leads out of the deck and its asset roots is refused.
  - Shared instructions: the deck's `CLAUDE.md` and `AGENTS.md` may import other files with `@path`.
    `CLAUDE.md` files in parent folders are still not loaded, on purpose (see the README).
  - Decks made with other slide frameworks (Marp, Slidev, impress.js, remark and others) are
    recognised and refused with their name, before PinDeck changes anything.
  - Linux: pictures of PDF pages with Poppler, the PowerPoint import with slide pictures from
    LibreOffice, and waveforms of non-WAV audio with ffmpeg, each when installed.

* **2.9**: Linux as a beta, and safer editing.
  - Linux (beta): PinDeck runs as a headless server, used from a Mac's browser through an SSH tunnel,
    with Claude Code running on the server. The tunnel may use another local port than the server.
    Screenshots, layout checks without an open editor and PDF export work when Chrome or Chromium is
    found (`PINDECK_LINUX_CHROME=0` turns them off). Features a system cannot provide are switched off,
    with the reason shown in the editor. Changes made to the deck by other programs are seen every
    time, also after a file was replaced by a rename.
  - Security: the editor page no longer contains the token, and the deck needs it too, so other users
    of the same machine cannot read either. PinDeck prints a one-time login link at start
    (`pindeck login` prints a new one), which keeps the token in an HttpOnly cookie named after the
    server's port; headless Chrome logs in the same way, so the token is never on a command line. After
    a restart, log in again with a new link.
  - Saving is atomic; edits made on files that changed meanwhile are refused, and Undo/Redo no longer
    overwrite changes made outside PinDeck.
  - Audio and video play in Safari: deck files are sent with their length and byte ranges, and ogg,
    opus, m4a, aac, flac and mov get their media types.
  - Claude gets the right CLI command for decks outside the PinDeck folder; the example's `CLAUDE.md`
    no longer names a path. The deck's `AGENTS.md` reaches Claude along with its `CLAUDE.md`.
  - macOS: pictures of PDF pages (`pdf-figure`) and of PowerPoint slides have a white page instead of a
    transparent one, so dark text no longer disappears on a dark slide.
  - Screenshots and PDF exports are no longer now and then reported as failed although Chrome wrote them.
  - `git-setup` works for decks behind symlinks or with spaces in their path. The tests run on Linux
    and macOS in CI, including a real Chrome.

* **2.8.2**: declares macOS-only support in npm metadata and the README to prevent accidental
  installation on unsupported operating systems. Source launches on other platforms show a support
  notice without opening the deck.

* **2.8.1**: fixes from a review. Speaker notes that fail to load leave the field empty and locked, instead
  of showing the previous slide's notes and saving your edits over them. A save that fails because the
  server cannot be reached is reported, and the edits after it (drags, text, bullets, notes) are still
  saved instead of being dropped without a word. Stop no longer ends a turn started after it. Slides in
  vertical stacks keep their order and ids, and a slide moved to the end goes after a final stack.
  A first automated test suite (`npm test`).
* **2.8**: a code review: safer, sturdier, and a PowerPoint import that keeps more. The server answers
  only to `127.0.0.1` and `localhost`, so another website cannot read the editor's token (DNS
  rebinding). A missing `claude` command ends the turn with a message instead of leaving the chat
  working forever, and a replaced Claude Code process can no longer end the next turn. Esc in the import
  dialog no longer repeats the last import, and an import never overwrites edits made while it runs. The
  PowerPoint import keeps animations that play by themselves off the clicks, wraps shapes that come and
  go in fragments of their own, skips hidden shapes and `javascript:` links, reads packages with
  absolute part names, takes only the first line of a subtitle placeholder as the subtitle, keeps
  equations in titles and notes, writes numbered lists as `<ol>`, keeps the text of coloured boxes
  without PowerPoint or Keynote, and makes valid TeX of escaped text, equation arrays, odd delimiters
  and primes after superscripts. Damaged WAV or XML parts no longer stop an import. The toolbar wraps
  instead of overlapping when the slide area is narrow.
* **2.7**: attach PDFs to chat messages (a figure, a table, a paper or report). They stay outside the deck; Claude reads
  them, rebuilds tables as HTML and renders figures into `figures/` with `cli.mjs pdf-figure` (a page or a cropped part, macOS).
* **2.6.1**: tinted table rows are one rectangle per row instead of one per cell, so PDF viewers show no hairline seams between the cells.
* **2.6**: booktabs-style tables in both example decks (rules at top, under the header and at the bottom,
  short rules under grouped headings, numbers right-aligned); the import writes row groups without `rowspan`.
* **2.5**: a notes field under the slide for the speaker notes, saved as hand edits with undo.
* **2.4.1**: the layout check judges a plain container by what it draws (its children), not by its box, so
  a body stretched down to the references no longer counts as an overlap; a real overlap is reported once,
  for the outermost pair.
* **2.4**: move slides by dragging them in the slide list; undo puts them back.
* **2.3**: lessons from a PowerPoint hand-off. Claude Code runs without settings files or MCP servers
  (the deck's `CLAUDE.md` goes into the system prompt instead), so stray allow rules no longer let it run
  scripts; `layout` takes several slides and `--issues`; the chat no longer labels a refused script as a
  layout check; shared SVG arrowheads live outside the slides, where hidden slides cannot hide them.
* **2.2**: PowerPoint import with equations as TeX for KaTeX, and the hand-off to Claude: complex slides are
  tagged in the import dialog and, if wanted, improved by Claude right after the import, with a picture of
  each original slide.
* **2.1**: PowerPoint import with build steps (fragments in click order), HTML tables in the deck's table
  style, audio in the deck's player with a waveform, video with its poster, coloured words as `.hl`.
* **2.0**: import slides from PowerPoint (`.pptx`): text as HTML in the deck's layouts, pictures copied,
  diagrams, tables and charts as pictures cut from PowerPoint's rendering; thumbnails in the import
  dialog; undo removes the imported slides and their figures.
* **1.12.1**: the PinDeck pin as the browser tab icon (SVG, with PNG versions for Safari).
* **1.12**: double-clicking an equation opens its text with the equation's TeX selected, also for
  equations on their own line and for parts KaTeX draws as SVG (roots, wide accents, arrows).
* **1.11.3**: a calmer interface: no slide count, no Hide/Show button in the header (eye and `H`
  remain), no messages or chat entries for hiding and showing, shorter export descriptions.
* **1.11.2**: the header shows the deck's name instead of the slide title; the browser tab is named after the deck.
* **1.11.1**: the Hide and Show icons sit at the same height.
* **1.11**: hide and show slides (eye in the slide list, toolbar button, `H`); hidden slides are skipped
  when presenting and in PDFs unless the export includes them.
* **1.10**: model and effort without "Default" entries (default Sonnet, medium), set in `~/.pindeck/config.json`.
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

## Contributing

Bug reports, ideas, example decks and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md)
explains how to report a bug, set up PinDeck for development, test a change by hand, and what a pull
request should contain. In short: no npm dependencies, deck files are edited only where they must
change, Claude's permissions stay narrow, and the README describes what users see.

## License

MIT, see [LICENSE](LICENSE).
