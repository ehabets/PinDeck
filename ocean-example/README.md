# Ocean slide template

A 16:9 reveal.js deck (1280 × 720) with a deep-ocean look: gradient title and divider slides with layered waves, a wave strip on content slides, blue and turquoise accents, and Inter as the font. Every name, logo and number in it is a placeholder. Everything is bundled, so it runs offline.

## Use it

* Open `index.html` in Chrome, Edge, Firefox or Safari. No server needed.
* Keys: arrows to move, `S` speaker view with notes, `O` overview, `F` full screen, `Esc` back.
* PDF handout: open `index.html?print-pdf` and print to PDF (margins: none, background graphics: on).
* Edit with Claude: `node ../server.mjs .` from this folder opens it in PinDeck.

## Make it yours

| What | Where |
|---|---|
| Title, subtitle, authors, institute, event | the title slide in `index.html` |
| Footer text (authors, institute, short title) | the `data-` attributes of `<div class="reveal">` in `index.html` |
| Logo | replace `assets/logo-placeholder-light.svg` (on dark slides) and `assets/logo-placeholder-dark.svg` (footer) |
| Colours, backgrounds, waves, footer | `brand.css` (the fixed identity; PinDeck locks it for Claude) |
| Type sizes, spacing, layouts, components | `theme.css` |
| Math macros, footer markup, audio player | `deck.js` |
| Figure and demo audio | `python3 figures/make_figures.py` (numpy only), or replace the files |

## Slides in the example

Title, three dividers (`section-slide` with a big outlined number), bullets with build-up, text plus figure, an inline SVG block diagram built up step by step with moving dashes, equations (KaTeX), a results table with a highlighted row, key numbers, an audio demo with play buttons and a sweeping waveform cursor, a summary with a callout, and a closing slide.

## Building blocks

| Class | Use |
|---|---|
| `.slide-head` with `.kicker` and `h2` | turquoise label over the slide title |
| `.bullets` | ocean dots; nested lists get turquoise rings |
| `.cols`, `.cols.wide-left`, `.cols.wide-right`, `.stack` | two columns, or a vertical stack |
| `figure.fig` | image or SVG with caption |
| `.callout` | one highlighted message per slide |
| `table.results` (`.compact`), rows `.ours` `.best` `.focus` `.muted` `.group` | booktabs-style table; rules in `CLAUDE.md` |
| `.eq-list` / `.eq-item` / `.where` | labelled equations and a symbol list |
| `.stats` / `.stat` | key numbers with gradient figures |
| `svg.diagram` with `.box`, `.box.key`, `.box.out`, `.wire.arrow`, `.wire.flow` | block diagrams |
| `.demo` / `.demo-row` / `.wave` / `.play-btn` | audio examples with waveform |
| `.refs` | reference line above the footer |
| `class="fragment"` | build-up step; `data-fragment-index` sets the order |

Keep new slide-level CSS rules scoped to `.reveal .slides section.slide`: Reveal.js copies slide classes onto a full-window background element, so unscoped rules paint outside the slide.

## Math

KaTeX with `\( ... \)` inline and `\[ ... \]` display. Shared macros are defined once in `deck.js` (`\vect`, `\norm`, `\E`, `\dd`).

## Licenses

The template files are yours to use. Third-party software in `vendor/` keeps its own licenses; see `vendor/LICENSES.md`.
