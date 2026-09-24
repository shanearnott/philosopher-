// Ingest pipeline: download George Long's translation of the Meditations from
// Standard Ebooks (CC0 source, public-domain text), split it into passages keyed
// by the standard book.section numbering, and write a locked library with a
// SHA-256 checksum per passage. The app refuses to show a quote whose checksum
// doesn't match.
//
// Standard Ebooks paragraphs don't carry section numbers, and a few paragraphs
// split or merge sections, so each book is aligned explicitly (ALIGN) and a
// set of well-known passages is checked against their opening words (ANCHORS).
//
// Usage: node scripts/ingest.mjs [--from <dir with book-N.xhtml>]

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SOURCE =
  "https://raw.githubusercontent.com/standardebooks/marcus-aurelius_meditations_george-long/master/src/epub/text";

// How Standard Ebooks paragraphs line up with the standard section numbers.
// Paragraphs are counted as top-level <p> ordinals within each book. By
// default each paragraph is the next section. Exceptions:
//   group:   paragraphs that together make one section
//   exclude: paragraphs that hold parts of two sections (they still consume a
//            section number but are left out of the library rather than
//            mislabelled), or place notes
//   fix:     paragraph ordinal -> section number, to resume after a gap
//   sections: expected number of sections in the book
export const ALIGN = {
  1: { exclude: [18], sections: 17, trailingNote: true },
  2: { exclude: [18], sections: 17, trailingNote: true },
  3: { sections: 16 },
  4: { group: [[3, 4], [22, 23], [51, 52]], sections: 51 },
  5: { group: [[31, 32], [34, 35]], sections: 37 },
  6: { exclude: [44], fix: { 45: 46 }, sections: 59 },
  7: { exclude: [36, 37, 45, 46], fix: { 38: 42, 47: 52 }, group: [[50, 51]], sections: 75 },
  8: { group: [[21, 22], [23, 24], [53, 54]], sections: 61 },
  9: { group: [[28, 29]], sections: 42 },
  10: { group: [[2, 3], [14, 15], [30, 31], [37, 38]], sections: 38 },
  11: { group: [[6, 11], [23, 33]], exclude: [44, 48], fix: { 45: 33, 49: 38 }, sections: 39 },
  12: { group: [[3, 4], [6, 7]], sections: 36 },
};

// Passages whose numbers are well established, checked on every ingest.
export const ANCHORS = {
  "1.1": "From my grandfather Verus", "1.16": "In my father I observed", "1.17": "To the gods I am indebted",
  "2.1": "Begin the morning", "2.11": "Since it is possible", "2.17": "Of human life the time is a point",
  "3.4": "Do not waste the remainder", "3.16": "Body, soul, intelligence",
  "4.3": "Men seek retreats for themselves", "4.17": "Do not act as if thou wert going to live ten thousand years",
  "4.24": "Occupy thyself with few things", "4.49": "Be like the promontory", "4.51": "Always run to the short way",
  "5.1": "In the morning when thou risest unwillingly", "5.20": "In one respect man is the nearest thing to me",
  "5.25": "Does another do me wrong?", "5.33": "Soon, very soon, thou wilt be ashes",
  "6.6": "The best way of avenging thyself", "6.21": "If any man is able to convince me", "6.30": "Take care that thou art not made into a Caesar",
  "6.54": "That which is not good for the swarm", "6.59": "What kind of people are those whom men wish to please",
  "7.22": "It is peculiar to man to love even those who do wrong", "7.59": "Look within. Within is the fountain of good",
  "7.69": "The perfection of moral character", "7.73": "When thou hast done a good act", "7.75": "The nature of the All moved to make the universe",
  "8.36": "Do not disturb thyself by thinking of the whole of thy life", "8.47": "If thou art pained by any external thing",
  "8.48": "Remember that the ruling faculty is invincible", "8.50": "A cucumber is bitter", "8.59": "Men exist for the sake of one another",
  "9.29": "The universal cause is like a winter torrent", "9.42": "When thou art offended with any man’s shameless conduct",
  "10.15": "Short is the little which remains", "10.16": "No longer talk at all about the kind of man", "10.30": "When thou art offended at any man’s fault",
  "10.38": "Remember that this which pulls the strings",
  "11.8": "A branch cut off from the adjacent branch", "11.13": "Suppose any man shall despise me", "11.18": "If any have offended against thee",
  "11.33": "To look for the fig in winter", "11.39": "Socrates used to say",
  "12.17": "If it is not right, do not do it", "12.19": "Perceive at last", "12.36": "Man, thou hast been a citizen",
};

// Returns [{ section, first, last }] for one book.
export function alignBook(book, paragraphCount) {
  const spec = ALIGN[book] || {};
  const groups = spec.group || [];
  const exclude = new Set(spec.exclude || []);
  const out = [];
  let n = 0;
  for (let p = 1; p <= paragraphCount; p++) {
    if (spec.trailingNote && p === paragraphCount) break;
    if (spec.fix?.[p]) n = spec.fix[p] - 1;
    const g = groups.find(([a]) => a === p);
    const last = g ? g[1] : p;
    n++;
    if (!exclude.has(p)) out.push({ section: n, first: p, last });
    p = last;
  }
  if (spec.sections && n !== spec.sections) throw new Error(`Book ${book}: aligned ${n} sections, expected ${spec.sections}`);
  return out;
}

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
  for (let n = 1; n <= 12; n++) {
    const paragraphs = books[n].filter((b) => b.kind === "p").length;
    for (const { section, first, last } of alignBook(n, paragraphs)) {
      const ref = `${n}.${section}`;
      const text = extract(books[n], first, last);
      passages[`meditations.${ref}`] = {
        work: "Meditations",
        author: "Marcus Aurelius",
        translator: "George Long (1862)",
        ref,
        text,
        sha256: sha256(text),
      };
    }
  }
  for (const [ref, opening] of Object.entries(ANCHORS)) {
    const p = passages[`meditations.${ref}`];
    if (!p?.text.startsWith(opening)) {
      throw new Error(`meditations.${ref}: expected "${opening}…", got "${p?.text.slice(0, 60)}…"`);
    }
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
