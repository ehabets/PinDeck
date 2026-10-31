import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { detectCapabilities, capabilityPrompt, parsePort, cliCommand, findExecutable, isSupportedPlatform } from "../lib/capabilities.mjs";

function bin(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pindeck caps "));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const p = path.join(dir, name);
  fs.writeFileSync(p, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  return { dir, p };
}

test("supported platforms: macOS and Linux, nothing else", () => {
  assert.ok(isSupportedPlatform("darwin"));
  assert.ok(isSupportedPlatform("linux"));
  for (const p of ["win32", "freebsd", "openbsd", "sunos", "aix"]) assert.equal(isSupportedPlatform(p), false);
});

test("claude is found on the PATH or through CLAUDE_BIN, never run", (t) => {
  const { dir, p } = bin(t, "claude");
  assert.equal(detectCapabilities({ platform: "linux", env: { PATH: dir } }).claude.available, true);
  assert.equal(detectCapabilities({ platform: "linux", env: { PATH: "/nonexistent" } }).claude.available, false);
  assert.equal(detectCapabilities({ platform: "linux", env: { PATH: "", CLAUDE_BIN: p } }).claude.available, true);
  fs.chmodSync(p, 0o644);
  const c = detectCapabilities({ platform: "linux", env: { PATH: "", CLAUDE_BIN: p } }).claude;
  assert.equal(c.available, false);
  assert.match(c.reason, /not an executable file/);
  assert.match(c.reason, /Editing by hand still works/);
});

test("codex is found on the PATH or through CODEX_BIN, never run", (t) => {
  const { dir, p } = bin(t, "codex");
  assert.equal(detectCapabilities({ platform: "linux", env: { PATH: dir } }).codex.available, true);
  assert.equal(detectCapabilities({ platform: "linux", env: { PATH: "/nonexistent" } }).codex.available, false);
  assert.equal(detectCapabilities({ platform: "linux", env: { PATH: "", CODEX_BIN: p } }).codex.available, true);
  assert.match(detectCapabilities({ platform: "linux", env: { PATH: "/nonexistent" } }).codex.reason, /CODEX_BIN/);
});

test("Linux: import on; tool features off with reasons until their tools exist; Chrome on unless turned off", (t) => {
  const { p, dir } = bin(t, "chromium");
  const caps = detectCapabilities({ platform: "linux", env: { PATH: "", CHROME_BIN: p } });
  for (const k of ["pdfPages", "pptxPictures", "audioConvert"]) {
    assert.equal(caps[k].available, false, k);
    assert.ok(caps[k].reason.length > 10, k);
  }
  assert.match(caps.pdfPages.reason, /Poppler/);
  assert.match(caps.pptxPictures.reason, /LibreOffice/);
  assert.match(caps.audioConvert.reason, /ffmpeg/);
  assert.equal(caps.pptxImport.available, true, "the import reads the .pptx itself");
  // with the tools on the PATH (stand-ins here): each feature turns on
  for (const name of ["pdftoppm", "pdfinfo", "soffice", "ffmpeg"]) fs.writeFileSync(path.join(dir, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const tools = detectCapabilities({ platform: "linux", env: { PATH: dir, CHROME_BIN: p } });
  for (const k of ["pdfPages", "pptxPictures", "audioConvert"]) assert.equal(tools[k].available, true, k);
  fs.rmSync(path.join(dir, "pdftoppm"));
  const noPoppler = detectCapabilities({ platform: "linux", env: { PATH: dir, CHROME_BIN: p } });
  assert.equal(noPoppler.pdfPages.available, false);
  assert.equal(noPoppler.pptxPictures.available, false, "LibreOffice alone is not enough: Poppler renders its PDF");
  for (const k of ["screenshot", "pdfExport", "headlessLayout"]) assert.equal(caps[k].available, true, k);
  assert.equal(caps.chromePath, p);
  const off = detectCapabilities({ platform: "linux", env: { PATH: "", CHROME_BIN: p, PINDECK_LINUX_CHROME: "0" } });
  assert.equal(off.screenshot.available, false);
  assert.match(off.screenshot.reason, /PINDECK_LINUX_CHROME=0/);
  assert.equal(off.chromePath, null);
  const missing = detectCapabilities({ platform: "linux", env: { PATH: "", CHROME_BIN: "/no/chrome" } });
  assert.match(missing.screenshot.reason, /CHROME_BIN: \/no\/chrome does not exist/);
});

test("macOS: Chrome through CHROME_BIN; PDF pages, import and audio conversion available", (t) => {
  const { p } = bin(t, "Google Chrome");
  const caps = detectCapabilities({ platform: "darwin", env: { PATH: "", CHROME_BIN: p } });
  for (const k of ["screenshot", "pdfExport", "headlessLayout", "pdfPages", "pptxImport", "audioConvert"]) assert.equal(caps[k].available, true, k);
  assert.equal(capabilityPrompt(caps, "node cli.mjs"), "");
});

test("Claude's system prompt names the commands this server cannot run", () => {
  const caps = detectCapabilities({ platform: "linux", env: { PATH: "", CHROME_BIN: "/no/chrome" } });   // CI has Chrome
  const p = capabilityPrompt(caps, "node cli.mjs");
  assert.match(p, /Linux/);
  assert.doesNotMatch(p, /beta/i);
  assert.match(p, /`node cli\.mjs shot` does not work here/);
  assert.match(p, /`node cli\.mjs pdf-figure` does not work here/);
  assert.match(p, /`node cli\.mjs layout`/);
});

test("ports: whole numbers 0-65535 only", () => {
  assert.equal(parsePort(5180), 5180);
  assert.equal(parsePort("5181"), 5181);
  assert.equal(parsePort("0"), 0);
  for (const bad of ["", "abc", "-1", "70000", "5180x", "1e3", "51.8", null, undefined]) assert.equal(parsePort(bad), null, String(bad));
});

test("the CLI command survives the shell for paths with spaces, quotes and $", () => {
  for (const rel of ["../PinDeck/cli.mjs", "../My Tools/PinDeck/cli.mjs", `../it's "here"/cli.mjs`, "../$HOME `x` \\ !/cli.mjs"]) {
    const cmd = cliCommand(rel);
    assert.ok(cmd.startsWith("node "));
    const out = execFileSync("/bin/sh", ["-c", `printf '%s' ${cmd.slice(5)}`], { encoding: "utf8" });
    assert.equal(out, rel);
  }
  assert.equal(cliCommand("../PinDeck/cli.mjs"), "node ../PinDeck/cli.mjs");
  assert.equal(cliCommand("../My Tools/cli.mjs"), 'node "../My Tools/cli.mjs"');   // as before 2.9
});

test("findExecutable does not accept folders", (t) => {
  const { dir } = bin(t, "x");
  assert.equal(findExecutable(dir).path, null);
});
