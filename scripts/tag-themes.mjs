// Tags every passage with its subjects (public/js/themes.js) and records how
// many cards of each subject every volume holds, so Mix can pick volumes for
// a subject without downloading them all. Only the `themes` fields change;
// passage text and checksums are untouched. Run after any ingest or after
// editing themes.js:  npm run themes   (npm test checks it has been run)
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tagThemes, THEMES } from "../public/js/themes.js";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "data");
const VOLS = path.join(DATA, "volumes");

export function countThemes(passages) {
  const counts = Object.fromEntries(Object.keys(THEMES).map((k) => [k, 0]));
  for (const p of Object.values(passages)) for (const t of tagThemes(p.text)) counts[t]++;
  return counts;
}

async function main() {
  const counts = {};
  for (const f of (await readdir(VOLS)).filter((f) => f.endsWith(".json") && f !== "index.json")) {
    const file = path.join(VOLS, f);
    const d = JSON.parse(await readFile(file, "utf8"));
    for (const p of Object.values(d.passages)) p.themes = tagThemes(p.text);
    counts[f.slice(0, -5)] = countThemes(d.passages);
    await writeFile(file, JSON.stringify(d) + "\n");
  }
  const indexFile = path.join(VOLS, "index.json");
  const index = JSON.parse(await readFile(indexFile, "utf8"));
  for (const v of index.volumes) v.themes = counts[v.id];
  await writeFile(indexFile, JSON.stringify(index, null, 2) + "\n");
  const tradFile = path.join(DATA, "traditions.json");
  const trad = JSON.parse(await readFile(tradFile, "utf8"));
  for (const t of trad.traditions) t.themes = counts[t.id];
  await writeFile(tradFile, JSON.stringify(trad, null, 2) + "\n");
  console.log(`Tagged ${Object.keys(counts).length} volumes with ${Object.keys(THEMES).length} subjects`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
