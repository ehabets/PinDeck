/* CI: one annotation per failing test (its name and error) from a TAP file, shown on the run's page and in
   pull requests, and readable through GitHub's API. node .github/tap-annotations.mjs tap.txt */
import fs from "node:fs";

const lines = fs.readFileSync(process.argv[2], "utf8").split("\n");
lines.forEach((l, i) => {
  const m = /^(\s*)not ok \d+ - (.*)$/.exec(l);
  if (!m || m[1]) return;   // top-level tests only
  const rest = lines.slice(i + 1, i + 60), end = rest.findIndex((x) => /^(not )?ok \d+ /.test(x));
  const body = (end < 0 ? rest : rest.slice(0, end)).join("\n");
  const err = /error: (?:\|-?\n)?([\s\S]*?)\n\s*(code|failureType|stack|expected|actual|operator):/.exec(body)?.[1] || body;
  const msg = err.replace(/^\s+/gm, "").slice(0, 900).replace(/%/g, "%25").replace(/\r?\n/g, "%0A");
  console.log(`::error title=${m[2].replace(/[:,]/g, " ").slice(0, 200)}::${msg}`);
});
