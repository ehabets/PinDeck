/* Asset roots: folders outside the deck whose files the deck may use, from --asset-root (repeatable) and
   "assetRoots" in config.json. Shared by the front, which lists their decks, and each deck server, which
   serves their files, so both read them alike. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const expandHome = (p) => (p === "~" || p.startsWith("~/") ? path.join(os.homedir(), p.slice(1)) : p);

/* { roots, missing }: absolute paths, each once, in the order given; missing: those that are not folders */
export function assetRoots(args = [], config = {}) {
  const roots = [], missing = [];
  for (const r of [...args, ...(Array.isArray(config?.assetRoots) ? config.assetRoots : [])]) {
    const abs = path.resolve(expandHome(String(r)));
    if (roots.includes(abs) || missing.includes(abs)) continue;
    let dir = false;
    try { dir = fs.statSync(abs).isDirectory(); } catch {}
    (dir ? roots : missing).push(abs);
  }
  return { roots, missing };
}
