import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRequest, DAILY_MODEL, DEEP_MODEL } from "../lib/tutor.js";

const library = JSON.parse(readFileSync(new URL("../public/data/library.json", import.meta.url)));
const course = JSON.parse(readFileSync(new URL("../public/data/course-meditations.json", import.meta.url)));

test("prompts carry verbatim library text, never client-supplied passages", () => {
  const r = buildRequest({ job: "explain", passageId: "meditations.4.7", text: "fake" }, library, course);
  assert.equal(r.model, DAILY_MODEL);
  assert.ok(r.prompt.includes(library.passages["meditations.4.7"].text));
  assert.ok(!r.prompt.includes("fake"));
});

test("expound cites only studied passages and uses the deeper model on request", () => {
  const r = buildRequest({
    job: "expound", passageId: "meditations.2.1", deeper: true, reflection: "I will meet difficult people.",
    studied: ["meditations.1.1", "meditations.99.1", "__proto__"],
  }, library, course);
  assert.equal(r.model, DEEP_MODEL);
  assert.deepEqual(r.allowed, ["meditations.2.1", "meditations.1.1"]);
  assert.match(r.prompt, /at least one place where Marcus would push further/);
});

test("consult offers only the user's studied passages", () => {
  const r = buildRequest({ job: "consult", situation: "A hard meeting", studied: ["meditations.4.7", "meditations.8.47"] }, library, course);
  assert.deepEqual(r.allowed, ["meditations.4.7", "meditations.8.47"]);
  assert.ok(!r.prompt.includes(library.passages["meditations.12.17"].text));
});

test("bad requests are rejected", () => {
  assert.throws(() => buildRequest({ job: "explain", passageId: "constructor" }, library, course), /Unknown passage/);
  assert.throws(() => buildRequest({ job: "poem" }, library, course), /Unknown job/);
  assert.throws(() => buildRequest({ job: "consult", situation: "x", studied: [] }, library, course), /No studied/);
});

test("browser requests use the plan's models and Opus refusal fallback", async () => {
  const { buildRequest: build, requestBody } = await import("../public/js/prompts.js");
  const daily = requestBody(build({ job: "explain", passageId: "meditations.4.7" }, library, course));
  assert.equal(daily.model, "claude-sonnet-5");
  assert.equal(daily.fallbacks, undefined);
  const deep = requestBody(build({ job: "expound", passageId: "meditations.4.7", deeper: true, reflection: "x" }, library, course));
  assert.equal(deep.model, "claude-opus-5");
  assert.equal(deep.fallbacks, "default");
  assert.equal(deep.output_config.effort, "high");
});
