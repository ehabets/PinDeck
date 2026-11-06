# Quarto example with Python

`quarto-mathjax-example/` plus one slide, "Computed When Rendered": Python code in `talk.qmd` computes the
spectrum of an aliased tone and draws it, and the sentence above the figure takes its numbers from the same code
(`` `{python} f` ``). Change `f` and the figure, the numbers and the "Figure 1" reference all follow at the next
render.

Quarto runs that code at every render, and PinDeck renders after every change, so this example needs Python with
Jupyter and matplotlib, where Quarto finds them (`quarto check jupyter`):

```bash
pip install -r quarto-python-example/requirements.txt
```

```bash
pindeck quarto-python-example/talk.qmd
```
