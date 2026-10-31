/* What this server can do on this machine, decided once on the backend and used everywhere: the editor
   (status), the API (refusals before any side effect), the CLI (its error text) and the assistant's system prompt.

   macOS: everything, as before. Linux: editing, the chat, live reload and the PowerPoint import;
   pictures of PDF pages with Poppler, pictures of PowerPoint slides with LibreOffice and Poppler, and
   waveforms of non-WAV audio with ffmpeg, each when installed, else off with a reason. Chrome features (screenshots, headless
   layout, PDF export) work on Linux as on macOS when Chrome or Chromium is found; PINDECK_LINUX_CHROME=0
   turns them off. Each entry is { available, reason }: reason says why not, in plain words. */

import fs from "node:fs";
import path from "node:path";

export const SUPPORTED_PLATFORMS = ["darwin", "linux"];
export const isSupportedPlatform = (platform) => SUPPORTED_PLATFORMS.includes(platform);
export const platformLabel = (platform) => ({ darwin: "macOS", linux: "Linux" }[platform] || platform);

const CHROME_PATHS = {
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/snap/bin/chromium"],
};
const OFFICE_APPS = ["/Applications/Microsoft PowerPoint.app", "/Applications/Keynote.app"];

const isExecutable = (p) => {
  try { return fs.statSync(p).isFile() && (fs.accessSync(p, fs.constants.X_OK), true); } catch { return false; }
};

/* An executable by path, or by name on PATH. Never runs it. Returns { path } or { path: null, reason }. */
export function findExecutable(name, { env = process.env } = {}) {
  if (name.includes("/")) {
    if (isExecutable(name)) return { path: name };
    return { path: null, reason: fs.existsSync(name) ? `${name} is not an executable file` : `${name} does not exist` };
  }
  for (const dir of String(env.PATH || "").split(path.delimiter).filter(Boolean)) {
    const p = path.join(dir, name);
    if (isExecutable(p)) return { path: p };
  }
  return { path: null, reason: `no "${name}" command on the PATH` };
}

const on = () => ({ available: true, reason: "" });
const off = (reason) => ({ available: false, reason });

export function detectCapabilities({ platform = process.platform, env = process.env } = {}) {
  const mac = platform === "darwin";
  const caps = { platform, label: platformLabel(platform) };

  const claudeBin = env.CLAUDE_BIN || "claude";
  const claude = findExecutable(claudeBin, { env });
  caps.claude = claude.path ? on() : off(`Claude Code is not available on the server (${claude.reason}). ` +
    `Install and log in to the claude CLI there, or set CLAUDE_BIN. Editing by hand still works.`);
  const codex = findExecutable(env.CODEX_BIN || "codex", { env });
  caps.codex = codex.path ? on() : off(`OpenAI Codex is not available on the server (${codex.reason}). ` +
    `Install and log in to the codex CLI there, or set CODEX_BIN. Editing by hand still works.`);

  let chrome = null, chromeWhy = "";
  if (env.CHROME_BIN) {
    const c = findExecutable(env.CHROME_BIN, { env });
    chrome = c.path;
    chromeWhy = c.reason ? `CHROME_BIN: ${c.reason}` : "";
  } else {
    chrome = (CHROME_PATHS[platform] || []).find(isExecutable) || null;
    chromeWhy = chrome ? "" : "no Chrome or Chromium found (set CHROME_BIN)";
  }
  if (chrome && platform === "linux" && env.PINDECK_LINUX_CHROME === "0") {
    chrome = null;
    chromeWhy = "Chrome features are turned off (PINDECK_LINUX_CHROME=0)";
  }
  const chromeCap = chrome ? on() : off(chromeWhy);
  caps.chromePath = chrome;
  caps.screenshot = chromeCap;
  caps.headlessLayout = chromeCap;
  caps.pdfExport = chromeCap;

  // Linux: Poppler renders PDF pages, LibreOffice exports PowerPoint slides to PDF, ffmpeg decodes audio
  const has = (name) => !!findExecutable(name, { env }).path;
  const poppler = has("pdftoppm") && has("pdfinfo"), soffice = has("soffice") || has("libreoffice");
  caps.pdfPages = mac || poppler ? on()
    : off("Pictures of PDF pages need Poppler on the server (pdftoppm and pdfinfo; install poppler-utils). Attached PDFs can still be read.");
  caps.pptxImport = on();   // the import itself reads the .pptx file: no other program needed
  caps.pptxPictures = mac ? (OFFICE_APPS.some((a) => fs.existsSync(a)) ? on() : off("Pictures of PowerPoint slides need PowerPoint or Keynote."))
    : soffice && poppler ? on()
    : off("Pictures of PowerPoint slides need LibreOffice (soffice) and Poppler (pdftoppm, pdfinfo) on the server.");
  caps.audioConvert = mac || has("ffmpeg") ? on() : off("Waveforms for audio other than WAV need ffmpeg on the server.");
  return caps;
}

/* The capabilities for the editor and the status API: no executable paths. */
export const publicCapabilities = ({ chromePath, ...caps }) => caps;

/* The lines of Claude's system prompt about what this server cannot do. Empty on a full macOS setup. */
export function capabilityPrompt(caps, cli) {
  const lines = [];
  if (!caps.screenshot.available)
    lines.push(`- \`${cli} shot\` does not work here: ${caps.screenshot.reason}. Use \`${cli} layout\` to check slides; ` +
      `it works while the editor is open in the user's browser.`);
  if (!caps.pdfExport.available) lines.push(`- \`${cli} pdf\` does not work here: ${caps.pdfExport.reason}.`);
  if (!caps.pdfPages.available) lines.push(`- \`${cli} pdf-figure\` does not work here: ${caps.pdfPages.reason}`);
  if (!lines.length) return "";
  return `\n\n## This PinDeck server (${caps.label})\nSome commands are not available, so do not try them:\n${lines.join("\n")}\n`;
}

/* --port / PORT: an integer 0–65535 (0: any free port, for tests). null if invalid. */
export function parsePort(value) {
  const s = String(value ?? "").trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n <= 65535 ? n : null;
}

/* The command Claude runs for the CLI, quoted for the shell. The Bash permission is this exact prefix, so
   it must be one fixed string; double quotes as before, single quotes when the path has characters that
   double quotes do not protect. */
export function cliCommand(rel) {
  if (/^[\w./@%+=:,-]+$/.test(rel)) return `node ${rel}`;
  if (!/["$`\\!]/.test(rel)) return `node "${rel}"`;
  return `node '${rel.replaceAll("'", `'\\''`)}'`;
}
