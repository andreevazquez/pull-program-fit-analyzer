// Prepares a deploy: runs every test, then bumps the ?v=N cache-busting version in all
// asset URLs and module imports so browsers never mix old and new files.
// Usage: node scripts/release.mjs   then commit and push.
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const t of readdirSync(join(root, "test")).filter((f) => f.endsWith(".mjs") && f !== "csv.mjs").sort()) {
  try {
    execFileSync(process.execPath, [join(root, "test", t)], { stdio: "pipe" });
    console.log(`  ok   test/${t}`);
  } catch (e) {
    console.log(e.stdout?.toString() || e.message);
    console.error(`FAIL test/${t}: fix it before releasing.`);
    process.exit(1);
  }
}

const list = (dir) => readdirSync(join(root, dir), { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? list(`${dir}/${d.name}`) : [`${dir}/${d.name}`]));
const files = ["index.html", ...list("js"), ...list("test")].filter((f) => /\.(html|js|mjs)$/.test(f));
const versions = files.flatMap((f) => [...readFileSync(join(root, f), "utf8").matchAll(/\?v=(\d+)"/g)].map((m) => +m[1]));
const next = Math.max(0, ...versions) + 1;
let touched = 0;
for (const f of files) {
  const path = join(root, f), src = readFileSync(path, "utf8");
  const out = src.replace(/\?v=\d+"/g, `?v=${next}"`);
  if (out !== src) { writeFileSync(path, out); touched++; }
}
console.log(`Asset version → v=${next} in ${touched} files. Commit and push to deploy.`);
