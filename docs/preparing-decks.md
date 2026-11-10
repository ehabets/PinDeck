# Preparing decks

[← README](../README.md)

## Preparing a deck

PinDeck works with reveal.js decks whose slides are `<section>` elements inside `.slides`, and with other decks that name their slides (see [Decks made without reveal.js](#decks-made-without-revealjs)). Two optional `<meta>` tags in the deck's `<head>` tell it about the design:

```html
<meta name="pindeck:footer-top" content="652">          <!-- y of the footer rule: content must stay above it -->
<meta name="pindeck:locked" content=".slide-foot, .logo"> <!-- brand elements that cannot be selected or moved -->
```

Hidden slides use reveal.js's `data-visibility="hidden"`. If the deck numbers its slides itself (as the example's `deck.js` does for the footer), count only slides without that attribute, or the numbers will jump where a slide is hidden.

Without them PinDeck runs no footer check and locks only `.slide-foot` and `.logo`. A file called `brand.css` in the deck folder is locked for both backends. See `ocean-example/` for a complete deck.

### Decks made without reveal.js

A deck with a script of its own, or made with a framework whose slides are elements of their own (Shower, deck.js, a hand-written deck), can be edited too once it names its slides in its `<head>`:

```html
<meta name="pindeck:slides" content="main.deck > section.slide">  <!-- a CSS selector for the slides -->
<meta name="pindeck:size" content="1440x1080">                     <!-- their size in px -->
```

The selector may use tag names, `#id`, `.class`, `[attr]` and `[attr="value"]`, joined by spaces or `>`, and a list of them separated by commas. In the editor, PinDeck shows the slides itself, one at a time and scaled to the window, and switches off the deck's own scaling, slide keys and inert or hidden marks while you edit; that changes nothing in the deck file. Everything in [Working with it](using.md#working-with-it) works as with a reveal.js deck, with these differences:

* Build steps (`.fragment`) belong to reveal.js: other decks show every element at once.
* Hidden slides (`data-visibility="hidden"`) are left out of PinDeck's PDF exports; whether presenting skips them is up to the deck's own script.
* Speaker notes are an `<aside class="notes">` in the slide, as in reveal.js. PinDeck hides them in the editor; the deck's CSS should hide them too (`aside.notes { display: none }`).
* **Present** opens the deck at `#<slide id>`, or `#<number>` (counting from 1) for a slide without an id. Present may open on the first slide if the deck does not go to slides by their address.
* **＋ New slide** models a new slide on the deck's own (see [Making your own template](#making-your-own-template)): a content slide gets placeholder bullets in a `.slide-body`; without one it has only its title. A new or duplicated slide does not take the original's `id`.

Both tags are needed: PinDeck opens the slides at the given size for screenshots and PDF pages. A missing size, or a selector that finds no slides or that PinDeck cannot read, is reported before anything changes. While PinDeck runs, it reads the tags again for every screenshot, PDF and assistant session; the editor reads them when the slide reloads. If a tag stops working meanwhile, the editor shows the same message and the assistant is told. A session already running keeps the slide selector it started with; **New chat** starts one with the new selector.

### Posters

A poster is a deck with one slide: a page that names itself as the slide and gives its size, as above.

```html
<meta name="pindeck:slides" content="main.poster">
<meta name="pindeck:size" content="3179x4494">   <!-- A0 portrait at 96 px per inch -->
```

`ocean-poster-example/` has two posters in the Ocean look: `portrait.html` (A0 portrait, two columns) and `landscape.html` (A0 landscape, three columns). Open one with `pindeck ocean-poster-example/portrait.html`. At 96 px per inch the exported handout PDF is one A0 page; print it scaled for A1 (71 %) or another A size. The example's `README.md` lists its blocks and says how to change the size.

Attach the paper or the slides to a message and ask the assistant to fill the blocks; it checks that every column fits. The poster is shown whole at first: zoom in from the bottom right corner of the slide area (see [Working with it](using.md#working-with-it)). Figures are best as SVG; a figure cut from a PDF with `pdf-figure` is at most 4000 px wide, enough for about a column.

## Making your own template

PinDeck has no template generator; a template is simply a deck folder. Start from a copy of the example:

```bash
cp -R ocean-example my-template
```

1. **Brand in `brand.css`:** palette, backgrounds, footer and logo positions. PinDeck locks this file for both backends, so edit it by hand outside PinDeck. Replace the logos in `assets/` too.
2. **Everything else in `theme.css`:** type sizes, spacing, layouts and components. This can be done in PinDeck with the selected assistant.
3. **`index.html`:** the footer text in the `data-` attributes of `<div class="reveal">`, and the `pindeck:footer-top` and `pindeck:locked` meta tags if the footer or the brand elements move. `deck.js` holds the math macros, the footer markup and the audio player.
4. **`README.md`, `CLAUDE.md` and `AGENTS.md`:** both backends follow the deck's `CLAUDE.md` and `AGENTS.md`, so describe the new classes and rules there; the assistant can read `README.md` for details. Refer to PinDeck's commands as "the PinDeck CLI command given in the system prompt", as the example's `CLAUDE.md` does; PinDeck tells the assistant the right path wherever the deck is. An older `node ../cli.mjs` in a deck's `CLAUDE.md` is replaced with that command.

**Instructions for the assistant.** PinDeck gives both backends the deck folder's own `CLAUDE.md` and `AGENTS.md`. It does not load such files from parent folders, as Claude Code and Codex do in a terminal: those are usually written for coding (run the tests, commit), which PinDeck's assistant cannot do; they would change with where the deck happens to sit; and on a shared server a parent folder may be writable by others. To share rules between decks, say so in the deck's own file, in one of two ways:

- **Import:** `Follow @../shared/STYLE.md for wording.` includes that file's text. Paths are relative to the file they are in (or absolute, or `~/...`); imported files may import others, up to 5 levels, each file once, 200 KB in all. Only text files are imported; an e-mail address, an `@name` that is not a file, and anything in code are left as written.
- **Pointer:** `The style rules are in ../shared/STYLE.md; read them first.` The assistant reads the file when it needs it.

**New slide** and the PowerPoint import model new slides on the deck's own: keep a slide with class `title-slide`, one with `section-slide`, and a content slide with `.slide-head` (`h2`, optionally a `.kicker` or `.sub`) and `.slide-body`. Imported tables take the class of the deck's first table, and imported audio copies the first `.demo-row` (with a `data-target`). Without a title or section slide, those PowerPoint slides are imported as content slides; without a `.demo-row`, audio gets plain players.

## Quarto decks

PinDeck opens reveal.js decks written in [Quarto](https://quarto.org): name the source, or the HTML Quarto made from it (the `.qmd` must be beside it).

```bash
pindeck quarto-mathjax-example/talk.qmd
```

* **The source is what changes.** The rendered `talk.html` and `talk_files/` are build output: locked for the assistant, which edits `talk.qmd` and the files it uses (its `.scss` theme, figures) instead. Its instructions explain how pins on the rendered slides map to the source.
* **PinDeck renders.** On start, if the HTML is older than the source, and after every change to a source file, by the assistant, by Undo or by you in any editor. The slide reloads when the render is done; the assistant's `shot`, `layout` and `slides` wait for it, and Quarto's errors go to the chat and to the assistant.
* **No hand edits.** Moving, resizing, text editing, notes, new, hidden, moved or deleted slides and the PowerPoint import would be overwritten by the next render, so they are off. Pins, comments, the chat, Undo of the assistant's changes, screenshots and PDF export work as usual.
* **The Ocean template in Quarto.** `format: ocean-revealjs` gives a Quarto deck the look of `ocean-example/` (title slide, dividers, kicker over the title, footer with slide number and logo). Copy `quarto-mathjax-example/_extensions/ocean/` next to your `.qmd`; its `README.md` lists the Markdown for each layout. As in an HTML deck, its `brand.css` and `vendor/` are locked for the assistant and its `theme.css` is not.
* `quarto-mathjax-example/` is a short signal-processing deck in Ocean (sampling, aliasing, a moving-average filter) with interactive Observable JS slides.
* `quarto-python-example/` is the same deck with a slide whose figure and numbers Python computes at each render. It needs Jupyter and matplotlib (`pip install -r quarto-python-example/requirements.txt`).

## PowerPoint import

The import keeps what can be carried over exactly and makes pictures of the rest:

* **Text becomes HTML** in the deck's layouts: the title (and the subtitle, as a `.sub` line or a kicker, as the deck does it), bullets with their levels, numbered lists, bold, italics, coloured words (as `.hl`), superscripts, web and mail links and line breaks, other text as paragraphs, references at the bottom of a slide as `.refs`, and the speaker notes. Side notes and labels clearly smaller than the body text stay smaller.
* **Tables become HTML tables** with the class of the deck's own tables, merged header cells, header rows and a caption from the text above them. Cells merged down in the body become a label on the group's first row with empty cells below it, and each later group's first row gets `class="group"`. A table with shapes drawn over it (e.g. boxes marking rows) is kept as a picture instead.
* **Build steps:** shapes and paragraphs that appear (or disappear) on a click become reveal.js fragments in the same order, also when several things appear on one click. A picture made of several shapes appears on a click only if all of its shapes do.
* **Audio** goes into the deck's own audio player (a copy of its first `.demo-row`, with a waveform made from the sound), labelled with the nearest text on the slide; without such a player, plain players. **Video** keeps its place, with its poster frame. The first slide is filled into the deck's title slide (title, subtitle, authors, event, institute) and PowerPoint section headers into its section divider.
* **Pictures are copied** to `figures/` (`<file>-s04-1.png`, ...).
* **Everything drawn** (diagrams built from shapes and arrows, charts, pictures with labels on them, EMF graphics) becomes a picture cut from the slide as PowerPoint renders it. For this PinDeck asks PowerPoint (or else Keynote) to save the presentation as a PDF; macOS asks once whether PinDeck may control the app. The same PDF gives the thumbnails in the import dialog.
* **Layout:** blocks that sit side by side become `.cols` with the slide's proportions, others are stacked top to bottom; figures and, if needed, the text are scaled so that the slide fits.
* **Equations** (PowerPoint's equation editor) become TeX for the deck's KaTeX: `\( \)` in the text, `\[ \]` on their own line; fractions, scripts, roots, sums and integrals, functions and limits, accents, braces, matrices and the bold, italic and double-struck math letters are converted.
* **Hidden slides** stay hidden (`data-visibility="hidden"`).

**Hand-off to the assistant.** Slides the import can only approximate are tagged *complex* in the dialog: diagrams of many shapes or tables with shapes over them that became pictures, pictures placed inside text (often equations as images), build steps on parts of a diagram, slides without a title, and text that had to shrink to fit. With **Then ask the assistant to improve the complex slides** ticked, the assistant gets these slides right after the import, each with a picture of the original slide and the texts of its diagrams, and rebuilds diagrams as SVG, equations as TeX and tables as HTML in the deck's style. The request shows in the chat like your own messages, and its changes can be undone as usual.

Without PowerPoint or Keynote (or on other systems than macOS) only the text and the pictures are imported.
