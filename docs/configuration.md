# Configuration

[← README](../README.md)

## Models, providers and configuration

Open the existing model menu in the chat header to choose a model under **Claude** or
**OpenAI / ChatGPT**. Choices come from the installed backends: Claude's initialization response
and Codex's paginated `model/list`. Hidden or explicitly unavailable entries are omitted. Effort
choices appear in a separate reasoning-effort selector beside the model and follow its reported
capabilities. Readable labels preserve the exact backend values (for example, Extra high sends `xhigh`).
The selector shows provider descriptions where available and distinguishes **Model default** from a
**PinDeck default** fallback. Models without effort controls show a disabled Effort N/A selector.
Effort choices are remembered per provider/model in `effortPreferences` in config.json. A model with
no saved choice uses its default; an unsupported saved choice falls back to the current default.
The picker defaults to GPT-6 models (including 6.x) and the newest discovered Fable, Opus, Sonnet,
and Haiku model in each family. Claude versions are compared numerically from discovered names;
a rolling family alias wins ties, avoiding duplicate entries. **Show all available models** reveals
the full discovered catalog; this display preference is remembered in the browser. A currently selected
older model remains visible and is never switched automatically by the filter.
**Refresh models** asks the backends again; otherwise the lists are shared by the decks you open for 10 minutes
(`models.json` in the state folder), so opening a deck starts no backend just to list models. A missing CLI,
missing sign-in, or discovery failure is shown in its provider group.
These are backend-reported choices, not a guarantee of current quota or entitlement; a later rejected
request reports its error. Older CLIs may expose fewer models than a provider's website.

Changing models within a provider resumes that provider's conversation. Changing providers opens
**Switch with summary**, **Start fresh**, and **Cancel**. A switch prepares the new backend before
replacing the old one. Chat remains visible with a divider, and deck files and undo/redo are retained.
Switching back to a provider creates another new session; it does not silently restore old context.

The current handover is a local, bounded digest of recent user/assistant messages and notices, not an
additional model-generated summary. It excludes tool output, needs no extra inference request, and is
sent with the first message to the new session. Earlier messages may be omitted. **Start fresh** sends
no conversation digest; the assistant still receives PinDeck instructions and the current deck context.

Each deck keeps its own provider, model and effort with its conversation (in its `chat.json`), so a choice in
one deck never moves another deck's conversation to another backend. The last choice is also saved in
`~/.pindeck-v3/config.json` (or `$PINDECK_HOME/config.json`), as the start for decks that have none yet:

```json
{
  "provider": "claude",
  "model": "sonnet",
  "effort": "medium"
}
```

Legacy configuration without `provider` is interpreted as Claude; a provider without a model gets that
provider's default model. Once the backend has listed its models, a saved model it no longer offers gives way
to its default model (the chat says so), and an effort the model does not offer to its saved or default one,
before the first message. config.json is read again and merged whenever a choice is saved, so decks open at
the same time keep each other's effort preferences. Provider-tagged chat/session records prevent one backend
from resuming the other's IDs. `--provider` and `--model` override the deck's settings for that run; a
`--provider` other than the deck's starts a new conversation (the chat says so), and the next run without it
is back on the deck's own choice. A later menu selection is saved. `CLAUDE_BIN` and `CODEX_BIN` override
executable paths. `CLAUDE_MODEL`, which PinDeck 2 read, is not used: PinDeck warns and names `--model`.

PinDeck 3 defaults to **`~/.pindeck-v3`**, keeping v2 settings and conversations separate. It does
not copy the v2 directory automatically; `config.json` and `decks/*/chat.json` can be copied over by hand
(asset roots too: they are in config.json). Never give both versions the same `PINDECK_HOME`: they keep files
of the same names in different formats and overwrite each other's settings and chats. PinDeck 3 warns at
start when its folder holds a chat that PinDeck 2 wrote. To run both versions at once, use another port, for
example:

```bash
node front.mjs /path/to/a/deck-copy --port 5183 --provider codex
```

## Backend permissions and attachments

Claude uses its native Read/Edit tools with PinDeck's narrow allowlist, safe mode, and no inherited
MCP configuration. Codex runs with a read-only sandbox, command execution disabled, and no approval
grants. Inherited MCP servers and plugins are disabled in the thread configuration. Codex receives
four host-controlled tools: `pindeck_read`, `pindeck_edit`, `pindeck_write` and `pindeck_command`.
Both assistants may edit and create the files of the deck folder: the deck file, `theme.css` and its other
files. Never `brand.css`, `vendor/`, `.git/`, or the other decks in the folder (its other `.html` files, and
subfolders that hold a deck of their own). Linked writable files and paths outside the allowed roots are
rejected. Commands are restricted to PinDeck's layout, shot, slides, pdf and pdf-figure helpers, executed
with argument arrays rather than a shell. `brand.css` also retains the server's post-turn restoration safeguard.

Codex reads text, PNG/JPEG/WebP/GIF images and screenshots through the bridge. SVG is read as text.
Attached PDFs are handled page by page: a rendered page image (PDFKit on macOS, Poppler on Linux), plus the
page's text on macOS. Audio is embedded by path and is not transcribed. Read operations have a 12 MB limit;
long text can be read in chunks.

### Files outside the deck folder

A deck can use files from a folder around it, such as a style sheet or figures shared by several
talks: start PinDeck with `--asset-root <folder>` (repeatable), or list the folders in config.json as
`"assetRoots": ["~/talks"]`. When the folder contains the deck, PinDeck serves the deck from inside
it, so relative paths such as `../shared/style.css` work, in the editor, in screenshots and in PDF
exports. Claude may read those files but does not edit them.

Symlinks: PinDeck serves a file only if, with symlinks followed, it lies inside the deck folder or an
asset root. A symlink in the deck that leads anywhere else is refused (403). To use a symlinked
library folder, add the folder it points to as an asset root; it does not have to contain the deck.
PinDeck never writes or deletes through a symlink out of the deck folder: with a `figures/` or `export/`
that links elsewhere, uploads, exports and deleting a picture's file are refused with the reason.

## Keeping the ids out of git

PinDeck adds `data-eid` attributes to the deck it opens. If the deck is in git, run once per clone:

```bash
node cli.mjs git-setup path/to/deck
```

This adds a line like `path/to/deck/*.html filter=pindeck-ids` to `.gitattributes` (commit it) and
defines the filter in the clone's git config: git then strips the ids whenever it reads the deck's
HTML. The ids stay in the file on disk, where PinDeck and the assistant need them, but commits and diffs
never contain them, and a change that only adds ids does not show in `git status`. Your own edits
show and commit as usual. Clones without the filter configured simply see the file as it is.
