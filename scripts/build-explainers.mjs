// Builds public/data/explainers/<volume>.json from scripts/explainers/*.mjs.
// Explainers are written for the app (plain English, today, for you) and are
// never quotes. Each source file exports { id-or-ref: { meaning, today, you } };
// Meditations files may use bare refs ("5.20"), other volumes full ids.
//
// Usage: node scripts/build-explainers.mjs   (also run by npm test via the tests)

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, "explainers");
const OUT = path.join(here, "..", "public", "data", "explainers");
const DATA = path.join(here, "..", "public", "data");

export const FIELDS = ["meaning", "today", "you"];

// Quoted multi-word spans must be verbatim from the passage (or not quoted at all).
export function quoteProblems(explainer, passageText) {
  const problems = [];
  const norm = (s) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, " ");
  for (const f of FIELDS) {
    for (const m of (explainer[f] || "").matchAll(/[“"]([^”"]+)[”"]/g)) {
      if (m[1].trim().includes(" ") && !norm(passageText).includes(norm(m[1]))) problems.push(`${f}: "${m[1]}"`);
    }
  }
  return problems;
}

async function passagesFor(vol) {
  const file = vol === "meditations" ? path.join(DATA, "library.json") : path.join(DATA, "volumes", `${vol}.json`);
  return JSON.parse(await readFile(file, "utf8")).passages;
}

export async function build({ write = true } = {}) {
  const files = (await readdir(SRC)).filter((f) => f.endsWith(".mjs")).sort();
  const byVol = {};
  for (const f of files) {
    const vol = f.replace(/\.mjs$/, "").split("-")[0]; // <volume>[-part].mjs
    const mod = (await import(pathToFileURL(path.join(SRC, f)))).default;
    byVol[vol] ??= {};
    for (const [key, e] of Object.entries(mod)) {
      const id = key.startsWith(`${vol}.`) ? key : `${vol}.${key}`;
      if (byVol[vol][id]) throw new Error(`${f}: duplicate explainer for ${id}`);
      byVol[vol][id] = e;
    }
  }
  const counts = {};
  for (const [vol, entries] of Object.entries(byVol)) {
    const passages = await passagesFor(vol);
    for (const [id, e] of Object.entries(entries)) {
      if (!passages[id]) throw new Error(`${id}: no such passage`);
      for (const k of FIELDS) if (!e[k] || e[k].split(/\s+/).length < 8) throw new Error(`${id}: missing or too short "${k}"`);
      const bad = quoteProblems(e, passages[id].text);
      if (bad.length) throw new Error(`${id}: quoted words not in the passage: ${bad.join("; ")}`);
    }
    counts[vol] = Object.keys(entries).length;
    if (write) {
      await mkdir(OUT, { recursive: true });
      await writeFile(path.join(OUT, `${vol}.json`), JSON.stringify(entries) + "\n");
    }
  }
  return counts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  build().then((c) => console.log("Explainers:", c)).catch((e) => { console.error(e.message); process.exit(1); });
}
