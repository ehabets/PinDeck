/* The decks the front offers in the editor's deck menu: .html files in the start folder and the asset roots,
   and in their folders one level down. Reading only: a deck gets its element ids (and PinDeck writes its
   state) only once it is opened. A file PinDeck cannot open is listed with the reason, as at start-up. */

import fs from "node:fs";
import path from "node:path";
import { deckTarget } from "./deck-target.mjs";
import { unsupportedMessage } from "./frameworks.mjs";

const SKIP = new Set(["node_modules", "export"]);   // dependencies, and PinDeck's own PDF exports
const MAX_FILES = 300;
const MAX_BYTES = 5 * 1024 * 1024;

// symlinks count as what they point to
const kind = (dir, e) => { if (!e.isSymbolicLink()) return e; try { return fs.statSync(path.join(dir, e.name)); } catch { return e; } };
const htmlFiles = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => /\.html$/i.test(e.name) && !e.name.startsWith(".") && kind(dir, e).isFile()).map((e) => e.name).sort();
  } catch { return []; }
};
const subfolders = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => !e.name.startsWith(".") && !SKIP.has(e.name) && kind(dir, e).isDirectory()).map((e) => e.name).sort();
  } catch { return []; }
};
/* A deck file that is a symlink to a file in another folder cannot be opened: its relative paths (theme.css,
   figures/) would be looked up beside the link, where the files are not. Why, or null. */
export function linkProblem(dir, file) {
  const abs = path.join(dir, file);
  try {
    if (!fs.lstatSync(abs).isSymbolicLink()) return null;
    const real = fs.realpathSync(abs);
    if (path.dirname(real) === fs.realpathSync(dir)) return null;
    return `${file} is a link to a deck in another folder: open that deck itself (${real}).`;
  } catch { return null; }
}

/* [{ key, dir, file, rel, root, problem }]: rel is the path shown in the menu, relative to its root;
   problem is null for a deck PinDeck can open. A file under several roots is listed once, under the first. */
export function listDecks(roots) {
  const out = [], seen = new Set();
  for (const root of roots) {
    for (const dir of [root, ...subfolders(root).map((d) => path.join(root, d))]) {
      for (const file of htmlFiles(dir)) {
        const abs = path.join(dir, file);
        if (seen.has(abs) || out.length >= MAX_FILES) continue;
        seen.add(abs);
        let problem = null;
        try {
          const size = fs.statSync(abs).size;
          problem = linkProblem(dir, file) || (size > MAX_BYTES ? `${file} is larger than 5 MB, too large for a deck.`
            : unsupportedMessage(fs.readFileSync(abs, "utf8"), file)?.replace(/ Nothing was changed\.$/, "") || null);
        } catch (e) { problem = `${file} cannot be read (${e.code || e.message}).`; }
        const t = deckTarget(file === "index.html" ? dir : abs);
        out.push({ key: t.key, dir, file, rel: path.relative(root, abs).split(path.sep).join("/"), root, problem });
      }
    }
  }
  return out;
}
