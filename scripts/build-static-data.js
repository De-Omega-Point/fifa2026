import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchMultiSourceLiveData } from "../api/live-scores.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUTPUT_DIR = path.join(ROOT, "data");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "live-scores.json");

try {
  const payload = await fetchMultiSourceLiveData();
  const snapshot = {
    ...payload,
    source: payload.source || "static-multi-source-live",
    staticSnapshot: true,
    generatedAt: new Date().toISOString()
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);

  console.log(`Wrote ${path.relative(ROOT, OUTPUT_FILE)} with ${snapshot.matches.length} match record(s).`);
} catch (error) {
  const fallback = {
    source: "static-snapshot-error",
    staticSnapshot: true,
    generatedAt: new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    error: error.message,
    warnings: [error.message],
    providers: [],
    ticker: [`STATIC DATA ERROR · ${error.message}`],
    scoreboard: [],
    matches: []
  };

  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(OUTPUT_FILE, `${JSON.stringify(fallback, null, 2)}\n`);

  console.warn(`Wrote ${path.relative(ROOT, OUTPUT_FILE)} with error state: ${error.message}`);
}
