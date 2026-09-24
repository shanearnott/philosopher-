// Pure logic shared by the app and the tests: no DOM, no storage.

export const POINTS = {
  session: 10,
  quick: 4,
  reflection: 20,
  checkin: 25,
  evening: 15,
  favourite: 2,
  unit: 50,
  course: 250,
};
export const FAVOURITE_DAILY_CAP = 5;
export const REFLECTION_MIN_WORDS = 50;
export const GRACE_DAYS_PER_MONTH = 2;
export const WEEKLY_TARGET = 5;

// The ladder ends one step short of the sage, on purpose.
export const RANKS = [
  { name: "Novice", meaning: "Just started", min: 0 },
  { name: "Student", meaning: "Regular practice", min: 500 },
  { name: "Prokoptōn", meaning: "One making progress", min: 2000 },
  { name: "Practitioner", meaning: "Applies it under pressure", min: 6000 },
  { name: "Mentor", meaning: "Can teach it", min: 15000 },
];

export const VIRTUES = ["wisdom", "justice", "courage", "temperance"];

// ---------- dates (local calendar days as YYYY-MM-DD) ----------

export function dayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + n));
}

export function wordCount(s) {
  return (s || "").trim().split(/\s+/).filter(Boolean).length;
}

// ---------- points ----------

export function totalPoints(ledger) {
  return ledger.reduce((sum, e) => sum + e.pts, 0);
}

export function rankFor(points) {
  let rank = RANKS[0];
  for (const r of RANKS) if (points >= r.min) rank = r;
  const next = RANKS[RANKS.indexOf(rank) + 1] || null;
  return { ...rank, next };
}

// Returns the points an event is worth given what's already in the ledger,
// or 0 when a cap or once-per-day rule applies.
export function pointsFor(kind, ledger, date, key) {
  const today = ledger.filter((e) => e.date === date);
  switch (kind) {
    case "favourite":
      return today.filter((e) => e.kind === "favourite").length < FAVOURITE_DAILY_CAP
        ? POINTS.favourite
        : 0;
    case "session":
      // finishing all six cards after a quick session earns the difference
      if (today.some((e) => e.kind === "session")) return 0;
      return today.some((e) => e.kind === "quick") ? POINTS.session - POINTS.quick : POINTS.session;
    case "quick":
      return today.some((e) => e.kind === "session" || e.kind === "quick") ? 0 : POINTS.quick;
    case "evening":
      return today.some((e) => e.kind === "evening") ? 0 : POINTS.evening;
    case "reflection":
    case "checkin":
    case "unit":
    case "course":
      // once per key (journal entry id, unit number, course id)
      return ledger.some((e) => e.kind === kind && e.key === key) ? 0 : POINTS[kind];
    default:
      return 0;
  }
}

// ---------- streaks ----------

// sessionDates: iterable of YYYY-MM-DD with a completed (full or quick) session.
// A missed day is bridged by a grace day if that month has grace left
// (2 a month). Grace days keep the streak alive but don't add to it.
export function streak(sessionDates, today = dayKey()) {
  const done = new Set(sessionDates);
  const graceUsed = {};
  const graceDays = [];
  let pending = []; // grace spent since the last session day; kept only if bridged
  let count = 0;
  // today not being done yet doesn't break the streak
  let cursor = done.has(today) ? today : addDays(today, -1);
  for (let i = 0; i < 3660; i++, cursor = addDays(cursor, -1)) {
    if (done.has(cursor)) {
      count++;
      graceDays.push(...pending);
      pending = [];
      continue;
    }
    const month = cursor.slice(0, 7);
    if ((graceUsed[month] || 0) >= GRACE_DAYS_PER_MONTH) break;
    graceUsed[month] = (graceUsed[month] || 0) + 1;
    pending.push(cursor);
  }
  return { count, graceDays };
}

// Sessions in the Monday-to-Sunday week containing `today`.
export function weekCount(sessionDates, today = dayKey()) {
  const [y, m, d] = today.split("-").map(Number);
  const dow = (new Date(y, m - 1, d).getDay() + 6) % 7; // Monday = 0
  const start = addDays(today, -dow);
  const end = addDays(start, 6);
  return [...new Set(sessionDates)].filter((k) => k >= start && k <= end).length;
}

// ---------- virtue meters ----------

export function virtueMeters(journal) {
  const meters = Object.fromEntries(VIRTUES.map((v) => [v, 0]));
  for (const e of journal) {
    if (e.virtue in meters && wordCount(e.reflection) > 0) meters[e.virtue]++;
  }
  return meters;
}

// ---------- the daily path ----------

// The session is locked to one passage per day. Returns the course day to show today.
export function todaysDay(progress, sessions, today, totalDays) {
  if (sessions[today]) return { day: sessions[today].day, done: true };
  const next = (progress.completedDay || 0) + 1;
  if (next > totalDays) return { day: totalDays, done: true, finished: true };
  return { day: next, done: false };
}

// ---------- checksum (SHA-256, so it works without a secure context) ----------

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(str) {
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length;
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(padded.length - 8, Math.floor((len * 8) / 2 ** 32));
  view.setUint32(padded.length - 4, (len * 8) >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return [...h].map((x) => x.toString(16).padStart(8, "0")).join("");
}

// A passage is shown as a quote only if its text still matches its checksum.
export function verifiedPassage(library, id) {
  const p = Object.hasOwn(library.passages, id) ? library.passages[id] : null;
  return p && sha256(p.text) === p.sha256 ? p : null;
}

// ---------- quote guard ----------

const normalise = (s) =>
  s
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Parses Claude's reply into display blocks. Passages appear only as
// [[meditations.B.S]] tokens, replaced with the verified library text.
// Any quoted span that isn't verbatim in an allowed passage loses its quote
// marks and is flagged as paraphrase, so Claude's words never look like Marcus's.
export function guardReply(text, library, allowedIds) {
  const allowed = new Set(allowedIds);
  const sources = [...allowed]
    .map((id) => verifiedPassage(library, id))
    .filter(Boolean)
    .map((p) => normalise(p.text));
  const blocks = [];
  const cleaned = (text || "")
    .replace(/\r/g, "")
    .replace(/^[ \t]*>+[ \t]?/gm, "")
    .replace(/^[ \t]*#+[ \t]*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1");
  for (const para of cleaned.split(/\n\s*\n/)) {
    // tokens may sit inline; split them out as their own blocks
    const pieces = para.split(/(\[\[[a-z]+\.\d+\.\d+\]\])/);
    let inline = [];
    const flush = () => {
      const joined = inline.join("").trim();
      if (joined) blocks.push({ type: "para", parts: splitQuotes(joined, sources) });
      inline = [];
    };
    for (const piece of pieces) {
      const m = piece.match(/^\[\[([a-z]+\.\d+\.\d+)\]\]$/);
      if (!m) {
        inline.push(piece);
        continue;
      }
      const id = m[1];
      if (allowed.has(id) && verifiedPassage(library, id)) {
        flush();
        blocks.push({ type: "passage", id });
      } else {
        inline.push(`(${id.split(".").slice(1).join(".")})`);
      }
    }
    flush();
  }
  return blocks;
}

function splitQuotes(text, sources) {
  const parts = [];
  const re = /“([^”]+)”|"([^"]+)"/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) parts.push({ t: "text", text: text.slice(last, m.index) });
    const inner = m[1] ?? m[2];
    const n = normalise(inner);
    const verbatim = n.split(" ").length >= 3 && sources.some((s) => s.includes(n));
    // short spans ("control", "harm") are just words in quotes
    if (verbatim) parts.push({ t: "quote", text: inner });
    else if (inner.split(/\s+/).length >= 5) parts.push({ t: "paraphrase", text: inner });
    else parts.push({ t: "text", text: `“${inner}”` });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ t: "text", text: text.slice(last) });
  return parts;
}

// ---------- export ----------

export function journalMarkdown(journal, library) {
  const lines = ["# My Meditations", "", "_A journal kept with Stoa._", ""];
  for (const e of [...journal].sort((a, b) => a.date.localeCompare(b.date))) {
    const p = library.passages[e.passageId];
    lines.push(`## ${e.date} · ${p ? `${p.work} ${p.ref}` : e.title || "Entry"}`, "");
    if (p) {
      lines.push(...p.text.split("\n").map((l) => `> ${l}`), "", `> — ${p.author}, ${p.work} ${p.ref} (tr. ${p.translator})`, "");
    }
    if (e.question) lines.push(`**Question:** ${e.question}`, "");
    if (e.reflection) lines.push("**My reflection**", "", e.reflection, "");
    if (e.response) lines.push("**Tutor's response**", "", e.response.replace(/\[\[([a-z]+)\.(\d+\.\d+)\]\]/g, "(see $2)"), "");
    if (e.reply) lines.push("**My reply**", "", e.reply, "");
    if (e.replyResponse) lines.push("**Tutor**", "", e.replyResponse.replace(/\[\[([a-z]+)\.(\d+\.\d+)\]\]/g, "(see $2)"), "");
    if (e.applied) lines.push(`**Applied it?** ${e.applied.yes ? "Yes" : "Not yet"}${e.applied.example ? `: ${e.applied.example}` : ""}`, "");
    if (e.evening) {
      lines.push("**Evening review**", "", `- Done well: ${e.evening.well}`, `- Done badly: ${e.evening.badly}`, `- Left undone: ${e.evening.undone}`, "");
    }
  }
  return lines.join("\n");
}
