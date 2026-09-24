import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { TRADITIONS, WEEKS } from "../scripts/traditions/selections.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url)));
const sha = (s) => createHash("sha256").update(s).digest("hex");
const wing = read("traditions.json");
const vol = (id) => read(`volumes/${id.split(".")[0]}.json`).passages[id];

test("the Traditions wing has every tradition the selections name", () => {
  assert.deepEqual(wing.traditions.map((t) => t.id), TRADITIONS.map((t) => t.id));
  assert.deepEqual(wing.weeks.map((w) => w.theme), ["Foundations", "Ethics", "The self", "Purpose and practice"]);
  assert.ok(wing.pending.some((p) => p.name === "Sikhism"), "Sikhism is listed as pending, with the reason");
});

test("each tradition has 25–40 days spread across all four weeks, and every day is a real card", () => {
  for (const t of wing.traditions) {
    assert.ok(t.days.length >= 25 && t.days.length <= 40, `${t.id}: ${t.days.length} days`);
    for (const w of WEEKS) assert.ok(t.days.some((d) => d.week === w.n), `${t.id}: week ${w.n}`);
    for (const d of t.days) assert.ok(vol(d.id), `${t.id}: ${d.id} resolves`);
  }
});

test("every tradition passage is verbatim and checksummed, with its licence and source", () => {
  for (const t of wing.traditions) {
    const d = read(`volumes/${t.id}.json`);
    assert.equal(Object.keys(d.passages).length, t.count);
    for (const [id, p] of Object.entries(d.passages)) {
      assert.equal(sha(p.text), p.sha256, id);
      if (p.original) assert.equal(sha(p.original), p.originalSha256, `${id} original`);
      assert.ok(p.ref && p.author && p.translator && p.licence && p.source && p.week, id);
      assert.ok(!/<\/?[a-z]|&[a-z]+;|\[\d+\]|�/.test(p.text), `${id}: no markup or footnote markers`);
      assert.ok(p.text.length >= 50 && p.text.length <= 1400, `${id}: card-sized (${p.text.length})`);
    }
    assert.ok(t.sources.length && t.sources.every((s) => s.licence && s.url), `${t.id}: sources listed`);
  }
});

test("known passages come through word for word", () => {
  const find = (tid, ref) => Object.values(read(`volumes/${tid}.json`).passages).find((p) => p.ref === ref)?.text;
  assert.match(find("judaism", "Micah 6:8"), /^It hath been told thee, O man, what is good/);
  assert.match(find("christianity", "Matthew 6:1–4"), /don’t do your charitable giving before men, to be seen by them/);
  assert.match(find("islam", "Quran 2:263–264"), /like him who spendeth his wealth only to be seen of men/);
  assert.match(find("hinduism", "Bhagavad Gita 2.47–48"), /^Thy concern is with work only, but not with the fruit/);
  assert.ok(read("volumes/islam.json").passages["islam.1"].original.startsWith("بِسْمِ"), "Arabic alongside");
});
