import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");

const FILES = [
  "index.html",
  "public.html",
  "app.js",
  "public.js",
  "styles.css",
  "data/live-scores.json"
];

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });

for (const file of FILES) {
  const source = path.join(ROOT, file);
  const target = path.join(DIST, file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

await writeFile(path.join(DIST, ".nojekyll"), "");

console.log(`Built GitHub Pages output in ${path.relative(ROOT, DIST)}/`);
