/* Writing deck files safely, and telling whether they changed.

   writeAtomic: the new content goes to a temporary file next to the target, is flushed, gets the target's
   permissions and then replaces the target with one rename. A reader (the browser, Claude, an editor, the
   watcher) sees the old file or the new one, never half of it. A symlinked target is written where the link
   points, so the link stays a link. Each file is atomic on its own; a set of files is not one transaction.

   revision: a hash of the deck's editable files as they are now. The editor sends the revision it shows
   with each change; a different one means someone else changed the files in between (409, nothing written).
   This catches stale edits from the editor. It is not a lock: a program that writes between PinDeck's check
   and its write can still lose its change, so only one writer (PinDeck, Claude, or another tool) at a time. */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function writeAtomic(file, data) {
  let target = file, mode = null;
  try {
    if (fs.lstatSync(file).isSymbolicLink()) target = fs.realpathSync(file);
    mode = fs.statSync(target).mode & 0o7777;
  } catch (e) { if (e.code !== "ENOENT") throw e; }
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.pindeck-${crypto.randomBytes(6).toString("hex")}.tmp`);
  let fd = null;
  try {
    fd = fs.openSync(tmp, "wx", mode ?? 0o666);   // wx: never reuse an existing file
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
    if (mode != null) fs.fchmodSync(fd, mode);   // the umask must not change the file's permissions
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, target);
  } catch (e) {
    if (fd != null) try { fs.closeSync(fd); } catch {}
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw new Error(`Could not save ${path.basename(file)}: ${e.message}`);
  }
}

/* Same bytes? (a missing file is null) */
export function sameContent(file, data) {
  let now;
  try { now = fs.readFileSync(file); } catch (e) { if (e.code === "ENOENT") return data == null; throw e; }
  return data != null && now.equals(Buffer.isBuffer(data) ? data : Buffer.from(data));
}

export function revision(dir, files) {
  const h = crypto.createHash("sha256");
  for (const f of files) {
    let c = null;
    try { c = fs.readFileSync(path.join(dir, f)); } catch {}
    h.update(f + (c == null ? "\0-" : `\0${c.length}\0`));
    if (c) h.update(c);
  }
  return h.digest("hex").slice(0, 16);
}

/* The deck's files for undo: every file a turn may change, with its content (bigger files: only size and
   time, too large to keep a copy of). Hidden files and folders (.git), node_modules, and the vendor/ and
   export/ folders are left out; so are symlinks, which point elsewhere, and the paths in skip (other decks
   in the folder: their files and folders, as paths relative to dir). */
const SKIP_TOP = new Set(["vendor", "export", "node_modules"]);
export const KEEP_BYTES = 2 * 1024 * 1024;
export function scanFiles(dir, { maxBytes = KEEP_BYTES, skip = [] } = {}) {
  const files = new Map(), skipped = new Set(skip);
  const walk = (rel) => {
    let entries = [];
    try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (skipped.has(r)) continue;
      if (e.isDirectory()) { if (rel || !SKIP_TOP.has(e.name)) walk(r); continue; }
      if (!e.isFile()) continue;
      try {
        const st = fs.statSync(path.join(dir, r));
        files.set(r, { size: st.size, mtimeMs: st.mtimeMs, data: st.size <= maxBytes ? fs.readFileSync(path.join(dir, r)) : null });
      } catch {}
    }
  };
  walk("");
  return files;
}

/* What changed between two scans: { rel: { before, after } } with the content on each side (null: the
   file did not exist), and the files that changed but are too large to keep a copy of. */
export function scanChanges(before, after) {
  const changed = {}, tooLarge = [];
  for (const rel of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(rel), a = after.get(rel);
    if (b && a && b.size === a.size && (b.data && a.data ? b.data.equals(a.data) : b.mtimeMs === a.mtimeMs)) continue;
    if ((b && !b.data) || (a && !a.data)) { tooLarge.push(rel); continue; }
    changed[rel] = { before: b ? b.data : null, after: a ? a.data : null };
  }
  return { changed, tooLarge };
}
