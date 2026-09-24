// Builds the Traditions wing: curated, verbatim passages from public-domain
// (or CC0) editions of five traditions' core texts, per the plan's
// "Traditions wing" (four weekly themes, 25–40 passages each).
//
// Usage: node scripts/ingest-traditions.mjs [--from <cache dir>] [--show <tradition>]
//   --from   read sources from a local cache (files are saved there on first fetch)
//   --show   print the selected passages for review instead of writing
//
// Writes public/data/volumes/<tradition>.json (same shape as other volumes,
// plus week, original text, licence and source) and public/data/traditions.json.
// Compare cards and the principles matrix are built separately (traditions/build-compare.mjs).
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./ingest.mjs";
import { tagThemes } from "../public/js/themes.js";
import { TRADITIONS, WEEKS } from "./traditions/selections.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "public", "data");

const SEFARIA = "https://storage.googleapis.com/sefaria-export/json/";
const JPS = "The Holy Scriptures A New Translation JPS 1917";
const TANAKH = {
  Genesis: "Torah", Exodus: "Torah", Leviticus: "Torah", Numbers: "Torah", Deuteronomy: "Torah",
  Isaiah: "Prophets", Micah: "Prophets", Joshua: "Prophets",
  Psalms: "Writings", Proverbs: "Writings", Ecclesiastes: "Writings", Job: "Writings",
};
export const SOURCES = {
  jps: { work: "Tanakh", translator: "Jewish Publication Society (1917)", licence: "Public domain", url: "https://www.sefaria.org (Sefaria export; JPS 1917 via Open Siddur)" },
  avot: { work: "Pirkei Avot", translator: "Charles Taylor (1897)", licence: "Public domain", url: "https://www.sefaria.org (Sefaria export)" },
  web: { work: "Bible", translator: "World English Bible", licence: "Public domain", url: "https://ebible.org/web/ (via github.com/TehShrike/world-english-bible)" },
  imitation: { work: "The Imitation of Christ", translator: "William Benham (1874)", licence: "Public domain", url: "https://www.gutenberg.org/ebooks/1653 (via GITenberg)" },
  quran: { work: "Quran", translator: "Marmaduke Pickthall (1930)", licence: "Public domain (translation); Arabic: Tanzil Quran Text (Simple), tanzil.net, copied verbatim with attribution", url: "https://tanzil.net (via github.com/fawazahmed0/quran-api)" },
  gita: { work: "Bhagavad Gita", translator: "Kisari Mohan Ganguli (1883–1896)", licence: "Public domain", url: "https://www.sacred-texts.com/hin/m06/ (Mahabharata, Bhishma Parva 25–42; via github.com/itz-rajkeshav/sacred-texts)" },
  upanishad: { work: "Upanishads", translator: "Swami Paramananda (1919)", licence: "Public domain", url: "https://www.gutenberg.org/ebooks/3283 (via GITenberg)" },
  sutta: { work: "Suttas", translator: "Bhikkhu Sujato", licence: "CC0 (public domain dedication)", url: "https://suttacentral.net (via github.com/suttacentral/bilara-data)" },
};

const WEB_FILE = (book) => book.toLowerCase().replace(/\s+/g, "");
const URLS = {
  jps: (book) => `${SEFARIA}Tanakh/${TANAKH[book]}/${book}/English/${encodeURIComponent(JPS)}.json`,
  avot: () => `${SEFARIA}Mishnah/Seder%20Nezikin/Pirkei%20Avot/English/${encodeURIComponent("Sayings of the Jewish Fathers Pirqe Aboth translated by Charles Taylor [1897]")}.json`,
  web: (book) => `https://raw.githubusercontent.com/TehShrike/world-english-bible/master/json/${WEB_FILE(book)}.json`,
  imitation: () => "https://raw.githubusercontent.com/GITenberg/The-Imitation-of-Christ_1653/master/1653.txt",
  quran: () => "https://raw.githubusercontent.com/fawazahmed0/quran-api/1/editions/eng-mohammedmarmadu.json",
  arabic: () => "https://raw.githubusercontent.com/fawazahmed0/quran-api/1/editions/ara-quransimple.json",
  gita: () => "https://raw.githubusercontent.com/itz-rajkeshav/sacred-texts/main/src/mahabharata/Data/bhishma-parva.json",
  upanishad: () => "https://raw.githubusercontent.com/GITenberg/The-Upanishads_3283/master/3283.txt",
  sutta: (uid) => `https://raw.githubusercontent.com/suttacentral/bilara-data/published/translation/en/sujato/sutta/${SUTTA_PATH(uid)}_translation-en-sujato.json`,
};
const SUTTA_PATH = (uid) => {
  const [, coll, n] = uid.match(/^([a-z]+)(\d+)/);
  if (coll === "snp") return `kn/snp/vagga${n}/${uid}`;
  if (coll === "mn" || coll === "dn") return `${coll}/${uid}`;
  return `${coll}/${coll}${n}/${uid}`;
};

// ---------- fetching, with an optional local cache ----------

let cacheDir = null;
const cache = new Map();
async function get(url) {
  if (cache.has(url)) return cache.get(url);
  const file = cacheDir && path.join(cacheDir, encodeURIComponent(url).slice(-180));
  let text;
  if (file) text = await readFile(file, "utf8").catch(() => null);
  if (text == null) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    text = await res.text();
    if (file) await writeFile(file, text);
  }
  cache.set(url, text);
  return text;
}
const json = async (url) => JSON.parse(await get(url));

// ---------- text helpers ----------

const tidy = (s) => s.replace(/<[^>]+>/g, "").replace(/[ \t ]+/g, " ").replace(/ *\n */g, "\n").trim();
// "4-9" -> [4..9]; "4" -> [4]
const range = (spec) => {
  const [a, b] = String(spec).split(/[-–]/).map(Number);
  return Array.from({ length: (b || a) - a + 1 }, (_, i) => a + i);
};
// Exact slice of a source between two phrases (both included), whitespace collapsed.
function between(text, start, end, label) {
  const flat = text.replace(/\s+/g, " ");
  const i = flat.indexOf(start);
  if (i < 0) throw new Error(`${label}: start not found: ${start}`);
  const j = flat.indexOf(end, i);
  if (j < 0) throw new Error(`${label}: end not found: ${end}`);
  return flat.slice(i, j + end.length).trim();
}

// ---------- extractors: each returns { text, ref, source, original? } ----------

const EX = {
  async jps({ book, ch, v, lines }) {
    const d = await json(URLS.jps(book));
    const verses = range(v).map((n) => tidy(d.text[ch - 1][n - 1] || ""));
    if (verses.some((x) => !x)) throw new Error(`${book} ${ch}:${v}: missing verse`);
    return { text: verses.join(lines ? "\n" : " "), ref: `${book} ${ch}:${String(v).replace("-", "–")}`, source: "jps" };
  },
  async avot({ ch, m }) {
    const d = await json(URLS.avot());
    const parts = range(m).map((n) => tidy(d.text[ch - 1][n - 1] || "").replace(/^\d+\.\s*/, ""));
    if (parts.some((x) => !x)) throw new Error(`Avot ${ch}:${m}: missing`);
    return { text: parts.join("\n"), ref: `Pirkei Avot ${ch}:${String(m).replace("-", "–")}`, source: "avot" };
  },
  async web({ book, ch, v }) {
    const d = await json(URLS.web(book));
    const want = new Set(range(v));
    const out = [];
    for (const x of d) {
      if (x.chapterNumber !== ch || !want.has(x.verseNumber) || x.value == null) continue;
      if (x.type === "paragraph text" || x.type === "line text") out.push(x.value);
    }
    const text = out.join(" ").replace(/\s+/g, " ").trim();
    if (!text) throw new Error(`${book} ${ch}:${v}: missing`);
    const name = book.replace(/^(\d)/, "$1 ");
    return { text, ref: `${name} ${ch}:${String(v).replace("-", "–")}`, source: "web" };
  },
  async imitation({ book, chapter, start, end }) {
    const raw = (await get(URLS.imitation())).replace(/\r/g, "");
    const text = between(raw, start, end, `Imitation ${book}.${chapter}`).replace(/\(\d+\)/g, "").replace(/ {2,}/g, " ").replace(/ ([,.;:])/g, "$1");
    return { text, ref: `The Imitation of Christ ${book}.${chapter}`, source: "imitation" };
  },
  async quran({ s, v }) {
    const [en, ar] = await Promise.all([json(URLS.quran()), json(URLS.arabic())]);
    const pick = (d) => range(v).map((n) => d.quran.find((x) => x.chapter === s && x.verse === n)?.text);
    const e = pick(en), a = pick(ar);
    if (e.some((x) => !x) || a.some((x) => !x)) throw new Error(`Quran ${s}:${v}: missing`);
    return { text: e.map((x) => x.trim()).join("\n"), original: a.map((x) => x.trim()).join("\n"), ref: `Quran ${s}:${String(v).replace("-", "–")}`, source: "quran" };
  },
  async gita({ ch, notes, start, end }) {
    const d = await json(URLS.gita());
    const sec = d.sections.find((x) => x.section_number === ch + 24).content;
    let text;
    if (notes) {
      // segments end at Ganguli's footnote markers [n]; take those ending at the given notes
      const segs = sec.split(/\[(\d+)\]/);
      const got = [];
      for (let i = 0; i < segs.length - 1; i += 2) if (range(notes).includes(Number(segs[i + 1]))) got.push(segs[i]);
      text = got.join(" ");
    } else text = between(sec.replace(/\[\d+\]/g, ""), start, end, `Gita ${ch}`);
    text = text.replace(/\[\(Bhagavad Gita,? Chapter [IVXL]+\)\]/, "").replace(/\[\d+\]/g, "").replace(/\s+/g, " ").trim();
    if (!text) throw new Error(`Gita ${ch} ${notes}: missing`);
    return { text, ref: `Bhagavad Gita ${ch}${notes ? ` (notes ${String(notes).replace("-", "–")})` : ""}`, source: "gita" };
  },
  async upanishad({ name, part, parts }) {
    // verse by verse, so the translator's commentary between verses is left out
    const raw = (await get(URLS.upanishad())).replace(/\r/g, "");
    const text = parts.map(([start, end]) => between(raw, start, end, `${name} ${part}`)).join("\n");
    return { text, ref: `${name} Upanishad ${part}`, source: "upanishad" };
  },
  async sutta({ uid, from, to, verse, title }) {
    const d = await json(URLS.sutta(uid));
    const keys = Object.keys(d);
    const i = keys.indexOf(`${uid}:${from}`), j = keys.indexOf(`${uid}:${to}`);
    if (i < 0 || j < i) throw new Error(`${uid}:${from}-${to}: segments not found`);
    const segs = keys.slice(i, j + 1).map((k) => d[k].replace(/<j>/g, "").trim()).filter(Boolean);
    const name = uid.replace(/^([a-z]+)/, (c) => ({ sn: "SN ", an: "AN ", mn: "MN ", dn: "DN ", snp: "Snp " })[c] || c);
    return { text: segs.join(verse ? "\n" : " "), ref: `${title}, ${name}`, source: "sutta" };
  },
};

// ---------- build ----------

async function buildTradition(t) {
  const passages = {};
  const days = [];
  let n = 0;
  for (const sel of t.selections) {
    if (sel.ref_id) { days.push({ id: sel.ref_id, week: sel.week }); continue; } // a card from another volume
    const got = await EX[sel.kind](sel);
    const src = SOURCES[got.source];
    const id = `${t.id}.${++n}`;
    passages[id] = {
      work: sel.work || src.work, author: t.name, translator: src.translator,
      ref: sel.label || got.ref, text: got.text, sha256: sha256(got.text),
      themes: tagThemes(got.text), week: sel.week,
      ...(got.original ? { original: got.original, originalLang: "ar", originalSha256: sha256(got.original) } : {}),
      licence: src.licence, source: src.url,
    };
    days.push({ id, week: sel.week });
  }
  return { passages, days };
}

async function main() {
  const args = process.argv.slice(2);
  const fromAt = args.indexOf("--from");
  if (fromAt >= 0) { cacheDir = args[fromAt + 1]; await mkdir(cacheDir, { recursive: true }); }
  const showAt = args.indexOf("--show");
  const show = showAt >= 0 ? args[showAt + 1] : null;
  const index = [];
  for (const t of TRADITIONS) {
    if (show && t.id !== show) continue;
    const { passages, days } = await buildTradition(t);
    if (show) {
      for (const [id, p] of Object.entries(passages)) console.log(`\n${id} [w${p.week}] ${p.ref} (${p.text.length})\n${p.text}${p.original ? `\n${p.original}` : ""}`);
      continue;
    }
    const sources = [...new Set(Object.values(passages).map((p) => p.translator))]
      .map((tr) => Object.values(SOURCES).find((s) => s.translator === tr));
    const meta = { id: t.id, author: t.name, work: t.work, translator: sources.map((s) => s.translator).join("; "), year: t.year, why: t.why, tradition: true };
    await writeFile(path.join(OUT, "volumes", `${t.id}.json`), JSON.stringify({ ...meta, source: sources.map((s) => s.url).join("; "), passages }) + "\n");
    index.push({ ...meta, blurb: t.blurb, count: Object.keys(passages).length, days, sources: sources.map(({ work, translator, licence, url }) => ({ work, translator, licence, url })) });
    console.log(`${t.id}: ${Object.keys(passages).length} passages, ${days.length} days`);
  }
  if (show) return;
  await writeFile(path.join(OUT, "traditions.json"), JSON.stringify({ weeks: WEEKS, traditions: index, pending: TRADITIONS_PENDING }, null, 2) + "\n");
}

// In the plan but not built yet, and why.
export const TRADITIONS_PENDING = [
  { name: "Sikhism", reason: "No public-domain English translation is reachable from the build (Macauliffe 1909 isn't available here); the modern translations in open Gurbani databases are in copyright." },
];

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
