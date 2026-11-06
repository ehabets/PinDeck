# Ocean for Quarto

PinDeck's Ocean slide template as a Quarto format: the same look as `ocean-example/` (1280 × 720 canvas,
wave artwork, kicker over the title, footer with slide number and logo), written in Quarto Markdown.

```yaml
---
title: "Title of Your Talk"
subtitle: "A one-line subtitle"
author: "First Author"
institute: "Institute Name"
event: "Conference Name 2026"        # top right of the title slide
short-title: "Short Title"           # footer (default: the title)
short-authors: "First Author et al." # footer (default: the authors)
format: ocean-revealjs
---
```

Copy `_extensions/ocean/` next to your `.qmd` (Quarto finds extensions there).

## Slides

| Markdown | Slide |
|---|---|
| `## Slide Title {kicker="Method"}` | content slide: kicker, title, body, footer. Titles in Title Case, every content slide has a short kicker |
| `# Part Title` | divider: number, title, the paragraph below it, logo |
| `## Thank You {.closing-slide}` | closing slide; put contact lines in `::: contact` |
| `{.no-foot}` on a heading | content slide without footer |
| `{visibility="hidden"}` on a heading | hidden slide (footer number "–") |
| `::: {.notes}` | speaker notes |
| `::: refs` | references along the bottom of the slide, above the footer |

The body of a content slide sits between y = 168 and the footer rule (y = 652): keep everything above it.

## Classes (theme.css)

Use Ocean's classes on divs and spans: `::: {.cols .wide-left}` with one `:::` div per column, Quarto's
`::: {.callout-note}` (drawn as Ocean's callout), `[text]{.hl}`, `[Author 2024]{.cite}`, `.muted`,
`::: {.stats}` / `.stat`, `table.results` (write the table in HTML), `svg.diagram`, `.demo` (audio demo).
Lists are Ocean's bullets without a class.

Math is MathJax: `$...$` inline, `$$...$$` display; the shared macros `\vect`, `\norm`, `\E`, `\dd` are defined in
`header.html`.

## Files

- `theme.css`: type, layouts and components; restyle a talk here.
- `brand.css`: the fixed identity (palette, waves, footer, logos). Locked in PinDeck: do not edit it.
- `quarto.css`: Ocean on Quarto's markup.
- `ocean.lua`: gives each slide Ocean's structure (kicker, `.slide-body`, footer, divider number, logos).
- `title-slide.html`: the title slide. `header.html`: PinDeck's meta tags and the math macros.
- `assets/`: logos (replace the placeholders with yours). `vendor/fonts/`: Inter.
