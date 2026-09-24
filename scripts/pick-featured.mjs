// Suggests featured cards for a volume: well-known refs first, then the
// best-themed card-sized passages spread evenly through the work.
// Usage: node scripts/pick-featured.mjs <volume> [count]
import { readFileSync } from "node:fs";

export const FAMOUS = {
  enchiridion: ["Enchiridion 1", "Enchiridion 5", "Enchiridion 8", "Enchiridion 11", "Enchiridion 17", "Enchiridion 33", "Enchiridion 48", "Enchiridion 53"],
  taoteching: ["Tao Te Ching 8", "Tao Te Ching 9", "Tao Te Ching 22", "Tao Te Ching 33", "Tao Te Ching 44", "Tao Te Ching 64", "Tao Te Ching 76", "Tao Te Ching 81"],
  analects: ["Analects 1.1", "Analects 1.4", "Analects 2.4", "Analects 2.17", "Analects 4.16", "Analects 7.21", "Analects 12.2", "Analects 15.23"],
  artofwar: ["Art of War 3.18"],
  dhammapada: ["Dhammapada 1–2", "Dhammapada 3–5"],
};

export function pick(vol, n = 16) {
  const d = JSON.parse(readFileSync(new URL(`../public/data/volumes/${vol}.json`, import.meta.url)));
  const entries = Object.entries(d.passages);
  const chosen = new Map();
  for (const ref of FAMOUS[vol] || []) {
    const hit = entries.find(([, p]) => p.ref === ref || p.ref.startsWith(`${ref}–`) || p.ref.startsWith(`${ref}.`) || p.ref.startsWith(`${ref},`));
    if (hit) chosen.set(hit[0], hit[1]);
  }
  const good = entries.map(([id, p], i) => ({ id, p, i, score: p.themes.length * 2 + (p.text.length >= 200 && p.text.length <= 900 ? 3 : 0) - (p.text.length > 1400 ? 3 : 0) }));
  const slots = n - chosen.size;
  for (let s = 0; s < slots; s++) {
    const lo = Math.floor((s * good.length) / slots), hi = Math.floor(((s + 1) * good.length) / slots);
    const best = good.slice(lo, hi).filter((g) => !chosen.has(g.id)).sort((a, b) => b.score - a.score)[0];
    if (best) chosen.set(best.id, best.p);
  }
  return [...chosen.entries()];
}

if (process.argv[1].endsWith("pick-featured.mjs")) {
  for (const [id, p] of pick(process.argv[2], +process.argv[3] || 16)) {
    const t = p.text.replace(/\n/g, " / ");
    console.log(`\n${id} [${p.ref}] (${p.text.length})\n${t.length > 650 ? t.slice(0, 650) + " …" : t}`);
  }
}
