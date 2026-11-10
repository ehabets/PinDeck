# Ocean poster template

A conference poster as one HTML page, in the look of the Ocean slide template (`../ocean-example/`): a deep-ocean header with waves, numbered blocks in columns, and a footer with references, contact and logo. Every name, logo and number in it is a placeholder. Everything is bundled, so it runs offline.

| File | Format | Columns | Canvas |
|---|---|---|---|
| `portrait.html` | A0 portrait, 841 × 1189 mm | 2 | 3179 × 4494 px |
| `landscape.html` | A0 landscape, 1189 × 841 mm | 3 | 4494 × 3179 px |

The canvas is A0 at 96 px per inch, so 1 px is 0.75 pt on paper and the PDF comes out at A0. A1 and the other A sizes have the same proportions: print the PDF scaled (A1 is 71 %).

## Use it

* Open `portrait.html` or `landscape.html` in Chrome, Edge, Firefox or Safari. No server needed. The poster is scaled to the window; zoom in with the browser to read it.
* Edit with PinDeck: `node ../front.mjs portrait.html` from this folder (or `pindeck path/to/portrait.html`). The poster is the deck's only slide; pin, move and edit as on a slide.
* PDF: **Export** in PinDeck (the handout PDF is the poster, one A0 page), or print from the browser to PDF (margins: none, background graphics: on).

Keep only the file you need. Both share `theme.css` and `brand.css`.

## Make it yours

| What | Where |
|---|---|
| Title, subtitle, authors, institute, event | `<header class="poster-head">` |
| Content | the `.block` sections in the columns of `.poster-body` |
| References, contact | `<footer class="poster-foot">` |
| Logo | replace `assets/logo-placeholder-light.svg` (header) and `assets/logo-placeholder-dark.svg` (footer) |
| Colours, header, block look, footer | `brand.css` (the fixed identity; PinDeck locks it for the assistant) |
| Type sizes, spacing, columns, components | `theme.css` |
| Math macros | `poster.js` |

For another size, change the `pindeck:size` tag and the `@page` size in the HTML file, and the width and height of `.poster` in `theme.css`.

## Building blocks

| Class | Use |
|---|---|
| `.col` | one column: a stack of blocks |
| `section.block` with `h2` and `.block-body` | a numbered block; the numbers follow the reading order |
| `.block.alt`, `.block.tint` | second heading colour; tinted body |
| `.block.grow` | takes the free height of its column, so the columns end level |
| `.block-body.even` | spreads the free height of a grown block between its parts |
| `.bullets` | dots; nested lists get rings |
| `.cols`, `.cols.wide-left`, `.cols.wide-right` | two columns inside a block |
| `figure.fig` | image or SVG with caption; set its width with `style="width:…%"` |
| `.callout` | one highlighted message |
| `table.results` (`.compact`), rows `.ours` `.best` `.focus` `.muted` `.group` | booktabs-style table |
| `.eq-list` / `.eq-item` / `.where` | labelled equations and a symbol list |
| `.stats` / `.stat` | key numbers |
| `svg.diagram` with `.box`, `.box.key`, `.box.out`, `.wire.arrow` | block diagrams |
| `.small`, `.muted`, `.hl`, `.cite` | smaller, grey, highlighted text; a citation mark |

Figures are best as SVG, which stays sharp at any size. A photo or screenshot needs about 100 px per 25 mm of printed width or more.
