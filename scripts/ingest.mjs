// Ingest pipeline: download George Long's translation of the Meditations from
// Standard Ebooks (CC0 source, public-domain text), split it into passages keyed
// by the standard book.section numbering, and write a locked library with a
// SHA-256 checksum per passage. The app refuses to show a quote whose checksum
// doesn't match.
//
// Standard Ebooks paragraphs don't carry section numbers, and a few paragraphs
// split or merge sections, so every passage is mapped explicitly to its
// paragraph ordinal and checked against its opening words. Only mapped
// passages enter the library.
//
// Usage: node scripts/ingest.mjs [--from <dir with book-N.xhtml>]

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE =
  "https://raw.githubusercontent.com/standardebooks/marcus-aurelius_meditations_george-long/master/src/epub/text";

// ref -> [book, first paragraph ordinal, last paragraph ordinal, opening words]
// Paragraph ordinals count top-level <p> elements in each book's chapter.
export const PASSAGES = {
  // Book 1: one paragraph per section
  "1.1": [1, 1, 1, "From my grandfather Verus"],
  "1.5": [1, 5, 5, "From my governor"],
  "1.6": [1, 6, 6, "From Diognetus"],
  "1.7": [1, 7, 7, "From Rusticus"],
  "1.8": [1, 8, 8, "From Apollonius"],
  "1.9": [1, 9, 9, "From Sextus"],
  "1.13": [1, 13, 13, "From Catulus"],
  "1.15": [1, 15, 15, "From Maximus"],
  "1.16": [1, 16, 16, "In my father I observed"],
  "1.17": [1, 17, 17, "To the gods I am indebted"],
  // Book 2: one paragraph per section (final paragraph is the place note)
  "2.1": [2, 1, 1, "Begin the morning"],
  "2.4": [2, 4, 4, "Remember how long thou hast been putting off"],
  "2.5": [2, 5, 5, "Every moment think steadily"],
  "2.7": [2, 7, 7, "Do the things external"],
  "2.11": [2, 11, 11, "Since it is possible"],
  "2.15": [2, 15, 15, "Remember that all is opinion"],
  // Book 3: one paragraph per section
  "3.4": [3, 4, 4, "Do not waste the remainder"],
  "3.10": [3, 10, 10, "Throwing away then all things"],
  "3.12": [3, 12, 12, "If thou workest at that which is before thee"],
  // Book 4: 4.3 spans paragraphs 3-4, 4.21 spans 22-23, 4.49 spans 51-52
  "4.2": [4, 2, 2, "Let no act be done without a purpose"],
  "4.3": [4, 3, 4, "Men seek retreats for themselves"],
  "4.7": [4, 8, 8, "Take away thy opinion"],
  "4.17": [4, 18, 18, "Do not act as if thou wert going to live ten thousand years"],
  "4.18": [4, 19, 19, "How much trouble he avoids"],
  "4.24": [4, 26, 26, "Occupy thyself with few things"],
  "4.48": [4, 50, 50, "Think continually how many physicians are dead"],
  "4.49": [4, 51, 52, "Be like the promontory"],
  // Book 5: sections 1-30 are one paragraph each
  "5.1": [5, 1, 1, "In the morning when thou risest unwillingly"],
  "5.2": [5, 2, 2, "How easy it is to repel"],
  "5.6": [5, 6, 6, "One man, when he has done a service"],
  "5.16": [5, 16, 16, "Such as are thy habitual thoughts"],
  "5.19": [5, 19, 19, "Things themselves touch not the soul"],
  "5.20": [5, 20, 20, "In one respect man is the nearest thing to me"],
  "5.25": [5, 25, 25, "Does another do me wrong?"],
  // Book 8: two merged sections precede 8.34
  "8.47": [8, 49, 49, "If thou art pained by any external thing"],
  "8.48": [8, 50, 50, "Remember that the ruling faculty is invincible"],
  "8.49": [8, 51, 51, "Say nothing more to thyself than what the first appearances report"],
  "8.50": [8, 52, 52, "A cucumber is bitter"],
  // Book 12: 12.3 spans 3-4 (verse between), 12.5 spans 6-7
  "12.17": [12, 19, 19, "If it is not right, do not do it"],
  "12.19": [12, 21, 21, "Perceive at last that thou hast in thee"],
  "12.22": [12, 24, 24, "Consider that everything is opinion"],
  "12.25": [12, 27, 27, "Cast away opinion"],
};

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function clean(html) {
  return html
    .replace(/<a[^>]*noteref[^>]*>[\s\S]*?<\/a>/g, "")
    .replace(/<cite[^>]*>([\s\S]*?)<\/cite>/g, "\n— $1")
    .replace(/<\/p>\s*<p[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) =>
      e[0] === "#"
        ? String.fromCodePoint(parseInt(e.slice(e[1] === "x" ? 2 : 1), e[1] === "x" ? 16 : 10))
        : ENTITIES[e] ?? m,
    )
    .replace(/⁠/g, "")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

// Returns top-level blocks: { kind: "p" | "blockquote", text }
export function splitBook(xhtml) {
  const body = xhtml.slice(xhtml.indexOf("</h2>"));
  const blocks = [];
  for (const m of body.matchAll(/<blockquote[\s\S]*?<\/blockquote>|<p[\s>][\s\S]*?<\/p>/g)) {
    blocks.push({ kind: m[0].startsWith("<blockquote") ? "blockquote" : "p", text: clean(m[0]) });
  }
  return blocks;
}

export function extract(blocks, first, last) {
  const out = [];
  let ordinal = 0;
  for (const b of blocks) {
    if (b.kind === "p") ordinal++;
    if (ordinal >= first && ordinal <= last) out.push(b.text);
    // a verse quotation belongs to the paragraph that introduces it
  }
  return out.join("\n");
}

export const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");

async function loadBook(n, from) {
  if (from) return readFile(path.join(from, `book-${n}.xhtml`), "utf8");
  const res = await fetch(`${SOURCE}/book-${n}.xhtml`);
  if (!res.ok) throw new Error(`book ${n}: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  const fromIdx = process.argv.indexOf("--from");
  const from = fromIdx > -1 ? process.argv[fromIdx + 1] : null;
  const books = {};
  for (let n = 1; n <= 12; n++) books[n] = splitBook(await loadBook(n, from));

  const passages = {};
  for (const [ref, [book, first, last, opening]] of Object.entries(PASSAGES)) {
    const text = extract(books[book], first, last);
    if (!text.startsWith(opening)) {
      throw new Error(`meditations.${ref}: expected "${opening}…", got "${text.slice(0, 60)}…"`);
    }
    passages[`meditations.${ref}`] = {
      work: "Meditations",
      author: "Marcus Aurelius",
      translator: "George Long (1862)",
      ref,
      text,
      sha256: sha256(text),
    };
  }

  const library = {
    source: "Standard Ebooks edition of George Long's translation (public domain text; CC0 edition)",
    sourceUrl: "https://standardebooks.org/ebooks/marcus-aurelius/meditations/george-long",
    passages,
  };
  const out = path.join(here, "..", "public", "data", "library.json");
  await writeFile(out, JSON.stringify(library, null, 2) + "\n");
  console.log(`Wrote ${Object.keys(passages).length} passages to ${path.relative(process.cwd(), out)}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
