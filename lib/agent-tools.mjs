/* All Codex writes pass through this host-owned bridge, never through a shell. */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeAtomic } from './deck-files.mjs';
const exec = promisify(execFile);
const text = value => ({ type: 'inputText', text: String(value) });
const schema = properties => ({ type: 'object', properties, additionalProperties: false });
const str = { type: 'string' };
export const renderedImagePath = result => result.match(/^(.+\.png) \(\d+ × \d+ px\)/m)?.[1];
export const deckTools = [
  { type: 'function', name: 'pindeck_read', description: 'Read a deck text file, attached image, screenshot, or PDF page. For PDFs supply a 1-based page; returns page text and its rendered image. For text use offset to read beyond the first 120000 characters.', inputSchema: { ...schema({ path: str, page: { type: 'integer', minimum: 1 }, offset: { type: 'integer', minimum: 0 } }), required: ['path'] } },
  { type: 'function', name: 'pindeck_edit', description: 'Replace one exact unique text occurrence in a file of the deck folder: the deck file, theme.css or another of its files. Read the file first. brand.css, vendor/, .git/ and other decks in the folder are locked.', inputSchema: { ...schema({ path: str, oldText: str, newText: str }), required: ['path', 'oldText', 'newText'] } },
  { type: 'function', name: 'pindeck_write', description: 'Create a new file in the deck folder (missing folders are created), or replace all of an existing one. Prefer pindeck_edit for changes to existing files. The same files are locked as for pindeck_edit.', inputSchema: { ...schema({ path: str, content: str }), required: ['path', 'content'] } },
  { type: 'function', name: 'pindeck_command', description: 'Run a PinDeck command: layout, shot, slides, pdf, or pdf-figure. Pass individual arguments in an array, never a shell command. Use pindeck_read on returned image paths.', inputSchema: { ...schema({ command: { enum: ['layout', 'shot', 'slides', 'pdf', 'pdf-figure'] }, args: { type: 'array', items: str, maxItems: 100 } }), required: ['command', 'args'] } },
];
/* Codex may read the deck, screenshots, attached PDFs and asset roots, and write any file of the deck folder
   except the locked ones: the same rules as Claude's --allowedTools / --disallowedTools. locked: patterns
   such as brand.css or vendor/** (or a function returning them, as the other decks in the folder change);
   env: an object or a function (the server's address is known only once it listens). */
export function createDeckTools({ deckDir, readDirs = [], cliFile, env, pdfTextFile, locked = ['brand.css', 'vendor/**', '.git/**'] }) {
  const deck = fs.realpathSync(deckDir);
  // looked up when used: the state folders (screenshots, attachments) are created once the server listens
  const roots = () => [deck, ...readDirs.flatMap(d => { try { return [fs.realpathSync(d)]; } catch { return []; } })];
  const inside = (root, file) => file === root || file.startsWith(root + path.sep);
  const envNow = () => (typeof env === 'function' ? env() : env);
  // compared regardless of case and Unicode form: on macOS's usual volumes .GIT/config and BRAND.CSS are the
  // locked files themselves
  const fold = p => p.normalize('NFC').toLowerCase();
  const isLocked = rel => (typeof locked === 'function' ? locked() : locked).map(fold)
    .some(p => p.endsWith('/**') ? fold(rel) === p.slice(0, -3) || fold(rel).startsWith(p.slice(0, -2)) : fold(rel) === p);
  function checked(file, write = false) {
    if (typeof file !== 'string' || !file || file.includes('\0')) throw new Error('Invalid file path.');
    const full = path.resolve(deck, file);
    if (write) {
      const rel = path.relative(deck, full).split(path.sep).join('/');
      if (!rel || !inside(deck, full)) throw new Error('Only files inside the deck folder can be edited.');
      if (isLocked(rel)) throw new Error(`${rel} is locked: it cannot be edited in PinDeck.`);
    }
    // Check every component, including missing-file parents, to reject symlink escapes.
    let existing = full;
    while (!fs.existsSync(existing)) { const parent = path.dirname(existing); if (parent === existing) throw new Error('Missing file.'); existing = parent; }
    const real = fs.realpathSync(existing);
    if (!(write ? [deck] : roots()).some(root => inside(root, real)) || (write && real !== existing)) throw new Error('File is outside the permitted directories or is a symlink.');
    if (write && fs.existsSync(full) && (fs.lstatSync(full).isSymbolicLink() || fs.statSync(full).nlink !== 1)) throw new Error('Linked files cannot be edited.');
    return full;
  }
  async function command(name, args, signal) {
    if (!['layout', 'shot', 'slides', 'pdf', 'pdf-figure'].includes(name) || !Array.isArray(args) || args.length > 100 || args.some(a => typeof a !== 'string' || a.length > 4096 || a.includes('\0'))) throw new Error('Invalid PinDeck command.');
    if (name === 'pdf-figure') {
      checked(args[0]);
      // Host renderer can create figures: disallow symlinked output directories too.
      const figures = path.join(deck, 'figures');
      if (fs.existsSync(figures) && fs.realpathSync(figures) !== figures) throw new Error('Linked figures directory is not allowed.');
      for (const a of args.slice(2).filter(a => /^figures\//.test(a))) {
        const full = path.resolve(deck, a);
        if (!inside(figures, full) || (fs.existsSync(full) && (fs.lstatSync(full).isSymbolicLink() || fs.statSync(full).nlink !== 1))) throw new Error('Linked or invalid output file.');
      }
    }
    const { stdout } = await exec(process.execPath, [cliFile, name, ...args], { cwd: deck, env: { ...process.env, ...envNow() }, signal, timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
    return stdout;
  }
  async function read(file, page, offset, signal) {
    const full = checked(file), ext = path.extname(full).toLowerCase();
    if (ext === '.pdf') {
      if (!Number.isInteger(page) || page < 1) throw new Error('Specify a PDF page number, starting at 1.');
      const result = await command('pdf-figure', [full, String(page)], signal);
      const png = renderedImagePath(result);
      if (!png) throw new Error('PDF renderer did not return an image path.');
      let words = '';
      if (process.platform === 'darwin' && pdfTextFile) {
        try { words = (await exec('/usr/bin/osascript', ['-l', 'JavaScript', pdfTextFile, full, String(page)], { signal, timeout: 30000, maxBuffer: 1024 * 1024 })).stdout; }
        catch (e) { if (signal?.aborted) throw e; words = 'Text extraction unavailable; inspect the page image.'; }
      }
      return [text(words), ...await read(png, undefined, 0, signal)];
    }
    if (!fs.statSync(full).isFile()) throw new Error('Read a file, not a directory.');
    if (fs.statSync(full).size > 12 * 1024 * 1024) throw new Error('File exceeds the 12 MB read limit.');
    const data = fs.readFileSync(full);
    const mime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[ext];
    if (mime) return [{ type: 'inputImage', imageUrl: `data:${mime};base64,${data.toString('base64')}` }];
    if (!['.html', '.htm', '.css', '.md', '.txt', '.svg', '.json', '.js', '.mjs', '.csv'].includes(ext)) throw new Error('Read supports text, PNG/JPEG/WebP/GIF images, and rendered PDF pages. Audio is embedded by path, not transcribed.');
    const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    return [text(data.toString('utf8').slice(start, start + 120000))];
  }
  return async (name, args, signal) => {
    signal?.throwIfAborted();
    if (name === 'pindeck_read') return read(args.path, args.page, args.offset, signal);
    if (name === 'pindeck_command') return [text(await command(args.command, args.args, signal))];
    if (name === 'pindeck_edit') {
      const full = checked(args.path, true);
      if (typeof args.oldText !== 'string' || !args.oldText || typeof args.newText !== 'string' || args.newText.length > 2e6) throw new Error('Supply nonempty oldText and replacement text.');
      const old = fs.readFileSync(full, 'utf8');
      if (old.indexOf(args.oldText) < 0 || old.indexOf(args.oldText) !== old.lastIndexOf(args.oldText)) throw new Error('oldText must match exactly once. Re-read the file.');
      signal?.throwIfAborted();
      writeAtomic(full, old.replace(args.oldText, () => args.newText));
      return [text('Edited ' + path.relative(deck, full))];
    }
    if (name === 'pindeck_write') {
      const full = checked(args.path, true);
      if (typeof args.content !== 'string' || args.content.length > 2e6) throw new Error('Supply the file content as text (at most 2 MB).');
      if (fs.existsSync(full) && !fs.statSync(full).isFile()) throw new Error('That path is a folder, not a file.');
      signal?.throwIfAborted();
      fs.mkdirSync(path.dirname(full), { recursive: true });
      writeAtomic(full, args.content);
      return [text('Wrote ' + path.relative(deck, full))];
    }
    throw new Error('Unknown PinDeck tool.');
  };
}
