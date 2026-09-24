// Stoa server: serves the web app and holds the Claude API key, so the key
// never reaches the phone. No framework; Node 20+.
//
//   ANTHROPIC_API_KEY=sk-... npm start
//
// Optional: STOA_ACCESS_TOKEN (require this token from the app, for hosting
// on the open internet), PORT, STOA_MODEL, STOA_DEEP_MODEL.

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRequest, runTutor, errorStatus, hasKey, DAILY_MODEL, DEEP_MODEL } from "./lib/tutor.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");
const PORT = Number(process.env.PORT) || 8787;
const TOKEN = process.env.STOA_ACCESS_TOKEN || "";

const library = JSON.parse(await readFile(path.join(root, "data/library.json"), "utf8"));
const course = JSON.parse(await readFile(path.join(root, "data/course-meditations.json"), "utf8"));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};

// Simple per-process budget so a leaked link can't run up a bill.
const DAILY_CALL_CAP = Number(process.env.STOA_DAILY_CALL_CAP) || 60;
let calls = { day: "", n: 0 };

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw Object.assign(new Error("Too large"), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/status") {
    return send(res, 200, {
      claude: hasKey(),
      tokenRequired: Boolean(TOKEN),
      models: { daily: DAILY_MODEL, deep: DEEP_MODEL },
    });
  }
  if (url.pathname !== "/api/tutor" || req.method !== "POST") return send(res, 404, { error: "Not found" });
  if (TOKEN && req.headers["x-stoa-token"] !== TOKEN) return send(res, 401, { error: "Access token required" });
  if (!hasKey()) return send(res, 503, { error: "No Claude API key on the server." });

  const today = new Date().toISOString().slice(0, 10);
  if (calls.day !== today) calls = { day: today, n: 0 };
  if (calls.n >= DAILY_CALL_CAP) return send(res, 429, { error: "Daily tutor limit reached." });

  try {
    const request = buildRequest(await readJson(req), library, course);
    calls.n++;
    send(res, 200, await runTutor(request));
  } catch (err) {
    const [status, message] = errorStatus(err);
    if (status >= 500) console.error(err);
    send(res, status, { error: message });
  }
}

async function handleStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep)) return send(res, 403, "Forbidden", "text/plain");
  try {
    if (!(await stat(file)).isFile()) throw new Error();
    const type = TYPES[path.extname(file)] || "application/octet-stream";
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache" });
    res.end(await readFile(file));
  } catch {
    send(res, 404, "Not found", "text/plain");
  }
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  (url.pathname.startsWith("/api/") ? handleApi : handleStatic)(req, res, url).catch((err) => {
    console.error(err);
    send(res, 500, { error: "Server error" });
  });
}).listen(PORT, () => {
  console.log(`Stoa on http://localhost:${PORT}  (Claude ${hasKey() ? "connected" : "not configured: set ANTHROPIC_API_KEY"})`);
});
