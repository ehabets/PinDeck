# PinDeck 4 beta: review comments and Quarto decks

Branch `v4-beta`, worktree `v4/`. The current way of working (pin, ask, the assistant edits) stays the default.

## Feature 1: review comments (any deck)

Based on Sebastian Schlecht's review mode (fork commit `daf9d8a`), built into the editor instead of a second server.

* **Comment** button next to Send: the text in the box becomes a comment on the pin (one pin, or none for the
  slide as a whole). Nothing is sent to the assistant.
* Comments are stored in `<deck folder>/.pindeck/<deck>.review.json`, outside the deck's files (dot folders
  are never scanned, watched as deck files, or part of an undo), and locked for the assistant.
* Each comment keeps the slide's id attribute, title and position, and the element's id, tag and text, so it
  is found again after edits (`lib/review.mjs`: ok, moved, changed, missing, no-slide). One that cannot be
  found is shown grey, never attached elsewhere.
* Next to it, `<deck>.review.md` is the review packet for an agent outside PinDeck (e.g. Claude Code in VS
  Code). It is rewritten on every change and whenever the deck changes; an agent sets `"status": "resolved"` in
  the JSON and the editor follows.
* **Comments panel** (button in the chat header): the list with slide, text and state; click to go to the
  slide; Resolve/Reopen, Delete. **Send to assistant** puts all open comments into the message box as one
  request, which the user can read and edit before Send.
* Comment pins are drawn on the slides in blue (grey when unmatched), apart from the numbered pins of a message.

Tests: `test/review.test.mjs` (locate, packet, persistence), a server test for the API round trip.

## Feature 2: Quarto decks

* `pindeck talk.qmd` opens a Quarto reveal.js deck. The deck file PinDeck shows is the rendered HTML
  (`talk.html`, found with `quarto inspect`); it is build output, so PinDeck may add its element ids to it.
* **The assistant edits the sources** (`.qmd`, `.scss`/`.css`, figure scripts), never the rendered HTML or
  `talk_files/`, which are locked. The instructions say so and give the slide's source line.
* **PinDeck renders**: a change to a source file (by the assistant, by hand, by Undo) runs `quarto render talk.qmd`
  (one at a time; a change during a render renders again). Screenshots and layout checks wait for a pending
  render, so the assistant always checks the current build. The render output and errors go to the chat.
* **Direct edits are off**: text editing, drag/resize, notes, new/hidden/moved slides, delete and import. The
  server refuses them for a Quarto deck; the editor hides them. Pins, comments, chat, undo (of the assistant's
  changes to the sources), screenshots and PDF export stay.
* Example deck `quarto-mathjax-example/`: signal processing (sampling, aliasing, an FIR filter), with an interactive
  OJS slide.

Tests: deck target and output detection, a render round trip with the real `quarto` (skipped when not installed),
refusal of hand edits.

## Not in this beta

Quarto projects with an `output-dir` (the HTML outside the source folder), several decks per project.

## Added after the first beta build

* The assistant resolves the comments it has addressed: `cli.mjs resolve <id or C3> <what it did>`, allowed for
  Claude and Codex, shown in the list as "Resolved by the assistant: …". It leaves unclear ones open.
* Ocean for Quarto: `quarto-mathjax-example/_extensions/ocean/`, a format extension (`format: ocean-revealjs`). A Lua filter
  writes Ocean's structure into the HTML (kicker, `.slide-body`, footer with slide number, divider number, logos),
  so PinDeck sees and pins it; `quarto.css` maps Ocean's CSS onto Quarto's markup. The extension's `brand.css` and
  `vendor/` are locked like an HTML deck's. Math stays MathJax (macros in `header.html`).
