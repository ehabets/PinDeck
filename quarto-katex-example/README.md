# Quarto example with KaTeX

`quarto-mathjax-example/` with KaTeX instead of MathJax: `html-math-method: katex` in `talk.qmd`, and `katex.html` (included in the head) adds Ocean's shared macros (`\vect`, `\norm`, `\E`, `\dd`) to Quarto's KaTeX calls and puts display equations on the left. Slide 2 uses `\vect{x}` to show a macro working.

```bash
pindeck quarto-katex-example/talk.qmd
```
