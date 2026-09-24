import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  POINTS, pointsFor, totalPoints, rankFor, streak, weekCount, addDays, todaysDay, guardReply,
  virtueMeters, journalMarkdown, verifiedPassage,
} from "../public/js/logic.js";

const library = JSON.parse(readFileSync(new URL("../public/data/library.json", import.meta.url)));

test("points: once-a-day rules and the favourite cap", () => {
  const ledger = [];
  const d = "2026-09-24";
  const add = (kind, key) => {
    const pts = pointsFor(kind, ledger, d, key);
    if (pts) ledger.push({ date: d, kind, pts, key });
    return pts;
  };
  assert.equal(add("quick"), POINTS.quick);
  assert.equal(add("session"), POINTS.session - POINTS.quick); // quick upgraded to full
  assert.equal(add("session"), 0);
  assert.equal(add("reflection", "e1"), 20);
  assert.equal(add("reflection", "e1"), 0);
  for (let i = 0; i < 5; i++) assert.equal(add("favourite", `p${i}`), 2);
  assert.equal(add("favourite", "p6"), 0);
  assert.equal(add("evening"), 15);
  assert.equal(add("evening"), 0);
  assert.equal(add("scroll"), 0); // swipes score nothing
  assert.equal(totalPoints(ledger), 10 + 20 + 10 + 15);
});

test("ranks end one short of the sage", () => {
  assert.equal(rankFor(0).name, "Novice");
  assert.equal(rankFor(499).name, "Novice");
  assert.equal(rankFor(500).name, "Student");
  assert.equal(rankFor(2000).name, "Prokoptōn");
  assert.equal(rankFor(1e6).name, "Mentor");
  assert.equal(rankFor(1e6).next, null);
});

test("streak: today pending doesn't break it; grace days bridge gaps, two a month", () => {
  const t = "2026-09-24";
  const days = (from, n) => Array.from({ length: n }, (_, i) => addDays(from, i));
  assert.equal(streak(days("2026-09-20", 4), t).count, 4); // up to yesterday
  assert.equal(streak(days("2026-09-20", 5), t).count, 5); // including today
  // one missed day in the middle is bridged
  const gap = [...days("2026-09-15", 5), ...days("2026-09-21", 3)];
  const s = streak(gap, t);
  assert.equal(s.count, 8);
  assert.deepEqual(s.graceDays, ["2026-09-20"]);
  // three missed days exceed the monthly grace
  const big = [...days("2026-09-10", 5), ...days("2026-09-18", 6)];
  assert.equal(streak(big, t).count, 6);
  assert.deepEqual(streak(big, t).graceDays, []);
  assert.equal(streak([], t).count, 0);
});

test("week count runs Monday to Sunday", () => {
  // 2026-09-21 is a Monday
  assert.equal(weekCount(["2026-09-20", "2026-09-21", "2026-09-24", "2026-09-27", "2026-09-28"], "2026-09-24"), 3);
});

test("the path is locked to one passage per day", () => {
  assert.deepEqual(todaysDay({ completedDay: 0 }, {}, "2026-09-24", 30), { day: 1, done: false });
  assert.deepEqual(todaysDay({ completedDay: 1 }, { "2026-09-24": { day: 1 } }, "2026-09-24", 30), { day: 1, done: true });
  assert.deepEqual(todaysDay({ completedDay: 1 }, { "2026-09-24": { day: 1 } }, "2026-09-25", 30), { day: 2, done: false });
  assert.equal(todaysDay({ completedDay: 30 }, {}, "2026-09-25", 30).finished, true);
});

test("quote guard: tokens become verified passages, invented quotes become paraphrase", () => {
  const allowed = ["meditations.5.20", "meditations.4.7"];
  const reply = [
    "You caught the point: \"the obstacle on the road helps us on this road\" is close, but Marcus puts it as \"that which is an obstacle on the road helps us on this road\".",
    "",
    "> Marcus would say \"your boss is just a rock in the stream of time\".",
    "",
    "Compare [[meditations.4.7]] and [[meditations.12.17]].",
  ].join("\n");
  const blocks = guardReply(reply, library, allowed);
  const parts = blocks[0].parts;
  assert.deepEqual(parts.filter((p) => p.t !== "text").map((p) => p.t), ["paraphrase", "quote"]);
  assert.equal(blocks[1].parts.find((p) => p.t === "paraphrase").text, "your boss is just a rock in the stream of time");
  assert.equal(blocks[2].type, "para");
  assert.deepEqual(blocks[3], { type: "passage", id: "meditations.4.7" });
  // a passage that isn't allowed is never shown in quote style
  assert.ok(blocks[4].parts.map((p) => p.text).join("").includes("(12.17)"));
});

test("quote guard: a tampered passage is not shown", () => {
  const tampered = structuredClone(library);
  tampered.passages["meditations.4.7"].text += " And be happy.";
  assert.equal(verifiedPassage(tampered, "meditations.4.7"), null);
  assert.deepEqual(guardReply("[[meditations.4.7]]", tampered, ["meditations.4.7"])[0].type, "para");
  assert.equal(verifiedPassage(library, "constructor"), null);
});

test("virtue meters count reflections, and the journal exports as a book", () => {
  const journal = [
    { date: "2026-09-24", passageId: "meditations.1.1", virtue: "temperance", reflection: "I kept my temper.", response: "Good. See [[meditations.4.7]].", applied: { yes: true, example: "At lunch" } },
    { date: "2026-09-23", passageId: "meditations.2.1", virtue: "justice", reflection: "" },
  ];
  assert.deepEqual(virtueMeters(journal), { wisdom: 0, justice: 0, courage: 0, temperance: 1 });
  const md = journalMarkdown(journal, library);
  assert.match(md, /## 2026-09-23 · Meditations 2\.1[\s\S]*## 2026-09-24/);
  assert.match(md, /> From my grandfather Verus/);
  assert.match(md, /\(see 4\.7\)/);
  assert.match(md, /\*\*Applied it\?\*\* Yes: At lunch/);
});
