# PinDeck

> **macOS-only · Version 3 beta preview** (`3.0.0-beta.1`). The beta uses npm’s `beta` channel; stable releases use `latest`. See availability and installation below.

**Pin it. Say it. Done.** PinDeck is a local macOS editor for HTML slide decks (reveal.js): the slides on
the left, the slide in the middle, and a chat with Claude Code or OpenAI Codex on the right. You click elements to
pin them, write what to change, and the selected assistant edits the HTML and CSS. The slide updates in place.

![PinDeck: the slide list, slide 10 of the example deck with two numbered pins, and the chat with Claude's answer to an earlier request and a new one being typed](docs/pindeck.png)

*The example deck in PinDeck. Claude has lined up the three numbers from the first request and
checked the layout; the next request, still being typed, refers to the new pins 1 and 2.*

## What it does

* **Point instead of describe.** Pins name the exact element, word or table cell; "make 2 match 1"
  is enough. The assistant also gets the measured layout of the slide, so it sees overlaps and overflow
  without screenshots.
* **Edit by hand, too.** Move, resize and nudge elements with snapping, edit text in place (math stays
  TeX), write speaker notes, add, hide, move and delete slides. One undo history covers your edits and
  the assistant's.
* **Stay on brand.** `brand.css` is locked: the assistant edits `index.html` and `theme.css` only, and checks
  its own work with PinDeck's layout command.
* **Bring material in.** Attach figures, audio and PDFs to a message, or import slides from PowerPoint
  into the deck's own layouts.
* **Get it out.** Present from the browser, or export a handout or presentation PDF.
* **Local and small.** One Node process on 127.0.0.1, no npm dependencies, your existing Claude Code or Codex login.

## Quick start

**Requires macOS.** Windows and Linux are not supported in v3.

Install the public beta once `3.0.0-beta.1` has been published:

```bash
npx pindeck@beta /path/to/deck
# Or select this exact beta:
npx pindeck@3.0.0-beta.1 /path/to/deck
```

For the source preview, once the `v3-beta` branch is public:

```bash
git clone --branch v3-beta --single-branch https://github.com/ehabets/PinDeck.git PinDeck-v3
cd PinDeck-v3
node server.mjs ocean-example
```

**Availability:** this checkout contains the prepared beta; its branch and npm package have not yet
been published. Until then, run `node server.mjs ocean-example` from your local v3 checkout.

Use `npx pindeck@latest /path/to/deck` for the stable release. The beta channel does not replace it.
The example deck is included in the repository; npm users supply their own deck folder.
Then open <http://127.0.0.1:5180/>.

Options: `--port 5180`, `--provider claude|codex`, `--model <name>` (for this run only; otherwise the model in
`~/.pindeck-v3/config.json`), `--help`. The deck folder defaults to the current folder and must contain
`index.html`. Runtime files (chat history, screenshots, backups) are kept in `~/.pindeck-v3/` (change with
`PINDECK_HOME`), not in the deck. `ocean-example/` is a complete example deck to start from.

## Compatibility and requirements

* **Runtime:** Node.js 20 or later, plus a modern browser. The release workflow uses Node.js 24.
* **Backends:** install and sign in to Claude Code (`claude auth login`) or OpenAI Codex (`codex login`).
  The corresponding executable must be on `PATH`; `CLAUDE_BIN` and `CODEX_BIN` can override its path.
  Only the selected backend is required for editing. Model and effort availability comes from that
  backend and account, and may differ from the provider’s website or desktop app.
* **Platforms:** macOS only. Windows and Linux are not supported in v3. The npm package declares
  `"os": ["darwin"]`, so normal npm installation rejects other operating systems. This check can be
  overridden; bypassing it does not make those platforms supported. Source launches on unsupported
  platforms show a local support page without opening the deck or starting a backend. Native Windows support is a
  possible v4 feature, not part of this beta.
* **Screenshots and PDF export:** require a locally installed Chrome, Chromium, Edge or Brave.
* **PDF input through Codex:** page-text extraction and figure rendering use macOS PDFKit and
  `osascript`; this bridge is macOS-only. Claude uses its native PDF-reading capabilities, while
  PinDeck’s PDF figure-rendering helper still requires macOS.
* **PowerPoint import:** basic `.pptx` parsing uses Node.js; rendered slide pictures require
  PowerPoint or Keynote on macOS.

The initial live editing checks used Codex CLI **0.144.1** and Claude Code **2.1.289**.
Further live checks on macOS passed with Codex CLI **0.162.1** and Claude Code **2.1.301**:
editing, Claude effort changes, Codex model changes, conversation handover, undo/redo,
cancellation and recovery. These are tested versions, not guaranteed minimum requirements. Backends must support the discovery and session interfaces
used by PinDeck. Older CLIs can expose fewer models or fail initialization.

Codex integration uses OpenAI’s experimental `dynamicTools` extension to the app-server.
A future Codex update may require a PinDeck adapter update. Incompatible backends report startup
errors; PinDeck does not fall back to broader permissions. Recheck backend compatibility when upgrading.

## Preparing a deck

PinDeck works with reveal.js decks whose slides are `<section>` elements inside `.slides`. Two
optional `<meta>` tags in the deck's `<head>` tell it about the design:

```html
<meta name="pindeck:footer-top" content="652">          <!-- y of the footer rule: content must stay above it -->
<meta name="pindeck:locked" content=".slide-foot, .logo"> <!-- brand elements that cannot be selected or moved -->
```

Hidden slides use reveal.js's `data-visibility="hidden"`. If the deck numbers its slides itself (as
the example's `deck.js` does for the footer), count only slides without that attribute, or the
numbers will jump where a slide is hidden.

Without them PinDeck runs no footer check and locks only `.slide-foot` and `.logo`. A file called
`brand.css` in the deck folder is locked for both backends. See `ocean-example/` for a complete deck.

## Making your own template

PinDeck has no template generator; a template is simply a deck folder. Start from a copy of the example:

```bash
cp -R ocean-example my-template
```

1. **Brand in `brand.css`:** palette, backgrounds, footer and logo positions. PinDeck locks this file
   for both backends, so edit it by hand outside PinDeck. Replace the logos in
   `assets/` too.
2. **Everything else in `theme.css`:** type sizes, spacing, layouts and components. This can be done
   in PinDeck with the selected assistant.
3. **`index.html`:** the footer text in the `data-` attributes of `<div class="reveal">`, and the
   `pindeck:footer-top` and `pindeck:locked` meta tags if the footer or the brand elements move.
   `deck.js` holds the math macros, the footer markup and the audio player.
4. **`README.md` and `CLAUDE.md`:** describe the new classes and rules there. PinDeck includes
   the deck’s `CLAUDE.md` in both backends’ instructions; the assistant can read `README.md` for details.
   The example's `CLAUDE.md` calls `../cli.mjs` and `../server.mjs`; fix these paths if the template
   does not sit next to PinDeck.

**New slide** and the PowerPoint import model new slides on the deck's own: keep a slide with class
`title-slide`, one with `section-slide`, and a content slide with `.slide-head` (`h2`, optionally a
`.kicker` or `.sub`) and `.slide-body`. Imported tables take the class of the deck's first table,
and imported audio copies the first `.demo-row` (with a `data-target`). Without a title or section
slide, those PowerPoint slides are imported as content slides; without a `.demo-row`, audio gets
plain players.

## Models, providers and configuration

Open the existing model menu in the chat header to choose a model under **Claude** or
**OpenAI / ChatGPT**. Choices come from the installed backends: Claude's initialization response
and Codex's paginated `model/list`. Hidden or explicitly unavailable entries are omitted. Effort
choices appear in a separate reasoning-effort selector beside the model and follow its reported
capabilities. Readable labels preserve the exact backend values (for example, Extra high sends `xhigh`).
The selector shows provider descriptions where available and distinguishes **Model default** from a
**PinDeck default** fallback. Models without effort controls show a disabled Effort N/A selector.
Effort choices are remembered per provider/model in `effortPreferences` in config.json. A model with
no saved choice uses its default; an unsupported saved choice falls back to the current default.
The picker defaults to GPT-6 models (including 6.x) and the newest discovered Fable, Opus, Sonnet,
and Haiku model in each family. Claude versions are compared numerically from discovered names;
a rolling family alias wins ties, avoiding duplicate entries. **Show all available models** reveals
the full discovered catalog; this display preference is remembered in the browser. A currently selected
older model remains visible and is never switched automatically by the filter.
**Refresh models** retries discovery. A missing CLI, missing sign-in, or discovery failure is shown in its provider group.
These are backend-reported choices, not a guarantee of current quota or entitlement; a later rejected
request reports its error. Older CLIs may expose fewer models than a provider's website.

Changing models within a provider resumes that provider's conversation. Changing providers opens
**Switch with summary**, **Start fresh**, and **Cancel**. A switch prepares the new backend before
replacing the old one. Chat remains visible with a divider, and deck files and undo/redo are retained.
Switching back to a provider creates another new session; it does not silently restore old context.

The current handover is a local, bounded digest of recent user/assistant messages and notices, not an
additional model-generated summary. It excludes tool output, needs no extra inference request, and is
sent with the first message to the new session. Earlier messages may be omitted. **Start fresh** sends
no conversation digest; the assistant still receives PinDeck instructions and the current deck context.

Settings are saved when changed in `~/.pindeck-v3/config.json` (or `$PINDECK_HOME/config.json`):

```json
{
  "provider": "claude",
  "model": "sonnet",
  "effort": "medium"
}
```

Legacy configuration without `provider` is interpreted as Claude. Unsupported effort choices are
adjusted to the discovered model's default when starting. Provider-tagged chat/session records prevent
one backend from resuming the other's IDs. `--provider` and `--model` override startup settings for
that run; a later menu selection is saved. `CLAUDE_BIN` and `CODEX_BIN` override executable paths.

The v3 preview defaults to **`~/.pindeck-v3`**, keeping v2 settings and conversations separate. It does
not copy the v2 directory automatically. To run both versions at once, use another port, for example:

```bash
node server.mjs /path/to/a/deck-copy --port 5183 --provider codex
```

## Backend permissions and attachments

Claude uses its native Read/Edit tools with PinDeck's narrow allowlist, safe mode, and no inherited
MCP configuration. Codex runs with a read-only sandbox, command execution disabled, and no approval
grants. Inherited MCP servers and plugins are disabled in the thread configuration. Codex receives
three host-controlled tools: `pindeck_read`, `pindeck_edit`, and `pindeck_command`.
Only `index.html` and `theme.css` can be edited. Linked writable files and paths outside the allowed
roots are rejected. Commands are restricted to PinDeck's layout, shot, slides, pdf and pdf-figure
helpers, executed with argument arrays rather than a shell. `brand.css` also retains the server's
post-turn restoration safeguard.

Codex reads text, PNG/JPEG/WebP/GIF images and screenshots through the bridge. SVG is read as text.
Attached PDFs are handled page by page using PDFKit on macOS: extracted text plus a rendered page image.
PDF reading/rendering through this bridge is currently macOS-only. Audio is embedded by path and is
not transcribed. Read operations have a 12 MB limit; long text can be read in chunks.

## Keeping the ids out of git

PinDeck adds `data-eid` attributes to the deck it opens. If the deck is in git, run once per clone:

```bash
node cli.mjs git-setup path/to/deck
```

This adds a line like `path/to/deck/*.html filter=pindeck-ids` to `.gitattributes` (commit it) and
defines the filter in the clone's git config: git then strips the ids whenever it reads the deck's
HTML. The ids stay in the file on disk, where PinDeck and the assistant need them, but commits and diffs
never contain them, and a change that only adds ids does not show in `git status`. Your own edits
show and commit as usual. Clones without the filter configured simply see the file as it is.

## Working with it

| Action | How |
|---|---|
| Select, move, resize | Select mode (`V`, the default): click an element to select it, drag to move, pull a handle to resize. Elements snap to the slide edges and centre, the footer rule and other elements (pink guides); hold `Alt` to turn snapping off, `Shift` to move along one axis. Images keep their aspect ratio (`Shift` toggles). Arrow keys nudge by 1 px, `Shift`+arrows by 10 px. `Delete` removes the selected element after a confirmation; a picture goes with its caption, and files nothing else in the deck uses can be deleted with it. `⌘Z` brings both back. |
| Edit text | Double-click the text (or select it and press `Enter`). The element shows its source, so math appears as TeX, e.g. `\(\mu=0.5\)`. `Enter` or a click elsewhere saves, `Esc` cancels, `Shift+Enter` adds a line break, `⌘B` / `⌘I` make text bold or italic. In a bullet, `Enter` splits it at the cursor and continues in a new bullet below; `Enter` on an empty new bullet removes it and stops. Pasted text arrives as plain text. Table cells are edited one at a time. |
| Undo, redo | `⌘Z` / `⇧⌘Z` or the toolbar arrows. One history for your hand edits and the assistant's changes. |
| Pin elements | Press `P` (or the Pin button), click elements; each click gets a number. Click a marker to remove it, `Esc` to stop. |
| Ask the assistant | Write in the sidebar and refer to pins by number: "1: align with 2, make 3 smaller". The selected element is sent too, so "make this smaller" works. `Enter` sends, `Shift+Enter` adds a new line. |
| Visual questions | **+** in the chat, then **Screenshot**: the current slide with its pin markers is attached when you send. |
| Review | Each answer ends with the changed files, a **Diff** button and an **Undo** button (most recent change). |
| Stop | **Stop** interrupts the assistant; the conversation continues. **New chat** starts over. |
| New slide | **＋ New slide** above the slide list: a **content slide** (title and bullets), a **section divider**, or a **duplicate** of the current slide. It is added after the current slide, modelled on the deck's own slides, and its title opens for typing. |
| Import from PowerPoint | **＋ New slide** → **Import from PowerPoint…**, then choose a `.pptx` file and tick the slides you want (hidden PowerPoint slides start unticked). They are added after the current slide in this deck's own layouts, and the assistant can improve the complex ones; see [PowerPoint import](#powerpoint-import). `⌘Z` removes them again, with their figures. |
| Speaker notes | The **Notes** field under the slide shows the current slide's notes (the speaker view, `S`, shows them when presenting). Type to change them; they are saved when you click elsewhere or press `⌘Enter`, and `Esc` puts back what was there. A slide without notes gets them; emptying the field removes them. Notes with formatting other than line breaks are edited as HTML. Drag the line above the notes to give them more or less room (double-click it for the default size); collapse them with their header. |
| Move a slide | Drag it up or down in the slide list; an orange line shows where it will go. It moves with its notes and the comment above it, and `⌘Z` puts it back. Slides inside vertical stacks cannot be moved yet. |
| Hide a slide | The eye on a slide in the list, or `H`. A hidden slide stays in the deck and in PinDeck (greyed out, with a banner) but is skipped when presenting and in PDFs; **Export ▾** can include hidden slides. Show it the same way. |
| Model and effort | Choose a discovered Claude or OpenAI model in the chat header, then use the separate reasoning-effort selector. Provider changes offer an optional handover; same-provider changes continue the conversation. |
| Attach figures and audio | **+** in the chat, then **File…**, drag and drop onto the chat or a slide, or paste an image. Files are saved in `<deck>/figures/` straight away; audio also gets a waveform SVG. Then ask the assistant, e.g. "put this figure on a new slide after 4". Removing an attachment before sending deletes the file again. |
| Attach a PDF | The same way: a figure or table to take over, or a paper or report with more details. PDFs stay outside the deck (in `~/.pindeck-v3`); the assistant reads them, rebuilds tables as HTML, and renders a figure (a page or a cropped part of one) into `<deck>/figures/` as PNG with `cli.mjs pdf-figure` (macOS). E.g. "put Fig. 3 of this paper on slide 7" or "add the results of Table 2 to slide 9". |
| Export PDF | **Export ▾** in the toolbar. **Handout PDF**: one page per slide, build steps shown complete. **Presentation PDF**: one page per click, so a slide with two build steps gives three pages. Files go to `<deck>/export/`. Needs Chrome or Chromium. |
| Navigate | Slide list, `←` `→`, or the toolbar. **Present** opens the deck in a new tab. |

You can also edit `index.html` or `theme.css` in any editor; the slide reloads, and the assistant is told
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

**Hand-off to the assistant.** Slides the import can only approximate are tagged *complex* in the dialog:
diagrams of many shapes or tables with shapes over them that became pictures, pictures placed inside
text (often equations as images), build steps on parts of a diagram, slides without a title, and
text that had to shrink to fit. With **Then ask the assistant to improve the complex slides** ticked, the assistant
gets these slides right after the import, each with a picture of the original slide and the texts of
its diagrams, and rebuilds diagrams as SVG, equations as TeX and tables as HTML in the deck's style.
The request shows in the chat like your own messages, and its changes can be undone as usual.

Without PowerPoint or Keynote (or on other systems than macOS) only the text and the pictures are imported.

## How it works

* **Element ids.** On start, the server gives every slide and every visible element a readable
  `data-eid` attribute (`summary`, `summary/callout`, `summary/li-2`). Only the attribute is
  inserted; the rest of the file stays as it was. A backup of the file before the first change is
  kept in `~/.pindeck-v3/decks/<deck>/backups/`. Ids survive edits, so pins, layout reports and the assistant all name
  the same element.
* **Hand edits.** A move is stored as the CSS `translate` property and a resize as `width`/`height`,
  inline on the element in `index.html`. `translate` moves an element without changing the layout
  around it, for elements in the flow and absolutely positioned ones alike. Only that one style
  attribute is rewritten; the rest of the file stays as it was. The assistant gets a note about each hand
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
  (content below the footer rule, outside the slide, overlaps, clipped text). The assistant gets this as
  text. To check its own work it runs `node ../cli.mjs layout <slide>...` (`--issues` for the
  issues only). Screenshots are
  only taken when you tick the box or the assistant needs a visual judgement.
* **One selected backend.** Claude runs as a long-lived stream-json process; Codex runs as a local
  app-server over stdio. Codex model and effort changes reuse the active thread writer and apply
  to the next turn. Claude changes and provider switches prepare a replacement process before
  retiring the old one. Events from replaced sessions are ignored. Provider-specific tool instructions share the same pin/layout context.
* **Permissions.** The selected backend edits the two slide files through the restrictions described
  above; it does not receive unrestricted workspace write access.
* **Undo.** The server keeps a copy of the editable files from before each change (an AI turn
  or a hand edit). Undo and redo walk that history and tell the assistant on the next message.

## Files

| File | Purpose |
|---|---|
| `server.mjs` | Local server (127.0.0.1 only, random token per run): UI, deck files, events, backend session, undo, CLI endpoints. |
| `cli.mjs` | `layout`, `shot`, `slides`, `pdf handout` / `pdf presentation` and `pdf-figure` commands for the backends (and for you), and `git-setup`. |
| `public/` | The editor page, and `bridge.js`, which is injected into the deck in edit mode (never saved to it). |
| `lib/pptx.mjs`, `lib/zip.mjs`, `lib/xml.mjs` | Reading `.pptx` files (no dependencies): slides, text, shapes and their positions, notes. |
| `lib/pptx-import.mjs` | Turns PowerPoint slides into slides of the deck: figures, tables, build steps, audio, layout, HTML in the deck's style. |
| `lib/waveform.mjs` | Waveform SVGs for imported audio. |
| `lib/omml.mjs` | PowerPoint equations (Office Math) to TeX. |
| `lib/pptx-render.mjs`, `lib/pdf-render.jxa.js` | Slide pictures: PowerPoint or Keynote saves a PDF, macOS PDFKit renders pages and regions of it. |
| `lib/pdf.mjs` | PDF export: reveal.js print layout in headless Chrome, then print to PDF. |
| `lib/eids.mjs` | Adds the `data-eid` attributes by editing the HTML as text. |
| `lib/claude.mjs`, `lib/codex.mjs`, `lib/agent-process.mjs` | Backend adapters and JSON-line transport. |
| `lib/models.mjs`, `lib/agent-tools.mjs` | Model/settings normalization, handover, and restricted Codex tools. |
| `lib/system-prompt.md` | What the assistant is told about the editor. |
| `CONTRIBUTING.md` | How to report bugs and contribute. |
| `docs/` | Images for this README. |
| `LICENSE` | MIT. |

## Current Limitations

* Text inside inline SVG diagrams cannot be edited in place; pin it and ask the assistant.
* Parts of an inline SVG move with the whole SVG; inline text (bold, spans) moves with its block.
* No indenting or outdenting of bullets with `Tab` yet, and `Backspace` at the start of a bullet does not merge it with the one above; ask the assistant for those.
* Moves are offsets (`translate`), so the space an element came from stays reserved. Ask the assistant to turn hand edits into proper CSS when a layout should really change.
* The undo history lives on the server and starts fresh when PinDeck restarts.

## Versions

* **3.0.0-beta.1**: Claude and Codex adapters, discovered model/effort menu, explicit provider
  switching with optional handover, curated model lists, a separate effort selector with per-model
  preferences, restricted Codex tools, and separate v3 runtime state. On npm as `pindeck@beta`.

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

## Contributing

Bug reports, ideas, example decks and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md)
explains how to report a bug, set up PinDeck for development, test a change by hand, and what a pull
request should contain. In short: no npm dependencies, deck files are edited only where they must
change, both backends’ permissions stay narrow, and the README describes what users see.

## License

MIT, see [LICENSE](LICENSE).
