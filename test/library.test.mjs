import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sha256 } from "../public/js/logic.js";
import { clean, splitBook, extract } from "../scripts/ingest.mjs";

const library = JSON.parse(readFileSync(new URL("../public/data/library.json", import.meta.url)));
const course = JSON.parse(readFileSync(new URL("../public/data/course-meditations.json", import.meta.url)));

test("every passage matches its stored checksum", () => {
  for (const [id, p] of Object.entries(library.passages)) {
    assert.equal(createHash("sha256").update(p.text).digest("hex"), p.sha256, id);
  }
});

test("in-app SHA-256 agrees with node's", () => {
  for (const s of ["", "abc", "Things themselves touch not the soul", "Æsculapius — “quoted” ’", "x".repeat(1000)]) {
    assert.equal(sha256(s), createHash("sha256").update(s, "utf8").digest("hex"));
  }
});

test("every course day points at a library passage", () => {
  assert.equal(course.days.length, 120);
  assert.equal(new Set(course.days.map((d) => d.ref)).size, 120, "no passage repeats");
  course.days.forEach((d, i) => {
    assert.equal(d.day, i + 1);
    assert.ok(library.passages[`meditations.${d.ref}`], d.ref);
    assert.ok(["wisdom", "justice", "courage", "temperance"].includes(d.virtue), d.ref);
    assert.deepEqual(Object.keys(d.apply).sort(), ["decision", "family", "work"]);
  });
});

test("course text never misquotes: quoted spans are verbatim or single words", () => {
  for (const d of course.days) {
    const text = library.passages[`meditations.${d.ref}`].text;
    for (const f of [d.context, ...Object.values(d.apply)]) {
      for (const m of f.matchAll(/(?:^|[\s(])'([^']*\s[^']*?)'(?=[\s.,;:?!)]|$)/g)) {
        // Standard Ebooks' place notes aren't part of the passage
        if (m[1].startsWith("Among the Quadi") || m[1] === "Book 1") continue;
        assert.ok(text.toLowerCase().includes(m[1].toLowerCase()), `${d.ref}: '${m[1]}' is not in the passage`);
      }
    }
  }
});

test("ingest keeps verse quotations with their paragraph and drops note markers", () => {
  const xhtml = `<h2>Book</h2><p>First<a href="#n" epub:type="noteref">4</a> para.</p>
    <p>Then this: </p><blockquote><p>A verse line</p><cite>Hesiod</cite></blockquote><p>Third</p>`;
  const blocks = splitBook(xhtml);
  assert.deepEqual(blocks.map((b) => b.kind), ["p", "p", "blockquote", "p"]);
  assert.equal(extract(blocks, 1, 1), "First para.");
  assert.equal(extract(blocks, 2, 2), "Then this:\nA verse line\n— Hesiod");
  assert.equal(clean("a&amp;b&#8212;c⁠"), "a&b—c");
});
