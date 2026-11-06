# Quarto example: Sampling and Aliasing

A small reveal.js deck written in Quarto, for PinDeck's Quarto support: `talk.qmd` is the source, and
`talk.html` (with `talk_files/`) what `quarto render talk.qmd` makes of it. It uses the Ocean template as a
Quarto format (`format: ocean-revealjs`, in `_extensions/ocean/`; see its README for the layouts). The
"Aliasing, Interactively" and "A Moving-Average Filter" slides use Observable JS (OJS) sliders, which load their
libraries from the web when shown.

```bash
pindeck quarto-mathjax-example/talk.qmd
```
