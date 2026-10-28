# Contributing to PinDeck

Thanks for helping. Bug reports, ideas, example decks and pull requests are all welcome.

## Reporting a bug

Open an issue with:

* what you did, what you expected and what happened instead;
* the PinDeck version (`package.json`), Node version, operating system and browser;
* for AI issues: the selected provider, model, reasoning effort, and installed backend CLI version;
* the terminal output of `pindeck` (or `node front.mjs`), and errors from the browser console if there are any;
* if a deck is involved: the smallest piece of `index.html` (and `theme.css`) that shows the problem;
* for the PowerPoint import: a small `.pptx` with only the slide that goes wrong, if you can share it.

Do not attach decks or slides you may not share. Chat history and backups in `~/.pindeck-v3/` (`~/.pindeck/` for v2) can contain
your slides' text, so check before you attach anything from there.

## Suggesting a feature

Open an issue first and describe the situation it helps with. PinDeck tries to stay small: one page,
a chat, and edits that change only what they must in the deck's own files. A short discussion before
the code saves work on both sides.

## Setting up

```bash
git clone https://github.com/ehabets/PinDeck.git
cd PinDeck
node cli.mjs git-setup ocean-example   # keep PinDeck's data-eid ids out of your commits
node front.mjs ocean-example           # then open http://127.0.0.1:5180/
```

There is nothing to install: PinDeck has no npm dependencies. You need macOS or Linux, Node 20 or later
and the `claude` CLI; Chrome is used for screenshots and PDF export, PowerPoint or Keynote (macOS) for
the pictures in the PowerPoint import. What a system can do is decided in one place,
`lib/capabilities.mjs`: a feature that needs something missing is switched off there, with a reason, rather
than failing when used.

Useful while developing:

* `PINDECK_HOME=/tmp/pindeck-dev` keeps chat history, backups and settings away from your own `~/.pindeck`.
* Work on a copy of a deck (`cp -R ocean-example /tmp/deck`) when you try things that change it.
* `--port` runs a second PinDeck next to your usual one; `CLAUDE_BIN` and `CHROME_BIN` point to other binaries.

## Making a change

* **No dependencies.** Everything is plain JavaScript (ES modules) on Node's standard library and the
  browser. Please keep it that way; a small helper in `lib/` is better than a package.
* **Edit the deck as text.** PinDeck changes only the attribute, style or element it means to and
  leaves the rest of the file exactly as it was (see `lib/eids.mjs`). New code that writes to a deck
  should do the same.
* **Keep backend permissions narrow.** Both backends may edit only `index.html` and `theme.css`.
  Claude uses allowlisted native tools and `cli.mjs`; Codex uses PinDeck’s restricted tool bridge; `brand.css` is locked. The server listens on 127.0.0.1 only and every API call needs
  the per-run token. Changes that widen any of this need a good reason in the pull request.
* **Match the code around it:** short functions, comments that say why, plain wording in the UI and
  the README.
* **Document what users see.** Update the README: the "Working with it" table for new actions, "Current
  Limitations" when one goes away, and a line for the "Versions" list in your pull request. The
  maintainer assigns the version number (see below).

## Versions

PinDeck numbers its releases `major.minor.patch`:

* **Minor** (2.7 → 2.8): anything users can do or notice that they could not before: a feature, a
  command or CLI option, a setting, or a change in how something behaves. A release that mixes fixes
  with even one such change is a minor release.
* **Patch** (2.8 → 2.8.1): fixes and polish only; nothing new to learn.
* **Major** (1.x → 2.0): a large new part of PinDeck (2.0 brought the PowerPoint import), or a change
  that breaks existing decks or habits.

Each release is one commit titled `PinDeck X.Y: what it brings` (or `X.Y.Z`), sets `"version"` in
`package.json` to `X.Y.Z`, adds its line at the top of the README's "Versions" list, and gets an
annotated tag `vX.Y.Z` with the message `PinDeck X.Y.Z`. Commits between releases (documentation, say)
keep the version as it is.

`git push --follow-tags` pushes the release and its tag; the tag starts a GitHub Actions workflow that
stages the version on npm. It goes live once a maintainer approves it with 2FA, on npmjs.com or with
`npm stage approve <stage-id>` (the workflow's log and `npm stage list pindeck` show the id).

### Beta releases

Keep v3 preview work on `v3-beta` while `main` remains stable. Public betas use versions such as
`3.0.0-beta.1`, with an annotated Git tag `v3.0.0-beta.1`. Increment the final number for each beta.
Create a GitHub prerelease with known limitations and installation instructions.

The staging workflow explicitly selects `beta` for prerelease versions (those containing `-`) and
`latest` for stable versions. Approval publishes to the channel chosen when staging; it does not
promote a beta to `latest`. Verify the staged version and channel before approving. Testers run
`npx pindeck@beta /path/to/deck`; stable users run `npx pindeck@latest /path/to/deck`.
Each beta updates the version in the README’s notice and install example.

## Testing

Run `npm test` (Node's built-in test runner, `test/*.test.mjs`); it needs neither a live AI backend (Claude or Codex) nor a browser.
`test/server.test.mjs` starts real PinDeck servers on copies of `ocean-example` with their own
`PINDECK_HOME` and a fake `claude` and `codex` (`test/fixtures/fake-agent`, no network and no AI). Tests for the other
platform override `process.platform` and say so in their name. They check the code paths, not that
platform, so a Linux change needs a run on real Linux (the CI workflow does that). Never point tests or a
manual run at your own decks; use copies.
Then check your change by hand before you open a pull request:

1. `node --check` on the files you changed.
2. Run PinDeck on `ocean-example/` and, if you have one, a deck of your own (copies, if your change
   edits the deck) and go through what your change touches, for example:
   * select, move, resize and nudge an element, then undo and redo;
   * edit text (also math, a table cell, and Enter in a bullet) and speaker notes;
   * pin elements and send a message; check the layout with `node cli.mjs layout <slide> --issues`;
   * add, duplicate, hide, move and delete slides;
   * export a handout and a presentation PDF;
   * import slides from a PowerPoint file, if you changed `lib/pptx*.mjs`, `lib/omml.mjs` or `lib/zip.mjs`.
3. Check that the deck file changed only where it should (`git diff` with the git filter set up).

More tests that run without a live AI backend or a browser, for example for `lib/eids.mjs` or the PowerPoint
import, are a very welcome contribution in themselves.

## Pull requests

* One topic per pull request, with a short description of what changes for the user and how you tested it.
* Keep commits free of `data-eid` attributes in the example decks (`node cli.mjs git-setup` takes care of that).
* By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).
