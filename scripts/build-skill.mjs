// Builds the Claude skill in claude-skill/pull-program-fit from the app's engine, so the skill and the
// web app always run the same code: copies the engine modules (js/*.js, minus the ?v=N cache busting),
// the methodology and the sample files, then zips the folder to downloads/pull-program-fit-skill.zip.
// The zip is deterministic (fixed file times, sorted entries), so it only changes when the content does.
// Usage: node scripts/build-skill.mjs        (also run by scripts/release.mjs)
//        node scripts/build-skill.mjs --check   (exit 1 if the copies are out of date; used by test/skill.mjs)
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, utimesSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skill = join(root, "claude-skill", "pull-program-fit");
export const ENGINE = ["segment", "insights", "sales", "freshness", "v2", "exceptions", "whatif", "proposal", "readiness", "headers", "format"];
const banner = (src) => `// Generated from ${src} by scripts/build-skill.mjs. Edit the source, not this copy.\n`;

// [target path in the skill, generated content]
export function expectedFiles() {
  const out = ENGINE.map((m) => [`scripts/engine/${m}.js`, banner(`js/${m}.js`) + readFileSync(join(root, "js", `${m}.js`), "utf8").replace(/\?v=\d+"/g, '"')]);
  out.push(["scripts/engine/csv.js", banner("test/csv.mjs") + readFileSync(join(root, "test", "csv.mjs"), "utf8")]);
  out.push(["references/METHODOLOGY.md", readFileSync(join(root, "docs", "METHODOLOGY.md"), "utf8")]);
  for (const f of ["sample_parts.csv", "forecast.csv", "suppliers.csv"]) out.push([`assets/${f}`, readFileSync(join(root, "data", f), "utf8")]);
  return out;
}

const check = process.argv.includes("--check");
const stale = expectedFiles().filter(([p, c]) => !existsSync(join(skill, p)) || readFileSync(join(skill, p), "utf8") !== c).map(([p]) => p);
if (check) {
  if (stale.length) { console.error(`Skill copies out of date: ${stale.join(", ")}. Run node scripts/build-skill.mjs`); process.exit(1); }
  process.exit(0);
}
for (const [p, c] of expectedFiles()) { mkdirSync(dirname(join(skill, p)), { recursive: true }); writeFileSync(join(skill, p), c); }

// Deterministic zip: fixed mtimes, sorted file list, no extra attributes.
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const files = walk(skill).filter((f) => !/\.DS_Store$/.test(f)).sort();
const fixed = new Date("2026-01-01T00:00:00Z");
for (const f of files) utimesSync(f, fixed, fixed);
for (const d of [...new Set(files.map((f) => dirname(f)))]) utimesSync(d, fixed, fixed);
utimesSync(skill, fixed, fixed);
mkdirSync(join(root, "downloads"), { recursive: true });
const zip = join(root, "downloads", "pull-program-fit-skill.zip");
const before = existsSync(zip) ? readFileSync(zip) : null;
const tmp = zip + ".tmp";
rmSync(tmp, { force: true });
execFileSync("zip", ["-X", "-q", "-D", tmp, ...files.map((f) => relative(join(root, "claude-skill"), f))], { cwd: join(root, "claude-skill"), env: { ...process.env, TZ: "UTC" } });
const after = readFileSync(tmp);
if (!before || !before.equals(after)) writeFileSync(zip, after);
rmSync(tmp);
console.log(`Skill built: ${files.length} files, ${(statSync(zip).size / 1024).toFixed(0)} KB → downloads/pull-program-fit-skill.zip${before && before.equals(after) ? " (unchanged)" : ""}`);
