// Writes public/data/compare.json (compare cards and the principles matrix)
// from scripts/traditions/compare.mjs, checking every card id resolves and
// no summary puts words in quotation marks.
// Usage: node scripts/traditions/build-compare.mjs   (run by npm test)
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { COMPARE, PRINCIPLES } from "./compare.mjs";

const DATA = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "data");
const vols = new Map();
async function passage(id) {
  const vol = id.split(".")[0];
  if (!vols.has(vol)) {
    const file = vol === "meditations" ? path.join(DATA, "library.json") : path.join(DATA, "volumes", `${vol}.json`);
    vols.set(vol, JSON.parse(await readFile(file, "utf8")).passages);
  }
  return vols.get(vol)[id];
}

export async function build({ write = true } = {}) {
  const seen = new Set();
  for (const c of COMPARE) {
    if (seen.has(c.id)) throw new Error(`compare ${c.id}: duplicate`);
    seen.add(c.id);
    if (c.entries.length < 4) throw new Error(`compare ${c.id}: needs at least four entries`);
    for (const e of c.entries) {
      if (!(await passage(e.id))) throw new Error(`compare ${c.id}: ${e.id} is not a card`);
      for (const text of [e.teaching, e.similar]) if (/[“"”]/.test(text)) throw new Error(`compare ${c.id}: no quotation marks in summaries`);
    }
    for (const text of [c.shared, c.differs]) if (/[“"”]/.test(text)) throw new Error(`compare ${c.id}: no quotation marks in summaries`);
  }
  for (const r of PRINCIPLES.rows) if (r.answers.length !== PRINCIPLES.traditions.length) throw new Error(`principles: ${r.question} has the wrong number of answers`);
  if (write) await writeFile(path.join(DATA, "compare.json"), JSON.stringify({ compare: COMPARE, principles: PRINCIPLES }, null, 2) + "\n");
  return { themes: COMPARE.length, links: COMPARE.reduce((n, c) => n + c.entries.length, 0) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build().then((r) => console.log("Compare:", r)).catch((e) => { console.error(e.message); process.exit(1); });
}
