/* pindeck --help, and the hint after a bad argument: the front (front.mjs) and a deck server (server.mjs)
   take the same arguments. */
export const USAGE = `Usage: pindeck [deck-folder | deck-file.html] [--port 5180] [--provider claude|codex] [--model <name>] [--asset-root <folder>]...
       pindeck login [deck-folder | deck-file.html]

Opens a reveal.js deck in PinDeck: a deck file such as talk.html, or a folder (default: the current
folder), which then opens its index.html; a folder without one opens a list of its decks. A deck made
otherwise names its slides in its <head> with <meta name="pindeck:slides" content="<CSS selector>"> and
<meta name="pindeck:size" content="1440x1080">.
In the editor, the deck's name opens the other decks in the deck's folder and the asset roots (and one
folder down), each with its own chat and undo, on the same port and login.
login prints a new one-time login link for the running PinDeck (with a deck: one that opens that deck).
--asset-root lets the deck use files outside its folder: a folder that contains the deck (paths such as
../shared/style.css then work), or one that symlinks in the deck may point to. Repeatable; also
"assetRoots" in ~/.pindeck-v3/config.json.`;
