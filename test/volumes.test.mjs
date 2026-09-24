import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pointsFor, guardReply } from "../public/js/logic.js";
import { tagThemes, THEMES } from "../public/js/themes.js";
import { buildRequest } from "../public/js/prompts.js";
import { blocks, cards, VOLUMES, GUTENBERG, EPICURUS, decode, isEnglish } from "../scripts/ingest-volumes.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url)));
const index = read("volumes/index.json");

test("every volume passage matches its checksum and has a reference", () => {
  assert.equal(index.volumes.length, VOLUMES.length + GUTENBERG.length + 1);
  assert.ok(index.volumes.some((v) => v.id === EPICURUS.id));
  for (const v of index.volumes) {
    const d = read(`volumes/${v.id}.json`);
    const entries = Object.entries(d.passages);
    assert.equal(entries.length, v.count, v.id);
    assert.ok(entries.length >= 50, `${v.id} has enough cards`);
    for (const [id, p] of entries) {
      assert.ok(id.startsWith(`${v.id}.`), id);
      assert.equal(createHash("sha256").update(p.text).digest("hex"), p.sha256, id);
      assert.ok(p.ref && p.author && p.translator, id);
      assert.ok(p.text.length <= 2800, id);
    }
  }
});

test("numbered works keep their standard numbering", () => {
  const tao = read("volumes/taoteching.json").passages;
  assert.match(Object.values(tao).find((p) => p.ref === "Tao Te Ching 1").text, /^The Tao that can be trodden/);
  const ench = read("volumes/enchiridion.json").passages;
  assert.match(Object.values(ench).find((p) => p.ref === "Enchiridion 5").text, /^Men are disturbed not by the things which happen/);
  const an = read("volumes/analects.json").passages;
  assert.match(Object.values(an).find((p) => p.ref === "Analects 1.4").text, /I daily examine myself on three points/);
});

test("the added volumes keep their own numbering and drop editors' notes", () => {
  const find = (vol, ref) => Object.values(read(`volumes/${vol}.json`).passages).find((p) => p.ref === ref)?.text;
  assert.equal(find("rochefoucauld", "La Rochefoucauld, Maxim 2"), "Self-love is the greatest of flatterers.");
  assert.match(find("dhammapada", "Dhammapada 1–2"), /^1\. All that we are is the result of what we have thought/);
  assert.match(find("pascal", "Pascal, Pensées 394"), /^All the principles of sceptics, stoics, atheists/);
  assert.match(find("onduties", "On Duties 1.1"), /^My dear son Marcus/);
  assert.match(find("epicurus", "Epicurus, Letter to Menoeceus, ¶1"), /^Let no one delay to study philosophy/);
  const montaigne = Object.values(read("volumes/montaigne.json").passages);
  assert.ok(montaigne.every((p) => !/D\.W\.|\[/.test(p.text)), "Montaigne editors' notes removed");
  const all = index.volumes.flatMap((v) => Object.values(read(`volumes/${v.id}.json`).passages));
  assert.ok(all.every((p) => !/&[a-z]+;|<\/?[a-z]|\[Pg \d+\]|\ufffd/.test(p.text)), "no markup left");
  assert.ok(all.every((p) => !/ \n|\n /.test(p.text)), "no hard-wrapped source lines");
});

test("entity decoding and the Latin filter", () => {
  assert.equal(decode("Pens&eacute;es &mdash; &AElig;sop &#233; &#x2014;"), "Pensées — Æsop é —");
  assert.ok(isEnglish("Now, as Regulus deserves praise for being true to his oath, so those ten"));
  assert.ok(!isEnglish("Acilius autem, qui Graece scripsit historiam, plures ait fuisse"));
});

test("card splitting never breaks a paragraph and labels paragraph ranges", () => {
  const vol = { ref: (id) => `Essay ${id}`, verses: false };
  const long = "x".repeat(700);
  const xhtml = `<section id="s1"><h2>T</h2><p>${long}</p><p>${long}</p><p>${long}</p></section><section id="s2"><p>Short and whole, forty characters or more.</p></section>`;
  const out = cards(vol, blocks(xhtml));
  assert.deepEqual(out.map((c) => c.ref), ["Essay s1, ¶1", "Essay s1, ¶2", "Essay s1, ¶3", "Essay s2"]);
  assert.ok(out.every((c) => !c.text.includes("<")));
});

test("themes are tagged by whole words", () => {
  assert.deepEqual(tagThemes("The general led the army to victory."), ["leadership", "war"]);
  assert.deepEqual(tagThemes("Warm dying embers"), ["death"]);
  assert.ok(Object.keys(THEMES).length >= 6);
});

test("Mix: reading and writing score nothing", () => {
  assert.equal(pointsFor("mixRead", [], "2026-09-24"), 0);
  assert.equal(pointsFor("mixReflection", [], "2026-09-24", "m1"), 0);
});

test("quote guard cites passages from any author in the library", () => {
  const tao = read("volumes/taoteching.json").passages;
  const lib = { passages: { ...tao } };
  const [block] = guardReply("[[taoteching.1]]", lib, ["taoteching.1"]);
  assert.deepEqual(block, { type: "passage", id: "taoteching.1" });
  const [para] = guardReply("See [[taoteching.2]].", lib, ["taoteching.1"]);
  assert.match(para.parts.map((p) => p.text).join(""), /\(Tao Te Ching 2\)/);
});

test("Read alongside is summary-only and limited to the shelf", () => {
  const lib = { passages: {} };
  const course = { days: [] };
  const r = buildRequest({ job: "alongside", book: "Man's Search for Meaning" }, lib, course);
  assert.match(r.prompt, /Do not quote the book at all/);
  assert.deepEqual(r.allowed, []);
  assert.throws(() => buildRequest({ job: "alongside", book: "Harry Potter" }, lib, course), /Unknown book/);
});
