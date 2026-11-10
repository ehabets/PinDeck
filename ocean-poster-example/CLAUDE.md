# Ocean poster template: rules for editing

- `portrait.html` and `landscape.html` are two posters with the same content; each is one page
  (`main.poster`), which PinDeck treats as the only slide. `theme.css` holds the styles.
  `README.md` lists the blocks and classes.
- `brand.css` is the fixed identity (palette, header, block look, footer, logos). Do not edit it;
  say so if a request needs a brand change.
- The canvas is A0 at 96 px per inch: 3179 x 4494 px (portrait, two columns) or 4494 x 3179 px
  (landscape, three columns). Type is large: body text 44 px, never below 28 px.
- Content lives in `section.block` elements inside the `.col` columns. Everything must fit the
  poster: a column that is too tall runs into the footer. After a change, check the layout and
  shorten text, shrink a figure or move a block to another column if something overflows.
- One block per column has the class `grow`, so the columns end level. Block numbers come from
  CSS; do not type them.
- Block titles in Title Case. Use the existing blocks and classes before adding new ones.
- Math is KaTeX: `\( ... \)` inline, `\[ ... \]` display; shared macros live in `poster.js`.
- Prefer SVG figures. Tables follow the rules of `table.results` in `theme.css`; highlight with row
  classes only.

## Element ids (`data-eid`)

When the poster is opened in PinDeck, the page and every visible element get a `data-eid`
attribute. Keep ids unchanged when editing an element. Give new elements
`data-eid="<slide-id>/<short-name>"`.

## Checking layout

When the poster is open in PinDeck, use the PinDeck CLI command given in the system prompt
(written `<cli>` here):

- `<cli> layout 1`: measured boxes, font sizes and layout issues.
- `<cli> shot 1`: PNG screenshot; prints the path.
