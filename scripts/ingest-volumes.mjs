// Ingest for the wider library (Mix and Play). Downloads Standard Ebooks
// editions of public-domain translations, splits them into card-sized
// passages, tags each with themes, and writes one JSON file per volume with a
// SHA-256 checksum per passage, plus an index.
//
// Passages keep the edition's own structure for references: numbered works
// (Enchiridion, Analects, Tao Te Ching, Art of War) use their standard
// numbers; prose works use chapter and paragraph (¶) within this edition.
//
// Usage: node scripts/ingest-volumes.mjs [--from <dir of downloaded repos>]

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { clean, sha256 } from "./ingest.mjs";
import { tagThemes } from "../public/js/themes.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(here, "..", "public", "data", "volumes");
const RAW = (repo) => `https://raw.githubusercontent.com/standardebooks/${repo}/master/src/epub/`;

const num = (id) => id.match(/\d+/g) || [];
const title = (s) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Each volume: which files, how to label a section, and plan metadata.
export const VOLUMES = [
  {
    id: "enchiridion", repo: "epictetus_short-works_george-long", files: /the-enchiridion/,
    author: "Epictetus", work: "Enchiridion", translator: "George Long (1877)", year: "c. 125",
    why: "Marcus's main influence; blunt and practical", course: 2,
    ref: (id) => `Enchiridion ${num(id).at(-1)}`,
  },
  {
    id: "discourses", repo: "epictetus_discourses_george-long", files: /book-\d/,
    author: "Epictetus", work: "Discourses", translator: "George Long (1877)", year: "c. 108",
    why: "Marcus's main influence; blunt and practical", course: 2,
    ref: (id) => `Discourses ${num(id).join(".")}`,
  },
  {
    id: "seneca", repo: "seneca_dialogues_aubrey-stewart",
    files: /on-the-shortness-of-life|on-peace-of-mind|on-a-happy-life|on-providence|on-the-firmness|on-leisure/,
    author: "Seneca", work: "Dialogues", translator: "Aubrey Stewart (1900)", year: "c. 49",
    why: "Time, wealth, busyness; letters to a senior official", course: 3,
    ref: (id) => `${title(id.replace(/-chapter-\d+$/, ""))} ${num(id).at(-1) ?? ""}`.trim(),
  },
  {
    id: "boethius", repo: "boethius_the-consolation-of-philosophy_h-r-james", files: /chapter-\d/,
    author: "Boethius", work: "The Consolation of Philosophy", translator: "H. R. James (1897)", year: "524",
    why: "Fortune, reputation and loss after falling from power", course: 5,
    ref: (id) => `Consolation ${num(id).join(".")}${/song/.test(id) ? " (song)" : ""}`,
  },
  {
    id: "taoteching", repo: "laozi_tao-te-ching_james-legge", files: /008-tao-te-ching/,
    author: "Laozi", work: "Tao Te Ching", translator: "James Legge (1891)", year: "c. 400 BC",
    why: "Similar ideas on control and attachment from another tradition", course: 8,
    ref: (id) => `Tao Te Ching ${num(id).at(-1)}`,
  },
  {
    id: "moralsentiments", repo: "adam-smith_the-theory-of-moral-sentiments", files: /chapter-\d|section-\d/,
    author: "Adam Smith", work: "The Theory of Moral Sentiments", translator: "Original English (1759)", year: "1759",
    why: "Love of praise versus being praiseworthy", volume: 9,
    ref: (id) => `Moral Sentiments ${num(id).join(".")}`,
  },
  {
    id: "franklin", repo: "benjamin-franklin_the-autobiography-of-benjamin-franklin", files: /chapter-\d/,
    author: "Benjamin Franklin", work: "Autobiography", translator: "Original English", year: "1791",
    why: "The 13-virtue tracking chart, the model for the scoreboard", volume: 12,
    ref: (id) => `Autobiography ch. ${num(id).at(-1)}`,
  },
  {
    id: "artofwar", repo: "sun-tzu_the-art-of-war_lionel-giles", files: /011-chapter|01\d-chapter|02[0-3]-chapter/,
    author: "Sun Tzu", work: "The Art of War", translator: "Lionel Giles (1910)", year: "c. 500 BC",
    why: "Short, strategic, defence-relevant", volume: 15, verses: true,
    ref: (id) => `Art of War ${num(id).at(-1)}`,
  },
  {
    id: "prince", repo: "niccolo-machiavelli_the-prince_w-k-marriott", files: /chapter-\d/,
    author: "Niccolò Machiavelli", work: "The Prince", translator: "W. K. Marriott (1908)", year: "1532",
    why: "The realist counterweight", volume: 16, flagged: "Translator's death date unknown; may be in copyright outside the US",
    ref: (id) => `The Prince ch. ${num(id).at(-1)}`,
  },
  {
    id: "analects", repo: "confucius_analects_james-legge", files: /chapter-\d/,
    author: "Confucius", work: "Analects", translator: "James Legge (1861)", year: "c. 475 BC",
    why: "Duty, leadership, relationships", volume: 17,
    ref: (id) => `Analects ${num(id).join(".")}`,
  },
  {
    id: "ethics", repo: "aristotle_nicomachean-ethics_f-h-peters", files: /book-\d/,
    author: "Aristotle", work: "Nicomachean Ethics", translator: "F. H. Peters (1881)", year: "c. 340 BC",
    why: "Practical wisdom and habit; source of the Stoic virtues", volume: 18,
    ref: (id) => { const n = num(id); return `Ethics ${n[0]}.${n.at(-1)}`; },
  },
  {
    id: "walden", repo: "henry-david-thoreau_walden", files: /^0(0[2-9]|1\d)-/,
    author: "Henry David Thoreau", work: "Walden", translator: "Original English (1854)", year: "1854",
    why: "Deliberate, simple living", volume: 21,
    ref: (id) => `Walden, ${title(id).replace(/ And /g, " and ").replace(/ Of /g, " of ").replace(/ The /g, " the ")}`,
  },
  {
    id: "emerson", repo: "ralph-waldo-emerson_essays",
    files: /self-reliance|compensation|friendship|heroism|prudence|character|experience|spiritual-laws|circles/,
    author: "Ralph Waldo Emerson", work: "Essays", translator: "Original English (1841–44)", year: "1841",
    why: "Independence of judgement", volume: 22,
    ref: (id) => title(id),
  },
  {
    id: "thucydides", repo: "thucydides_history-of-the-peloponnesian-war_richard-crawley", files: /-chapter-(6|7|9|17)\.xhtml$/,
    author: "Thucydides", work: "History of the Peloponnesian War", translator: "Richard Crawley (1874)", year: "c. 400 BC",
    why: "Strategy, power and war decisions; the Melian Dialogue", volume: 11,
    ref: (id) => `History ch. ${num(id).at(-1)}`,
  },
];

// Plan volumes whose clean editions aren't in the library yet.
export const COMING = [
  "Seneca, Letters (Gummere)", "Cicero, On Duties", "Montaigne, Essays", "Francis Bacon, Essays",
  "The Dhammapada", "Bhagavad Gita", "Pascal, Pensées", "Plutarch, Lives", "La Rochefoucauld, Maxims",
  "Epicurus, Letters and Principal Doctrines", "Schopenhauer, The Wisdom of Life",
];

const MIN = 120, TARGET = 450, MAX = 1300, SINGLE_MAX = 2800;

// Collects <p> blocks with the id of their innermost section/article.
export function blocks(xhtml) {
  const out = [];
  const stack = [];
  const re = /<(\/?)([a-zA-Z0-9:]+)([^>]*?)(\/?)>/g;
  let m, pStart = -1, pCtx = null;
  while ((m = re.exec(xhtml))) {
    const [tag, close, name, attrs, self] = m;
    if (self) continue;
    if (!close) {
      const id = attrs.match(/\sid="([^"]+)"/)?.[1];
      const type = attrs.match(/epub:type="([^"]+)"/)?.[1] || "";
      if (name === "p") {
        const skip = stack.some((s) => ["hgroup", "header", "table", "figure", "aside", "footer"].includes(s.name))
          || /title|subtitle|z3998:signature|z3998:salutation/.test(type);
        pStart = m.index + tag.length;
        pCtx = skip ? null : {
          section: [...stack].reverse().find((s) => s.id && (s.name === "section" || s.name === "article"))?.id,
          verse: stack.some((s) => /poem|verse|song/.test(s.type)),
        };
      } else {
        stack.push({ name, id, type });
      }
    } else if (name === "p") {
      if (pCtx?.section) {
        const text = clean(xhtml.slice(pStart, m.index).replace(/<br\s*\/?>/g, "\n"));
        if (text) out.push({ ...pCtx, text });
      }
      pCtx = null;
    } else {
      const i = stack.map((s) => s.name).lastIndexOf(name);
      if (i >= 0) stack.splice(i);
    }
  }
  return out;
}

// Groups blocks into card-sized passages, never splitting a paragraph.
export function cards(vol, allBlocks) {
  const bySection = new Map();
  for (const b of allBlocks) {
    const key = b.section.replace(/-(body|song)$/, "") + (/-song$/.test(b.section) ? "-song" : "");
    if (!bySection.has(key)) bySection.set(key, []);
    bySection.get(key).push(b);
  }
  const out = [];
  for (const [section, list] of bySection) {
    const label = vol.ref(section);
    const whole = list.map((b) => b.text).join("\n");
    if (whole.length <= MAX && whole.length >= 40) {
      out.push({ ref: label, text: whole });
      continue;
    }
    let run = [], first = 1;
    const flush = (i) => {
      const text = run.map((b) => b.text).join("\n");
      if (text.length >= MIN && text.length <= SINGLE_MAX) {
        const range = first === i ? `${first}` : `${first}–${i}`;
        out.push({ ref: `${label}${vol.verses ? "." : ", ¶"}${range}`, text });
      }
      run = [];
    };
    list.forEach((b, idx) => {
      const i = idx + 1;
      const len = run.reduce((n, r) => n + r.text.length, 0);
      if (run.length && (len >= TARGET || len + b.text.length > MAX)) flush(i - 1);
      if (!run.length) first = i;
      run.push(b);
    });
    if (run.length) flush(list.length);
  }
  return out;
}

async function loadRepo(vol, from) {
  if (from) {
    const dir = path.join(from, vol.repo);
    const files = (await readdir(dir)).sort().filter((f) => vol.files.test(f));
    return Promise.all(files.map((f) => readFile(path.join(dir, f), "utf8")));
  }
  const opf = await (await fetch(RAW(vol.repo) + "content.opf")).text();
  const items = Object.fromEntries([...opf.matchAll(/<item\s[^>]*>/g)].map(([t]) => [t.match(/id="([^"]+)"/)[1], t.match(/href="([^"]+)"/)[1]]));
  const spine = [...opf.matchAll(/<itemref[^>]*idref="([^"]+)"/g)].map((m) => items[m[1]]).filter((h) => h?.startsWith("text/"));
  const texts = [];
  for (const [i, href] of spine.entries()) {
    if (!vol.files.test(`${String(i).padStart(3, "0")}-${href.split("/").pop()}`)) continue;
    const res = await fetch(RAW(vol.repo) + href);
    if (!res.ok) throw new Error(`${vol.repo}/${href}: HTTP ${res.status}`);
    texts.push(await res.text());
  }
  return texts;
}

async function main() {
  const fromIdx = process.argv.indexOf("--from");
  const from = fromIdx > -1 ? process.argv[fromIdx + 1] : null;
  await mkdir(OUT, { recursive: true });
  const index = [];
  for (const vol of VOLUMES) {
    const files = await loadRepo(vol, from);
    const list = cards(vol, files.flatMap(blocks));
    const passages = {};
    list.forEach((c, i) => {
      passages[`${vol.id}.${i + 1}`] = {
        work: vol.work, author: vol.author, translator: vol.translator, ref: c.ref,
        text: c.text, sha256: sha256(c.text), themes: tagThemes(c.text),
      };
    });
    const { ref, files: _f, repo, ...meta } = vol;
    await writeFile(path.join(OUT, `${vol.id}.json`), JSON.stringify({ ...meta, source: `https://standardebooks.org`, repo, passages }) + "\n");
    index.push({ ...meta, count: list.length });
    console.log(`${vol.id}: ${list.length} passages`);
  }
  await writeFile(path.join(OUT, "index.json"), JSON.stringify({ volumes: index, coming: COMING }, null, 2) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
