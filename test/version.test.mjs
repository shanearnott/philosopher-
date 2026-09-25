import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../public/${p}`, import.meta.url), "utf8");

test("the app's version matches the service worker cache, so the update check works", () => {
  const cache = read("sw.js").match(/const CACHE = "([^"]+)"/)?.[1];
  const app = read("js/app.js").match(/const APP_VERSION = "([^"]+)"/)?.[1];
  assert.ok(cache && app, "both versions are declared");
  assert.equal(app, cache, "bump APP_VERSION in js/app.js and CACHE in sw.js together");
});
