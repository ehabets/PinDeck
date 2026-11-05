# Quarto example: Sampling and Aliasing

A small reveal.js deck written in Quarto, for PinDeck's Quarto support: `talk.qmd` is the source,
`custom.scss` its style, and `talk.html` (with `talk_files/`) what `quarto render talk.qmd` makes of it.
The "Aliasing, interactively" and "A moving-average filter" slides use Observable JS (OJS) sliders, which
load their libraries from the web when shown.

```bash
pindeck quarto-example/talk.qmd
```
