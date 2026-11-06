# Running on a Linux server

[← README](../README.md)

## Running on a Linux server

PinDeck can run on a Linux machine where the deck lives, with the editor in your Mac's browser. The
deck, PinDeck, the backend (Claude Code or Codex) and the deck's git clone all stay on the server; the browser only shows the
editor. The server listens on 127.0.0.1 there, as on a Mac, and an SSH tunnel brings that port to your Mac.

On the server you need Node 20 or later (22 or 24 recommended), git if the deck is in a repository, and
the `claude` or `codex` CLI installed and logged in under your account there, if you want the chat. Without one,
editing by hand still works. Then, in one SSH session on the server:

```bash
node front.mjs path/to/deck --port 5180
```

and on your Mac, in another terminal (`myserver` is your usual SSH host):

```bash
ssh -N -T -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -L 127.0.0.1:5180:127.0.0.1:5180 myserver
```

Open the login link PinDeck printed on the server in the Mac's browser. The local port may differ from
the server's: with `-L 127.0.0.1:8080:127.0.0.1:5180`, change 5180 in the link to 8080. PinDeck accepts any
port, as long as the address is `127.0.0.1`: `localhost` is where decks are presented, and nobody logs in there. If the tunnel drops, a message you have already sent keeps running on the
server. Restart the tunnel and the editor reconnects and shows the files as they are then; it never sends a
message twice. If PinDeck restarts, the editor asks you to log in again: run `node front.mjs login
path/to/deck` on the server for a new link.

Other users of a shared server cannot open the editor or read the deck through PinDeck: the token that
protects it is only in your browser's cookie and in PinDeck's own files in `~/.pindeck-v3` (readable only by
you), never in a page or on a command line.

What works on Linux: editing by hand, speaker notes, slides, pins, the chat with Claude or Codex,
Undo/Redo, live reload when files change on the server, layout checks, attaching figures, audio and
PDFs, `git-setup` and the PowerPoint import. Some features use programs on the server, and are on when
they are installed (on Debian or Ubuntu: `sudo apt install poppler-utils libreoffice-impress ffmpeg`):

| Feature | Needs |
|---|---|
| Screenshots, layout checks without an open editor, PDF export | Chrome or Chromium (`PINDECK_LINUX_CHROME=0` turns these off) |
| Pictures of PDF pages (`pdf-figure`) | Poppler (`pdftoppm`, `pdfinfo`) |
| Pictures of PowerPoint slides in the import (thumbnails, diagrams) | LibreOffice (`soffice`) and Poppler |
| Waveforms of audio other than WAV in the import | ffmpeg |

Without them the editor says what is missing (hover over "Server: Linux"), and the assistant is told
which commands are not available. LibreOffice may draw some slides a little differently from PowerPoint;
the pictures are references and figures, the slides themselves are rebuilt from the file. Chromium from snap may not be
allowed to use hidden folders in your home folder such as `~/.pindeck-v3`; if screenshots fail with it, set
`PINDECK_HOME` to a folder that is not hidden (not the one PinDeck 2 uses), or install Chrome or Chromium from
a package. Run as root (in a container, say), PinDeck starts Chrome with `--no-sandbox`, which Chrome needs
there; a screenshot or PDF that fails gives Chrome's own reason.

One PinDeck serves all your decks on one port, and a deck can be open in only one PinDeck at a time (a
second one says where it is open). While PinDeck or the assistant is working on a deck, do not edit it with other tools
or switch git branches at the same time. Stop first, or wait until the assistant has finished. PinDeck notices
changes made by other programs and reloads, and it refuses Undo, Redo or an edit that would overwrite
them. Its checks cannot rule out every race with a program that writes at the same moment.
