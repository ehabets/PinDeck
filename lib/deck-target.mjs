/* Which deck a path names, and where PinDeck keeps that deck's state: shared by the front (pindeck), which
   lists decks and addresses them as /d/<key>/, and the deck server, which keeps its chat and undo there. */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

export const homeDir = (env = process.env) => env.PINDECK_HOME || path.join(os.homedir(), ".pindeck-v3");

/* A file (talk.html), or a folder, which means its index.html. A path ending in .html that is
   not a folder is a file, so a missing file gets a clear message. */
export function deckTarget(target) {
  const abs = path.resolve(target);
  const isFolder = (() => { try { return fs.statSync(abs).isDirectory(); } catch { return false; } })();
  const dir = isFolder || !/\.html$/i.test(abs) ? abs : path.dirname(abs);
  const file = dir === abs ? "index.html" : path.basename(abs);
  const named = file !== "index.html";   // a deck file with its own name; several can share a folder
  const name = named ? file.replace(/\.html$/i, "") : path.basename(dir);   // for exports and titles
  /* State per deck file. A folder's index.html keeps the key it always had, so existing chats and undo
     histories stay; a named file gets its own, so two decks in one folder never share chat or undo. */
  const key = (named ? `${path.basename(dir)}-${name}` : path.basename(dir)).replace(/[^\w.-]+/g, "_") + "-" +
    crypto.createHash("sha1").update(named ? path.join(dir, file) : dir).digest("hex").slice(0, 8);
  return { dir, file, named, name, key };
}
