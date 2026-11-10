/* Poster runtime.
   1. Renders math with KaTeX (shared macros below).
   2. Scales the poster to the window when it is opened in a browser.
   Works from file:// with no network access. */

(function () {
  /* ---- 1. Math ---------------------------------------------------------- */
  renderMathInElement(document.body, {
    delimiters: [
      { left: "\\[", right: "\\]", display: true },
      { left: "\\(", right: "\\)", display: false },
    ],
    throwOnError: false,
    macros: {                         // shared notation: define once, use everywhere
      "\\vect": "\\mathbf{#1}",
      "\\norm": "\\left\\lVert #1\\right\\rVert",
      "\\E": "\\mathbb{E}",
      "\\dd": "\\,\\mathrm{d}",
    },
  });

  /* ---- 2. Fit to the window ---------------------------------------------- */
  // Once, on load: the browser's own zoom (Cmd/Ctrl +) then still enlarges the poster.
  // PinDeck and print ignore --fit and show the poster at its real size.
  const size = /(\d+)\D+(\d+)/.exec(document.querySelector('meta[name="pindeck:size"]')?.content || "");
  if (size) document.documentElement.style.setProperty("--fit", Math.min(1, innerWidth / size[1], innerHeight / size[2]));
})();
