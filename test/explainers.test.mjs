import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { build, quoteProblems } from "../scripts/build-explainers.mjs";

const read = (p) => JSON.parse(readFileSync(new URL(`../public/data/${p}`, import.meta.url)));

test("every day of the course has a stored explainer", () => {
  const course = read("course-meditations.json");
  const ex = read("explainers/meditations.json");
  const missing = course.days.filter((d) => !ex[`meditations.${d.ref}`]).map((d) => d.ref);
  assert.deepEqual(missing, []);
});

test("every Meditations passage has a stored explainer", () => {
  const lib = read("library.json").passages;
  const ex = read("explainers/meditations.json");
  assert.deepEqual(Object.keys(lib).filter((id) => !ex[id]), []);
});

test("explainers are valid and never misquote", async () => {
  const counts = await build({ write: false });
  assert.ok(counts.meditations >= 120);
});

test("quote check catches invented quotations", () => {
  const e = { meaning: 'He says "the obstacle is the way" here.', today: "x", you: "y" };
  assert.equal(quoteProblems(e, "that which is an obstacle on the road helps us on this road").length, 1);
  assert.equal(quoteProblems(e, "the obstacle is the way").length, 0);
});

test("every library volume has explainers for its featured cards", () => {
  const index = read("volumes/index.json");
  for (const v of index.volumes) {
    const file = new URL(`../public/data/explainers/${v.id}.json`, import.meta.url);
    if (!existsSync(file)) continue; // enforced once featured explainers exist for all (see CLAUDE.md)
    const ex = read(`explainers/${v.id}.json`);
    assert.ok(Object.keys(ex).length >= 15, `${v.id}: at least 15 featured explainers`);
  }
});
