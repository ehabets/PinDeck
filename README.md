# PinDeck

> **macOS and Linux · Version 4 beta preview** (`4.0.0-beta.1`). The beta is on npm’s `beta` channel and the [`v4-beta`](https://github.com/ehabets/PinDeck/tree/v4-beta) branch; the stable release is 3.4.0 (`npx pindeck`, on [`main`](https://github.com/ehabets/PinDeck)). On Linux, PinDeck runs as a headless server that you use from your Mac's browser through an SSH tunnel (see [Running on a Linux server](docs/linux-server.md#running-on-a-linux-server)). Windows is not supported. The beta keeps its settings and chats in `~/.pindeck-v4`, apart from 3.x (`~/.pindeck-v3`) and 2.x (`~/.pindeck`) (see [Models, providers and configuration](docs/configuration.md#models-providers-and-configuration)).

**Pin it. Say it. Done.** PinDeck is a local editor for HTML slide decks (reveal.js): the slides on the left, the slide in the middle, and a chat with Claude Code or OpenAI Codex on the right. You click elements to pin them, write what to change, and the selected assistant edits the HTML and CSS. The slide updates in place.

![PinDeck: the slide list, slide 10 of the example deck with two numbered pins, and the chat with Claude's answer to an earlier request and a new one being typed](docs/pindeck.png)

*The example deck in PinDeck. Claude has lined up the three numbers from the first request and checked the layout; the next request, still being typed, refers to the new pins 1 and 2.*

## Features

* **Point instead of describe.** Pins name the exact element, word or table cell; "make 2 match 1" is enough. The assistant also gets the measured layout of the slide, so it sees overlaps and overflow without screenshots.
* **Edit by hand, too.** Move, resize and nudge elements with snapping, edit text in place (math stays TeX), write speaker notes, add, hide, move and delete slides. One undo history covers your edits and the assistant's.
* **Stay on brand.** `brand.css` is locked: the assistant edits the deck, its styles and other files of the deck folder, never `brand.css` or `vendor/`, and checks its own work with PinDeck's layout command.
* **Bring material in.** Attach figures, audio and PDFs to a message, or import slides from PowerPoint into the deck's own layouts.
* **Get it out.** Present from the browser, or export a handout or presentation PDF.
* **Local and small.** One Node process on 127.0.0.1, no npm dependencies, your existing Claude Code or Codex login.

## Quick start

Runs on macOS and Linux. The npm package declares `"os": ["darwin", "linux"]`, so normal npm installation rejects other operating systems. Overriding that check does not make those platforms supported. Running the server from a cloned repository on another OS shows a local support notice instead of opening the deck or starting a backend.

Install the beta from npm:

```bash
npx pindeck@beta /path/to/deck
# Or select this exact beta:
npx pindeck@4.0.0-beta.1 /path/to/deck
```

Or run it from the `v4-beta` branch, which includes the example decks:

```bash
git clone -b v4-beta https://github.com/ehabets/PinDeck.git
cd PinDeck
node front.mjs ocean-example
```

PinDeck 2 stays available as `npx pindeck@2 /path/to/deck` (source: the [`2.x`](https://github.com/ehabets/PinDeck/tree/2.x) branch). Releases, with notes for each version, are on [GitHub](https://github.com/ehabets/PinDeck/releases).

Then open the login link PinDeck prints (`PinDeck: http://127.0.0.1:5180/login?code=...`). It works once and logs this browser in; for a new one, run `pindeck login` (or `node front.mjs login`). On a Mac, pressing Enter in the terminal where PinDeck runs opens a new link in your default browser.

The deck is an `.html` file (`pindeck path/to/talk.html`) or a folder, which opens its `index.html`; without one, the current folder. Several decks can share a folder, each with its own chat and undo history; they share the folder's `theme.css` and `brand.css`, and the assistant edits only the deck that is open. PinDeck adds element ids to the deck file when it opens it (see [How it works](docs/how-it-works.md)), so try it on a copy of a deck first. Options: `--port 5180`, `--provider claude|codex`, `--model <name>` (for this run only; otherwise the deck's own choice, see [Models, providers and configuration](docs/configuration.md#models-providers-and-configuration)), `--asset-root <folder>` (see [Files outside the deck folder](docs/configuration.md#files-outside-the-deck-folder)), `--help`. Runtime files (chat history, screenshots, backups) are kept in `~/.pindeck-v4/` (change with `PINDECK_HOME`), not in the deck. `ocean-example/` is a complete example deck to start from.

## Compatibility and requirements

* **Runtime:** Node.js 20 or later, plus a modern browser. The release workflow uses Node.js 24.
* **Backends:** install and sign in to Claude Code (`claude auth login`) or OpenAI Codex (`codex login`). The corresponding executable must be on `PATH`; `CLAUDE_BIN` and `CODEX_BIN` can override its path. Only the selected backend is required for editing. Model and effort availability comes from that backend and account, and may differ from the provider’s website or desktop app.
* **Platforms:** macOS and Linux (see [Running on a Linux server](docs/linux-server.md#running-on-a-linux-server)). Windows is not supported. The npm package declares `"os": ["darwin", "linux"]`, so normal npm installation rejects other operating systems. This check can be overridden; bypassing it does not make those platforms supported. Source launches on unsupported platforms show a local support page without opening the deck or starting a backend. Native Windows support is a possible v4 feature, not part of version 3.
* **Screenshots and PDF export:** require Chrome, Chromium, Edge or Brave where the server runs.
* **PDF input through Codex:** pages are rendered with macOS PDFKit, or Poppler on Linux. Page-text extraction uses `osascript` and is macOS-only; on Linux Codex reads the rendered page image. Claude uses its native PDF-reading capabilities.
* **PowerPoint import:** basic `.pptx` parsing uses Node.js; rendered slide pictures require PowerPoint or Keynote on macOS, or LibreOffice and Poppler on Linux.
* **Linux tools:** Poppler, LibreOffice and ffmpeg, each optional; features that need a missing one are switched off with the reason shown in the editor.

The initial live editing checks used Codex CLI **0.144.1** and Claude Code **2.1.289**. Further live checks on macOS passed with Codex CLI **0.162.1** and Claude Code **2.1.301**: editing, Claude effort changes, Codex model changes, conversation handover, undo/redo, cancellation and recovery. These are tested versions, not guaranteed minimum requirements. Backends must support the discovery and session interfaces used by PinDeck. Older CLIs can expose fewer models or fail initialization.

Codex integration uses OpenAI’s experimental `dynamicTools` extension to the app-server. A future Codex update may require a PinDeck adapter update. Incompatible backends report startup errors; PinDeck does not fall back to broader permissions. Recheck backend compatibility when upgrading.

## Documentation

* [Using PinDeck](docs/using.md): several decks, every action in the editor, review comments.
* [Preparing decks](docs/preparing-decks.md): getting a deck ready, your own template, Quarto decks, PowerPoint import.
* [Configuration](docs/configuration.md): models and providers, backend permissions and attachments, keeping the ids out of git.
* [Running on a Linux server](docs/linux-server.md): the headless server and the SSH tunnel.
* [How it works](docs/how-it-works.md): the architecture, the files, and the current limitations.
* [Changelog](CHANGELOG.md): what each version brought.

## "Created by PinDeck" badge

Made your slides with PinDeck? Feel free to put the badge on a closing slide. Its QR code links to this repository. Use the
[light](docs/badge/created-by-pindeck-light.svg) or [dark](docs/badge/created-by-pindeck-dark.svg) SVG, or the
[light](docs/badge/created-by-pindeck-light.png) or [dark](docs/badge/created-by-pindeck-dark.png) PNG. To keep the code easy to scan, show it at least 300 px wide.

## Contributing

Bug reports, ideas, example decks and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) explains how to report a bug, set up PinDeck for development, test a change by hand, and what a pull request should contain. In short: no npm dependencies, deck files are edited only where they must change, both backends’ permissions stay narrow, and the README describes what users see.

## License

MIT, see [LICENSE](LICENSE).
