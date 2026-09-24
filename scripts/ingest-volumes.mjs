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

// Plan volumes whose clean editions aren't reachable for ingest yet.
export const COMING = ["Seneca, Letters (Gummere)", "Bhagavad Gita (Arnold or Telang)"];

// ---------- Project Gutenberg editions, via the GITenberg mirror ----------

const GIT = (repo, file) => `https://raw.githubusercontent.com/GITenberg/${repo}/master/${file}`;

const NAMED = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", laquo: "«", raquo: "»", middot: "·", sect: "§", para: "¶",
  pound: "£", deg: "°", times: "×", frac12: "½", frac14: "¼", frac34: "¾", dagger: "†", Dagger: "‡",
  aelig: "æ", AElig: "Æ", oelig: "œ", OElig: "Œ", szlig: "ß", ccedil: "ç", Ccedil: "Ç", ntilde: "ñ",
};
for (const [base, marks] of Object.entries({ a: "àáâãäå", e: "èéêë", i: "ìíîï", o: "òóôõö", u: "ùúûü", y: "ýÿ" })) {
  ["grave", "acute", "circ", "tilde", "uml", "ring"].forEach((m, k) => {
    const lower = { a: [0, 1, 2, 3, 4, 5], e: [0, 1, 2, null, 3], i: [0, 1, 2, null, 3], o: [0, 1, 2, 3, 4], u: [0, 1, 2, null, 3], y: [null, 0, null, null, 1] }[base][k];
    if (lower != null && marks[lower]) {
      NAMED[base + m] = marks[lower];
      NAMED[base.toUpperCase() + m] = marks[lower].toUpperCase();
    }
  });
}

export function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(e[1] === "x" || e[1] === "X" ? 2 : 1), e[1] === "x" || e[1] === "X" ? 16 : 10)) : NAMED[e] ?? m);
}

// Source line breaks inside a paragraph are just wrapping; only <br> is a real break.
const tidy = (html) =>
  decode(html.replace(/\s+/g, " ").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, ""))
    .replace(/\[(\d+|[A-Z])\]/g, "") // footnote markers
    .replace(/\[Pg \d+\]/g, "") // page numbers
    .replace(/_([^_]+)_/g, "$1") // plain-text italics
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");

// Headings and paragraphs, in order, from a Gutenberg HTML file.
export function gutenbergHtml(html) {
  const start = html.indexOf("*** START");
  const body = start > -1 && start < html.length / 2 ? html.slice(start) : html;
  const endAt = body.search(/\*\*\* ?END OF|End of the Project Gutenberg|End of Project Gutenberg/i);
  const main = endAt > -1 ? body.slice(0, endAt) : body;
  return [...main.matchAll(/<(h[1-4]|p)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((m) => ({ tag: m[1].toLowerCase(), text: tidy(m[2]) }));
}

// Paragraphs and headings from a Gutenberg plain-text file.
export function gutenbergText(txt) {
  const t = txt.replace(/\r/g, "");
  const a = t.indexOf("\n", t.indexOf("*** START")) + 1;
  const b = t.indexOf("*** END");
  return t.slice(a, b > -1 ? b : undefined).split(/\n\s*\n/)
    .map((p) => p.replace(/\[Footnote[\s\S]*?\]/g, "").replace(/_([^_]+)_/g, "$1").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

const EN = /\b(the|and|of|to|is|that|which|in|it|a|he|we|his|not|be|with|as|for|by)\b/gi;
export const isEnglish = (s) => (s.match(EN) || []).length / Math.max(1, s.split(/\s+/).length) >= 0.12;

// Groups numbered items (verses, sections) into cards of consecutive numbers.
function groupNumbered(items, label, target = 450, max = 1300) {
  const out = [];
  let run = [];
  const flush = () => {
    if (!run.length) return;
    const a = run[0].n, b = run.at(-1).n;
    out.push({ ref: label(a === b ? `${a}` : `${a}–${b}`), text: run.map((r) => r.text).join("\n") });
    run = [];
  };
  for (const it of items) {
    const len = run.reduce((n, r) => n + r.text.length, 0);
    if (run.length && (len >= target || len + it.text.length > max || it.group !== run[0].group)) flush();
    run.push(it);
  }
  flush();
  return out;
}

const roman = (r) => [...r.toUpperCase()].reduce((acc, c, i, arr) => {
  const v = { I: 1, V: 5, X: 10, L: 50, C: 100 }[c], next = { I: 1, V: 5, X: 10, L: 50, C: 100 }[arr[i + 1]] || 0;
  return acc + (v < next ? -v : v);
}, 0);

// Sections as {key, text} blocks for cards(), from headed paragraphs.
const asBlocks = (list) => list.map(({ key, text }) => ({ section: key, text }));

export const GUTENBERG = [
  {
    id: "onduties", repo: "De-Officiis_47001", file: "47001-h/47001-h.htm",
    author: "Cicero", work: "On Duties", translator: "Walter Miller (1913)", year: "44 BC",
    why: "Ethics of public service and leadership", course: 4,
    parse(items) {
      let book = 0, section = null;
      const out = [];
      for (const it of items) {
        if (it.tag === "h2") { const m = it.text.match(/^BOOK (I{1,3})\b/); book = m ? roman(m[1]) : 0; section = null; continue; }
        if (!book || it.tag !== "p" || !isEnglish(it.text)) continue;
        const m = it.text.match(/^(\d+)\s+(?:[IVXL]+\.\s+)?/);
        if (m) section = +m[1];
        if (section == null) continue;
        out.push({ key: `${book}.${section}`, text: it.text.replace(/^(\d+)\s+(?:[IVXL]+\.\s+)?/, "") });
      }
      return cards({ ref: (k) => `On Duties ${k}` }, asBlocks(out));
    },
  },
  {
    id: "plutarch", repo: "Plutarch-s-Lives-Volume-I_14033", file: "14033-h/14033-h.htm",
    author: "Plutarch", work: "Lives (vol. I)", translator: "Aubrey Stewart and George Long (1880)", year: "c. 100",
    why: "Leaders' character under pressure, as paired case studies", volume: 14,
    parse(items) {
      let life = null, ch = null;
      const out = [];
      for (const it of items) {
        if (it.tag !== "p" && /FOOTNOTES/.test(it.text)) { life = null; continue; } // translators' notes
        if (it.tag === "h2") {
          const m = !/PLUTARCH/.test(it.text) && it.text.match(/^(LIFE OF|COMPARISON OF)\s+(.+?)\.?$/);
          life = m ? (m[1] === "LIFE OF" ? "Life of " : "Comparison of ") + m[2].toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ And /g, " and ") : null;
          ch = null;
          continue;
        }
        if (!life || it.tag !== "p") continue;
        const m = it.text.match(/^([IVXL]+)\.\s+/);
        if (m) ch = roman(m[1]);
        out.push({ key: `${life}${ch ? ` ${ch}` : ""}`, text: it.text.replace(/^[IVXL]+\.\s+/, "") });
      }
      return cards({ ref: (k) => `Plutarch, ${k}` }, asBlocks(out));
    },
  },
  {
    id: "bacon", repo: "The-Essays-or-Counsels-Civil-and-Moral_575", file: "575-h/575-h.htm",
    author: "Francis Bacon", work: "Essays", translator: "Original English (1625)", year: "1625",
    why: "Short, sharp essays on ambition, counsel and power", course: 7,
    parse(items) {
      let essay = null;
      const out = [];
      for (const it of items) {
        if (it.tag === "h2") { essay = /^Of /.test(it.text) ? it.text.replace(/\b(And|Of|The|In|To)\b/g, (w, _m, i) => (i ? w.toLowerCase() : w)) : null; continue; }
        if (essay && it.tag === "p" && isEnglish(it.text)) out.push({ key: essay, text: it.text });
      }
      return cards({ ref: (k) => `Bacon, ${k}` }, asBlocks(out));
    },
  },
  {
    id: "pascal", repo: "Pascal-s-Pens-es_18269", file: "18269-h/18269-h.htm",
    author: "Blaise Pascal", work: "Pensées", translator: "W. F. Trotter (1910)", year: "1670",
    why: "Distraction and the inability to sit quietly alone", volume: 13,
    flagged: "Translator's death date unknown; may be in copyright outside the US",
    parse(items) {
      let inText = false, n = null;
      const out = [];
      for (const it of items) {
        if (it.tag === "h2") { inText = /^SECTION [IVXL]+/.test(it.text); n = null; continue; }
        if (it.tag === "h4" && inText && /^\d+$/.test(it.text)) { n = +it.text; continue; }
        if (inText && n && it.tag === "p") out.push({ key: `${n}`, text: it.text });
      }
      return cards({ ref: (k) => `Pascal, Pensées ${k}` }, asBlocks(out));
    },
  },
  {
    id: "dhammapada", repo: "Dhammapada-a-Collection-of-Verses--Being-One-of-the-Canonical-Books-of-the-Buddhists_2017", file: "2017-h/2017-h.htm",
    author: "The Buddha (attributed)", work: "Dhammapada", translator: "F. Max Müller (1881)", year: "c. 300 BC",
    why: "Similar ideas on control and attachment from another tradition", course: 8,
    parse(items) {
      let chapter = null;
      const verses = [];
      for (const it of items) {
        if (it.tag === "h2") { chapter = /^Chapter/.test(it.text) ? it.text : null; continue; }
        const m = chapter && it.tag === "p" && it.text.match(/^(\d+)\.\s+([\s\S]+)/);
        if (m) verses.push({ n: +m[1], text: `${m[1]}. ${m[2]}`, group: chapter });
      }
      return groupNumbered(verses, (r) => `Dhammapada ${r}`, 380, 900);
    },
  },
  {
    id: "rochefoucauld", repo: "Reflections--or-Sentences-and-Moral-Maxims_9105", file: "9105-h/9105-h.htm",
    author: "François de La Rochefoucauld", work: "Maxims", translator: "J. W. Willis Bund and J. Hain Friswell (1871)", year: "1678",
    why: "One-line truths on vanity; ideal swipe cards", volume: 19,
    parse(items) {
      const out = [];
      for (const it of items) {
        const m = it.tag === "p" && it.text.match(/^(\d+)\.\s*—?\s*([\s\S]+)/);
        // {x} marks a transcriber's letter correction: keep the letter, drop the braces
        if (m && +m[1] <= 504) out.push({ ref: `La Rochefoucauld, Maxim ${m[1]}`, text: m[2].replace(/\{([^}]*)\}/g, "$1").replace(/\s*\[[^\]]*\]/g, "").trim() }); // [..] = editor's comment
      }
      return out;
    },
  },
  {
    id: "montaigne", repo: "Essays-of-Michel-de-Montaigne---Complete_3600", file: "3600-h/3600-h.htm",
    author: "Michel de Montaigne", work: "Essays", translator: "Charles Cotton (1685), ed. W. C. Hazlitt (1877)", year: "1580",
    why: "Stoicism applied to retirement from public life", course: 6,
    parse(items) {
      let book = 0, last = 99, key = null;
      const out = [];
      for (const it of items) {
        // chapter headings are h2, except the Apology for Raimond Sebond (2.12), which is h1
        if (it.tag === "h2" || (it.tag === "h1" && /^CHAPTER/.test(it.text))) {
          const m = it.text.match(/^CHAPTER\s+([IVXL]+)\.?\s*[—–-]*\s*(.+?)\.?$/);
          if (!m) { key = null; continue; }
          const n = roman(m[1]);
          if (n <= last) book++;
          last = n;
          const title = m[2].toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
          key = `${book}.${n} ${title}`;
          continue;
        }
        // [bracketed] passages are the editors' notes (Hazlitt, and D.W. for Gutenberg), not Montaigne
        const text = it.text.replace(/\s*—?\[[^\]]*\]—?/g, "").replace(/ {2,}/g, " ").trim();
        if (key && it.tag === "p" && isEnglish(text) && text.length >= 80) out.push({ key, text });
      }
      return cards({ ref: (k) => `Montaigne, Essays ${k.replace(" ", ", ")}` }, asBlocks(out));
    },
  },
  {
    id: "schopenhauer", text: [["The-Essays-of-Arthur-Schopenhauer--The-Wisdom-of-Life_10741", "10741.txt", "Wisdom of Life"], ["The-Essays-of-Arthur-Schopenhauer--Counsels-and-Maxims_10715", "10715.txt", "Counsels and Maxims"]],
    author: "Arthur Schopenhauer", work: "The Wisdom of Life; Counsels and Maxims", translator: "T. Bailey Saunders (1890)", year: "1851",
    why: "Reputation and what a man represents", volume: 23,
    parse(files) {
      const out = [];
      for (const [paras, title] of files) {
        let ch = null;
        for (let i = 0; i < paras.length; i++) {
          const p = paras[i];
          const m = p.match(/^CHAPTER ([IVXL]+)[.,]?$/);
          if (m) { ch = roman(m[1]); i++; continue; }
          if (/^INTRODUCTION\.?$/.test(p) && !ch) { ch = "Introduction"; continue; }
          if (!ch || /^[^a-z]*$/.test(p) || p.length < 80) continue;
          out.push({ key: `Schopenhauer, ${title}${ch === "Introduction" ? ", introduction" : ` ch. ${ch}`}`, text: p });
        }
      }
      return cards({ ref: (k) => k }, asBlocks(out));
    },
  },
];

// Epicurus: his own words from Diogenes Laertius, Book X (Standard Ebooks,
// Yonge): the Letter to Menoeceus and the Principal Doctrines.
export const EPICURUS = {
  id: "epicurus", repo: "diogenes-laertius_the-lives-and-opinions-of-eminent-philosophers_c-d-yonge", files: /book-10/,
  author: "Epicurus", work: "Letter to Menoeceus; Principal Doctrines", translator: "C. D. Yonge (1853)", year: "c. 300 BC",
  why: "Simple pleasures, friendship, the garden", volume: 20,
  parse(list) {
    const at = (re) => { const i = list.findIndex((b) => re.test(b.text)); if (i < 0) throw new Error(`epicurus: missing ${re}`); return i; };
    const letter = list.slice(at(/^Let no one delay to study philosophy/), at(/^Do you then study these precepts/) + 1);
    const doctrines = list.slice(at(/^“That which is happy and imperishable/), at(/^“The happiest men/) + 1)
      .filter((b) => /^“/.test(b.text)); // Diogenes' own asides are bracketed or unquoted
    return [
      ...letter.map((b, i) => ({ ref: `Epicurus, Letter to Menoeceus, ¶${i + 1}`, text: b.text })),
      ...doctrines.map((b, i) => ({ ref: `Epicurus, Principal Doctrines, ¶${i + 1}`, text: b.text.replace(/^“|”$/g, "") })),
    ];
  },
};

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
  const write = async (vol, list, source) => {
    const passages = {};
    list.forEach((c, i) => {
      passages[`${vol.id}.${i + 1}`] = {
        work: vol.work, author: vol.author, translator: vol.translator, ref: c.ref,
        text: c.text, sha256: sha256(c.text), themes: tagThemes(c.text),
      };
    });
    const { parse, repo, file, text, files: _f, ...meta } = vol;
    await writeFile(path.join(OUT, `${vol.id}.json`), JSON.stringify({ ...meta, source, passages }) + "\n");
    index.push({ ...meta, count: list.length });
    console.log(`${vol.id}: ${list.length} passages`);
  };
  for (const vol of GUTENBERG) {
    const get = async (repo, file) => {
      // local copies are saved as <gutenberg id>.<ext>; all these editions are UTF-8 or ASCII
      if (from) return readFile(path.join(from, "gut", `${file.match(/\d+/)[0]}.${file.split(".").pop()}`), "utf8");
      const res = await fetch(GIT(repo, file));
      if (!res.ok) throw new Error(`${repo}/${file}: HTTP ${res.status}`);
      return res.text();
    };
    const list = vol.text
      ? vol.parse(await Promise.all(vol.text.map(async ([repo, file, title]) => [gutenbergText(await get(repo, file)), title])))
      : vol.parse(gutenbergHtml(await get(vol.repo, vol.file)));
    await write(vol, list.filter((c) => c.text.length >= 20 && c.text.length <= 2800), "https://www.gutenberg.org (via GITenberg)");
  }
  const epi = await loadRepo(EPICURUS, from);
  await write(EPICURUS, EPICURUS.parse(epi.flatMap(blocks)), "https://standardebooks.org");

  await writeFile(path.join(OUT, "index.json"), JSON.stringify({ volumes: index, coming: COMING }, null, 2) + "\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
