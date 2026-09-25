import {
  POINTS, RANKS, VIRTUES, WEEKLY_TARGET, GRACE_DAYS_PER_MONTH, MIX_RUN_LENGTH, sha256,
  dayKey, totalPoints, rankFor, pointsFor, streak, weekCount,
  virtueMeters, verifiedPassage, guardReply, citeRef, fullRef, savedMarkdown, splitInitial,
} from "./logic.js";
import { load, save, wipe, freshState } from "./store.js";
import { buildRequest, handoffText } from "./prompts.js";
import { callClaude } from "./direct.js";
import { THEMES, tagThemes } from "./themes.js";
import { initialSVG } from "./illumination.js";

// The running version; must equal CACHE in sw.js (test/version.test.mjs).
const APP_VERSION = "stoa-v28";

// ---------- boot ----------

const [library, course] = await Promise.all([
  fetch("data/library.json").then((r) => r.json()),
  fetch("data/course-meditations.json").then((r) => r.json()),
]);
let state = load();

// Stored explainers (written into the app, no Claude call needed): per volume,
// passage id -> { meaning, today, you }.
const explainers = {};
const explainerFiles = new Map();
function loadExplainers(vol) {
  if (!explainerFiles.has(vol)) {
    explainerFiles.set(vol, fetch(`data/explainers/${vol}.json`)
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}))
      .then((d) => Object.assign(explainers, d)));
  }
  return explainerFiles.get(vol);
}
loadExplainers("meditations");
{
  const url = new URL(location.href);
  const code = url.searchParams.get("code");
  if (code) {
    state.settings.token = code.trim();
    save(state);
    url.searchParams.delete("code");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    setTimeout(() => toast("Access code saved on this device"), 600);
  }
}
let status = { claude: false, tokenRequired: false };
// No server answers on a static host (GitHub Pages); the tutor then uses the
// user's own API key from this device, if one is saved.
const statusReady = fetch("api/status")
  .then((r) => (r.ok && (r.headers.get("content-type") || "").includes("json") ? r.json() : null))
  .then((s) => { if (s) status = { ...s, server: true }; })
  .catch(() => {});

const view = document.getElementById("view");
const tabs = document.querySelectorAll(".tabs button");
const persist = () => save(state);
const pid = (day) => `meditations.${day.ref}`;
const dayByNum = (n) => course.days.find((d) => d.day === n);
const unitOf = (day) => course.units.find((u) => u.n === day.unit);

// Card backgrounds until museum imagery lands (Phase 2): dusk gradients per virtue.
const DUSK = {
  wisdom: ["#2b2a3a", "#4a3f52", "#141318"],
  justice: ["#3a2a24", "#6b3d2e", "#151110"],
  courage: ["#40261d", "#8a4a32", "#1a100c"],
  temperance: ["#23302e", "#44534c", "#111615"],
};
const dusk = (virtue, angle = 180) => {
  const [a, b, c] = DUSK[virtue] || DUSK.wisdom;
  return `radial-gradient(120% 70% at 50% 0%, ${b} 0%, transparent 60%), linear-gradient(${angle}deg, ${a}, ${c})`;
};

// ---------- tiny DOM helper ----------

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") {
      // custom properties (--card-bg, --qsize) need setProperty
      for (const [prop, val] of Object.entries(v)) prop.startsWith("--") ? el.style.setProperty(prop, val) : (el.style[prop] = val);
    }
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : String(kid));
  return el;
}

let toastTimer;
function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
}

function award(kind, key) {
  const date = dayKey();
  const pts = pointsFor(kind, state.ledger, date, key);
  if (pts > 0) {
    state.ledger.push({ date, kind, pts, key });
    persist();
  }
  return pts;
}

// ---------- theme: dark by default after 8pm ----------

function applyTheme() {
  const pref = state.settings.theme;
  const hr = new Date().getHours();
  const dark = pref === "dark" || (pref === "auto" && (hr >= 20 || hr < 6));
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.body.classList.toggle("hide-numbers", !!state.settings.hideNumbers);
}
applyTheme();
setInterval(applyTheme, 5 * 60 * 1000);

// ---------- tutor ----------

function studiedIds(extraDay) {
  const ids = course.days.filter((d) => d.day <= state.progress.completedDay).map(pid);
  if (extraDay) ids.push(pid(extraDay));
  return [...new Set(ids)];
}

async function tutor(job, payload) {
  await statusReady;
  const body = { job, profile: state.profile, ...payload };
  if (!status.claude) {
    const req = buildRequest(body, library, course);
    // Pay-per-use key if one is saved; otherwise hand off to the Claude app
    return state.settings.apiKey ? callClaude(state.settings.apiKey, req) : claudeHandoff(req);
  }
  const res = await fetch("api/tutor", {
    method: "POST",
    headers: { "content-type": "application/json", ...(state.settings.token ? { "x-stoa-token": state.settings.token } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    accessCodeSheet();
    throw new Error("The tutor needs your access code. Enter it, then try again.");
  }
  if (!res.ok) throw new Error(data.error || `Tutor unavailable (${res.status})`);
  return data;
}

// No server and no API key: the tutor runs in the user's Claude app.
const handoffMode = () => !status.claude && !state.settings.apiKey;

// Renders Claude's words through the quote guard.
function renderTutor(text, allowed) {
  const wrap = h("div", { class: "tutor" });
  for (const block of guardReply(text, library, allowed)) {
    if (block.type === "passage") {
      const p = verifiedPassage(library, block.id);
      wrap.append(h("blockquote", { class: "cited" }, p.text, h("cite", {}, citeRef(p))));
    } else {
      wrap.append(
        h("p", {}, block.parts.map((part) =>
          part.t === "quote" ? h("q", { class: "verbatim" }, part.text)
          : part.t === "paraphrase" ? h("span", { class: "paraphrase", title: "Paraphrase, not a quotation" }, part.text)
          : part.text)),
      );
    }
  }
  return wrap;
}

// Explain: the stored explainer, shown instantly; then an optional deeper dive
// that hands a prompt to Claude. Falls back to asking Claude when a passage has
// no stored explainer yet.
function explainerView(id) {
  const e = explainers[id];
  const part = (label, text) => text && h("div", { class: "explainer-part" }, h("p", { class: "explainer-label" }, label), renderTutor(text, [id]));
  return h("div", { class: "explainer" },
    part("In plain English", e.meaning), part("Background", e.context), part("Today", e.today), part("For you", e.you));
}

// "Go deeper": hands a richer prompt (with the stored explainer) to Claude.
function deeperButton(id, out, studied) {
  const deeper = h("button", { class: "btn", onclick: async () => {
    deeper.disabled = true;
    const note = h("div");
    out.append(note);
    note.replaceChildren(thinking());
    try {
      const e = explainers[id];
      const r = await tutor("deeper", { passageId: id, studied, explainer: e ? [e.meaning, e.context, e.today, e.you].filter(Boolean).join("\n") : "" });
      note.replaceChildren(h("p", { class: "explainer-label" }, "Deeper"), renderTutor(r.text, r.allowed));
      deeper.remove();
    } catch (err) {
      note.replaceChildren(h("p", { class: "tutor-note" }, err.message));
      deeper.disabled = false;
    }
  } }, handoffMode() ? "Go deeper in Claude" : "Go deeper");
  return deeper;
}

// Asks Claude to explain a card that has no stored explainer yet.
async function askExplain(id, out, studied) {
  out.replaceChildren(thinking());
  const r = await tutor("explain", { passageId: id, studied });
  out.replaceChildren(renderTutor(r.text, r.allowed));
}

function explainButton(id, out, studied, label) {
  const btn = h("button", { class: "btn", onclick: async () => {
    btn.disabled = true;
    await loadExplainers(id.split(".")[0]);
    if (explainers[id]) {
      out.replaceChildren(explainerView(id));
      btn.replaceWith(deeperButton(id, out, studied));
      return;
    }
    try {
      await askExplain(id, out, studied);
      btn.replaceWith(deeperButton(id, out, studied));
    } catch (err) {
      out.replaceChildren(h("p", { class: "tutor-note" }, err.message));
      btn.disabled = false;
    }
  } }, label);
  return btn;
}

// Sideways swipes on a card: left calls left(), right calls right(). Vertical
// swipes stay with the deck. Touch events, because browsers cancel pointer
// events once they start panning; pointer events for a mouse.
function sideSwipe(el, { left, right }) {
  let x0 = 0, y0 = 0, t0 = 0, live = false;
  const start = (x, y) => { x0 = x; y0 = y; t0 = Date.now(); live = true; };
  const end = (x, y) => {
    if (!live) return;
    live = false;
    const dx = x - x0, dy = y - y0;
    if (Math.abs(dx) < 50 || Math.abs(dx) < Math.abs(dy) * 1.5 || Date.now() - t0 > 900) return;
    (dx < 0 ? left : right)?.();
  };
  el.addEventListener("touchstart", (e) => e.touches.length === 1 ? start(e.touches[0].clientX, e.touches[0].clientY) : (live = false), { passive: true });
  el.addEventListener("touchend", (e) => end(e.changedTouches[0].clientX, e.changedTouches[0].clientY), { passive: true });
  el.addEventListener("touchcancel", () => { live = false; }, { passive: true });
  el.addEventListener("pointerdown", (e) => e.pointerType === "mouse" && !e.button && start(e.clientX, e.clientY));
  el.addEventListener("pointerup", (e) => e.pointerType === "mouse" && end(e.clientX, e.clientY));
}

// The explainer slides in over a card: swipe left (or tap Explain) to open,
// swipe right (or tap ›) to close. Filled from the stored explainer; cards
// without one offer to ask Claude.
function explainPanel(card, id, studied, { before, after } = {}) {
  const body = h("div", { class: "panel-scroll" });
  const panel = h("aside", { class: "explain-panel", "aria-hidden": "true" },
    h("div", { class: "panel-head" },
      h("p", { class: "eyebrow" }, "Explainer"),
      h("button", { class: "panel-close", "aria-label": "Close explainer", onclick: () => close() }, icon("back"))),
    body,
    h("p", { class: "hint" }, "Swipe right to close"));
  let filled = false;
  const fill = async () => {
    await loadExplainers(volOf(id));
    const extra = [before?.()].filter(Boolean), tail = [after?.()].filter(Boolean);
    if (explainers[id]) return body.replaceChildren(...extra, explainerView(id), ...tail, h("div", { class: "btn-row" }, deeperButton(id, body, studied)));
    const ask = h("button", { class: "btn primary", onclick: async () => {
      ask.disabled = true;
      try {
        await askExplain(id, body, studied);
        body.append(h("div", { class: "btn-row" }, deeperButton(id, body, studied)));
      } catch (err) {
        body.append(h("p", { class: "tutor-note" }, err.message));
        ask.disabled = false;
      }
    } }, handoffMode() ? "Explain in Claude" : "Explain with Claude");
    body.replaceChildren(...extra, h("p", { class: "soft" }, "This card has no stored explainer yet."), ...tail, h("div", { class: "btn-row" }, ask));
  };
  const open = () => {
    if (!filled) { filled = true; fill(); }
    card.classList.add("explaining");
    panel.setAttribute("aria-hidden", "false");
  };
  const close = () => {
    card.classList.remove("explaining");
    panel.setAttribute("aria-hidden", "true");
  };
  card.append(panel);
  sideSwipe(card, { left: open, right: close });
  // close it once the card has been swiped away
  new IntersectionObserver((es) => es[0].intersectionRatio < 0.4 && close(), { threshold: [0, 0.4] }).observe(card);
  card.explain = { open, close };
  return card.explain;
}

// Thin line icons (player and tabs), drawn in currentColor.
const ICONS = {
  subjects: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  shuffle: '<path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="m15 15 6 6"/><path d="m4 4 5 5"/>',
  browse: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/>',
  forward: '<path d="M6 5.5v13l9-6.5z"/><path d="M18.5 5.5v13"/>',
  back: '<path d="m9 6 6 6-6 6"/>',
};
function icon(name) {
  const span = h("span", { class: "icon", "aria-hidden": "true" });
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;
  return span;
}

const thinking = () => h("div", { class: "thinking", "aria-label": "Thinking" }, h("i"), h("i"), h("i"));

// Option 2: run the tutor in the user's own Claude app (their subscription).
// Stoa copies the prompt and opens Claude; the reply is pasted back and goes
// through the same quote guard as any other tutor response.
function claudeHandoff(req) {
  const text = handoffText(req);
  const url = encodeURIComponent(text).length < 7000
    ? `https://claude.ai/new?q=${encodeURIComponent(text)}`
    : "https://claude.ai/new";
  return new Promise((resolve, reject) => {
    const reply = h("textarea", { placeholder: "Paste Claude's reply here" });
    const promptBox = h("textarea", { readonly: true, style: { minHeight: "120px", fontSize: "13px" } }, text);
    const manual = h("details", {}, h("summary", { class: "muted" }, "Copy didn't work? Show the prompt"), promptBox);
    const step2 = h("div", { hidden: true },
      h("label", { class: "field" }, h("span", {}, "2. Paste Claude's reply"), reply),
      h("div", { class: "btn-row" },
        h("button", { class: "btn primary", onclick: () => {
          if (!reply.value.trim()) return toast("Paste the reply first");
          done = true;
          back.remove();
          resolve({ text: reply.value.trim(), allowed: req.allowed });
        } }, "Save reply")));
    let done = false;
    const cancel = () => {
      if (done) return;
      done = true;
      back.remove();
      reject(new Error("No reply saved yet. Tap again when you're ready."));
    };
    const back = sheet(
      h("h2", {}, "Ask in Claude"),
      h("p", { class: "muted" }, "Uses your Claude subscription, so there's no extra cost. Stoa copies the tutor's instructions and today's passage; paste them into Claude, then bring the reply back here."),
      h("div", { class: "btn-row" },
        h("button", { class: "btn primary", onclick: () => {
          navigator.clipboard?.writeText(text).then(() => toast("Copied. Paste it into Claude."), () => {});
          window.open(url, "_blank", "noopener");
          step2.hidden = false;
        } }, "1. Copy and open Claude"),
        h("button", { class: "btn", onclick: cancel }, "Cancel")),
      manual,
      step2);
    back.addEventListener("click", (e) => e.target === back && cancel());
  });
}

function accessCodeSheet() {
  if (document.querySelector(".sheet-backdrop")) return;
  const input = h("input", { type: "password", autocomplete: "off", autocapitalize: "off", placeholder: "Access code" });
  const back = sheet(
    h("h2", {}, "Access code"),
    h("p", { class: "muted" }, "Your Stoa server is protected. Enter the access code you chose when you set it up. It's saved on this device only."),
    h("label", { class: "field" }, input),
    h("div", { class: "btn-row" },
      h("button", { class: "btn primary", onclick: () => {
        if (!input.value.trim()) return;
        state.settings.token = input.value.trim();
        persist();
        back.remove();
        toast("Saved. Try again.");
      } }, "Save"),
      h("button", { class: "btn", onclick: () => back.remove() }, "Cancel")));
  setTimeout(() => input.focus(), 100);
}

// ---------- add to home screen ----------

const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
// iPadOS reports itself as a Mac; touch support gives it away
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  if (current() === "learn") showInstallBanner();
});

function installDismissed() {
  try { return localStorage.getItem("stoa.installDismissed") === "1"; } catch { return false; }
}

function showInstallBanner() {
  if (standalone() || installDismissed() || document.querySelector(".install")) return;
  if (!installEvent && !isIOS()) return;
  const close = () => {
    banner.remove();
    try { localStorage.setItem("stoa.installDismissed", "1"); } catch {}
  };
  const device = /iPad/.test(navigator.userAgent) || navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent) ? "iPad" : "iPhone";
  const banner = h("div", { class: "install", role: "note" },
    h("div", {},
      h("strong", {}, "Put Stoa on your home screen"),
      installEvent
        ? h("span", {}, "It opens full screen, like an app, and works offline.")
        : h("span", {}, `In Safari, tap `, h("b", {}, "Share"), " ", h("span", { class: "share-glyph", "aria-hidden": "true", html: '<svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 2v11M6.5 5.5 10 2l3.5 3.5M6 8.5H4.5v9h11v-9H14"/></svg>' }), ` then `, h("b", {}, "Add to Home Screen"), `. Then move it to where Instagram was on your ${device}.`)),
    h("div", { class: "install-actions" },
      installEvent && h("button", { class: "btn gold", onclick: async () => {
        installEvent.prompt();
        await installEvent.userChoice.catch(() => {});
        installEvent = null;
        close();
      } }, "Install"),
      h("button", { class: "install-close", "aria-label": "Dismiss", onclick: close }, "×")));
  document.body.append(banner);
}

// ---------- keyboard (iPad keyboards, desktop) ----------

document.addEventListener("keydown", (e) => {
  const deck = document.querySelector(".deck");
  if (!deck || e.target.closest("textarea, input, select") || document.querySelector(".sheet-backdrop")) return;
  const here = deck.children[Math.round(deck.scrollTop / deck.clientHeight)];
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    if (!here?.explain) return;
    e.preventDefault();
    return e.key === "ArrowLeft" ? here.explain.open() : here.explain.close();
  }
  const step = { ArrowDown: 1, PageDown: 1, " ": 1, ArrowUp: -1, PageUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const i = Math.round(deck.scrollTop / deck.clientHeight) + step;
  deck.scrollTo({ top: i * deck.clientHeight, behavior: "smooth" });
});

// ---------- Learn: the current course or book, read at your own pace ----------
// Learn opens at your place in the current course (the Meditations path or a
// tradition) or book. Read as many passages as you like; your place is saved as
// you go, and Learn resumes there until it's done.

// Every date you read on (streaks and the weekly target count them all).
function sessionDates() {
  const dates = [...Object.keys(state.sessions), ...Object.values(state.courses || {}).flatMap((c) => Object.keys(c.sessions || {}))];
  return [...new Set(dates)];
}

function courseProgress(key) {
  state.courses ??= {};
  return (state.courses[key] ??= { completedDay: 0, sessions: {} });
}

// Make a course ("meditations", a tradition id) or a book ("book:<volume>") what Learn reads.
function startCourse(key) {
  state.course = key;
  persist();
  go("learn");
}

const chapterOf = (ref) => (/, ¶/.test(ref) ? ref.replace(/, ¶.*$/, "") : null);

// The reading for Learn: a title and an ordered list of passages with their chapters.
async function currentReading() {
  const key = state.course || "meditations";
  if (key === "meditations") {
    return {
      key, title: "The Meditations", author: "Marcus Aurelius", progress: state.progress,
      items: course.days.map((d) => ({ id: pid(d), chapter: `unit${d.unit}`, label: `Day ${d.day} of ${course.days.length} · ${unitOf(d).title}`, day: d })),
      unitKey: (it) => `${course.id}.${it.day.unit}`, doneKey: course.id,
    };
  }
  await loadIndex();
  if (key.startsWith("book:")) {
    const vol = key.slice(5);
    const meta = metaOf(vol);
    if (!meta) return null;
    await loadVolume(vol);
    const ids = idsOf(vol);
    return {
      key, title: meta.work, author: meta.author, progress: courseProgress(key),
      items: ids.map((id, i) => {
        const ref = library.passages[id].ref;
        const ch = chapterOf(ref);
        return { id, chapter: ch, label: `${meta.author} · ${ch || citeRef(library.passages[id])} · ${i + 1} of ${ids.length}` };
      }),
      unitKey: null, doneKey: `book.${vol}`,
    };
  }
  const t = traditionVolumes().find((x) => x.id === key);
  if (!t) return null;
  const weeks = volIndex.traditions.weeks || [];
  await Promise.all([...new Set(t.days.map((d) => volOf(d.id)))].map((v) => loadVolume(v)));
  return {
    key, title: t.work, author: t.author, progress: courseProgress(key),
    items: t.days.map((d, i) => {
      const w = weeks.find((x) => x.n === d.week);
      return { id: d.id, chapter: `week${d.week}`, label: `${t.author} · Day ${i + 1} of ${t.days.length} · Week ${d.week}: ${w?.theme || ""}`, week: d.week };
    }),
    unitKey: (it) => `${t.id}.w${it.week}`, doneKey: t.id,
  };
}

// The Meditations course's own material for a day, shown in the explainer panel.
function courseNotes(d) {
  return h("div", { class: "course-notes" },
    h("p", { class: "explainer-label" }, "Context"), h("p", {}, d.context),
    h("div", { class: "keyword" }, h("span", { class: "greek" }, d.keyword.greek), h("span", { class: "translit" }, d.keyword.translit), h("div", { class: "gloss" }, d.keyword.gloss)),
    h("p", { class: "explainer-label" }, "Plain-English paraphrase · not Marcus's words"), h("p", {}, d.paraphrase));
}
function applyNotes(d) {
  return h("div", { class: "course-notes" }, h("p", { class: "explainer-label" }, "Carry one into today"),
    Object.entries(d.apply).map(([area, q]) => h("div", { class: "choice" }, h("small", {}, area === "decision" ? "A current decision" : area), q)));
}

async function renderLearn() {
  document.body.classList.add("on-cards");
  const reading = await currentReading();
  if (!reading) { state.course = "meditations"; persist(); return renderLearn(); }
  const { items, progress } = reading;
  const today = dayKey();
  const start = Math.min(progress.completedDay || 0, items.length);
  if (start >= items.length) return reading.key === "meditations" ? renderReview() : renderFinished(reading);

  const deck = h("div", { class: "deck" });
  const tones = ["wisdom", "justice", "courage", "temperance"];
  const io = new IntersectionObserver((es) => es.forEach((en) => en.isIntersecting && en.target.classList.add("in")), { threshold: 0.35 });
  let next = start;

  // reading past a card counts it as read; the first passage read each day records the session
  const markRead = (i) => {
    if (i + 1 <= (progress.completedDay || 0)) return;
    progress.completedDay = i + 1;
    let earned = 0;
    const sessions = reading.key === "meditations" ? state.sessions : (progress.sessions ??= {});
    if (!sessions[today]) {
      sessions[today] = { day: i + 1, mode: "read" };
      earned += award("session");
    } else sessions[today].day = i + 1;
    const it = items[i];
    if (reading.unitKey && items[i + 1]?.chapter !== it.chapter) earned += award("unit", reading.unitKey(it));
    if (i + 1 === items.length) earned += award("course", reading.doneKey);
    persist();
    if (earned) toast(`+${earned} points`);
  };

  const cardFor = (i) => {
    const it = items[i];
    const p = verifiedPassage(library, it.id);
    const bg = { "--card-bg": dusk(it.day?.virtue || tones[i % 4], 160 + (i % 3) * 20) };
    const mark = h("span", { class: "fav-mark" }, state.saved[it.id] ? "✦" : "");
    const qsize = p ? Math.max(19, Math.min(32, 32 - (p.text.length - 120) / 40)) : 24;
    const ask = h("button", { class: "btn", onclick: () => card.explain.open() }, "Explain");
    const actions = h("div", { class: "btn-row" }, ask, compareButton(it.id), cardActions(it.id, mark));
    const card = h("section", { class: "card", style: { ...bg, "--qsize": `${qsize}px` } },
      h("p", { class: "eyebrow" }, i === start && i > 0 ? `Resume · ${it.label}` : it.label),
      h("div", { class: "card-scroll" },
        p ? illuminatedQuote(p.text, it.id)
          : h("p", { class: "lede" }, library.passages[it.id] ? "This passage failed its integrity check, so it isn't shown." : "This passage couldn't be loaded. Check your connection."),
        p && originalText(p),
        p && h("p", { class: "quote-ref" }, citeRef(p), mark, h("small", {}, `${p.author} · tr. ${p.translator}`)),
        p && actions),
      i === start && h("p", { class: "hint" }, "Swipe left to explain · Swipe up for the next · Stop any time, and Learn resumes here"));
    card.dataset.i = String(i);
    if (p) explainPanel(card, it.id, reading.key === "meditations" ? studiedIds(it.day) : [it.id], it.day
      ? { after: () => h("div", {}, courseNotes(it.day), applyNotes(it.day)) } : {});
    return card;
  };

  const endCard = () => h("section", { class: "card end", style: { "--card-bg": "radial-gradient(90% 60% at 50% 100%, #6b4a33 0%, transparent 70%), linear-gradient(180deg, #221d19, #0e0d0c)" } },
    h("p", { class: "eyebrow" }, reading.title),
    h("h2", {}, "The end."),
    h("p", { class: "soft" }, `You've read all ${items.length} passages of ${reading.title}.`),
    h("div", { class: "btn-row", style: { justifyContent: "center" } },
      h("button", { class: "btn primary", onclick: () => renderLearn() }, "Continue"),
      h("button", { class: "btn", onclick: () => go("browse") }, "Choose what's next")));

  const append = (n) => {
    for (let k = 0; k < n && next < items.length; k++, next++) {
      const c = cardFor(next);
      deck.append(c); io.observe(c); seen.observe(c);
    }
    if (next >= items.length && !deck.querySelector(".end")) { const e = endCard(); deck.append(e); io.observe(e); seen.observe(e); }
  };
  // when a card fills the screen, the one before it has been read; keep a few cards ahead
  const seen = new IntersectionObserver((es) => {
    for (const en of es) {
      if (!en.isIntersecting) continue;
      if (en.target.classList.contains("end")) { markRead(items.length - 1); continue; }
      const i = Number(en.target.dataset.i);
      if (i > start) markRead(i - 1);
      if (next - i < 3) append(3);
    }
  }, { threshold: 0.6 });
  append(3);
  deck.addEventListener("scroll", () => {
    const y = deck.scrollTop / deck.clientHeight;
    [...deck.children].forEach((c, k) => c.style.setProperty("--shift", String(Math.max(-1, Math.min(1, k - y)))));
  }, { passive: true });
  view.replaceChildren(deck);
  setTimeout(showInstallBanner, 1500);
}

function renderFinished(reading) {
  const deck = h("div", { class: "deck" });
  const card = h("section", { class: "card end in", style: { "--card-bg": "radial-gradient(90% 60% at 50% 0%, #6b5a33 0%, transparent 70%), linear-gradient(180deg, #221d19, #0e0d0c)" } },
    h("p", { class: "eyebrow" }, `${reading.author} · finished`),
    h("h2", {}, `You've finished ${reading.title}.`),
    h("p", { class: "soft" }, "Choose another course or book, or begin this one again."),
    h("div", { class: "btn-row", style: { justifyContent: "center" } },
      h("button", { class: "btn primary", onclick: () => go("browse") }, "Choose what's next"),
      h("button", { class: "btn", onclick: () => { reading.progress.completedDay = 0; persist(); renderLearn(); } }, "Begin again")));
  deck.append(card);
  view.replaceChildren(deck);
}

// Course 1 ends with a review week: your saved passages, as cards. Then you
// can start the path again.
function renderReview() {
  document.body.classList.add("on-cards");
  const deck = h("div", { class: "deck" });
  const bg = { "--card-bg": "radial-gradient(90% 60% at 50% 0%, #6b5a33 0%, transparent 70%), linear-gradient(180deg, #221d19, #0e0d0c)" };
  const favs = Object.entries(state.saved).filter(([id]) => id.startsWith("meditations."))
    .sort((a, b) => a[1].date.localeCompare(b[1].date)).slice(0, 10)
    .map(([id, sv]) => ({ id, ...verifiedPassage(library, id), comment: sv.comment })).filter((p) => p.text);
  const cards = [
    h("section", { class: "card", style: bg },
      h("p", { class: "eyebrow" }, "Review week"),
      h("h2", {}, `You've finished the Meditations.`),
      h("p", { class: "lede" }, `${course.days.length} days, ${Object.keys(state.sessions).length} ${Object.keys(state.sessions).length === 1 ? "session" : "sessions"}. Swipe through the passages you saved.`)),
    ...favs.map((p, i) => h("section", { class: "card", style: bg },
      h("p", { class: "eyebrow" }, `Saved passage ${i + 1} of ${favs.length}`),
      h("div", { class: "card-scroll", style: { "--qsize": `${Math.max(19, Math.min(30, 30 - (p.text.length - 120) / 40))}px` } }, illuminatedQuote(p.text, p.id),
        h("p", { class: "quote-ref" }, citeRef(p)),
        p.comment && h("p", { class: "soft saved-comment" }, p.comment)))),
    h("section", { class: "card end", style: bg },
      h("p", { class: "eyebrow" }, "What next"),
      h("h2", {}, "Begin again, or wander."),
      h("p", { class: "soft" }, "Repeat the path from day one, or browse the library."),
      h("div", { class: "btn-row", style: { justifyContent: "center" } },
        h("button", { class: "btn primary", onclick: () => {
          if (!confirm("Start the 120-day path again from day 1? Your saved cards and points stay.")) return;
          state.progress.completedDay = 0;
          state.progress.round = (state.progress.round || 1) + 1;
          persist();
          renderLearn();
        } }, "Start again"),
        h("button", { class: "btn", onclick: () => go("browse") }, "Browse the library"))),
  ];
  if (!favs.length) cards.splice(1, 0, h("section", { class: "card", style: bg },
    h("p", { class: "eyebrow" }, "Saved passages"), h("p", { class: "lede" }, "You didn't save any passages this time. Next round, hold a passage card to keep it.")));
  const io = new IntersectionObserver((es) => es.forEach((en) => en.isIntersecting && en.target.classList.add("in")), { threshold: 0.35 });
  cards.forEach((c) => { deck.append(c); io.observe(c); });
  view.replaceChildren(deck);
}

// ---------- sheets ----------

function sheet(...content) {
  const back = h("div", { class: "sheet-backdrop", onclick: (e) => e.target === back && back.remove() });
  back.append(h("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, ...content));
  document.body.append(back);
  return back;
}

function fmtDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Compare: the same theme across traditions ----------
// Compare, don't rank: similarities and differences as each tradition understands itself.

const compareThemes = () => volIndex?.compare?.compare || [];
const compareFor = (id) => compareThemes().filter((c) => c.entries.some((e) => e.id === id));

function compareButton(id) {
  const themes = compareFor(id);
  if (!themes.length) return null;
  return h("button", { class: "btn", onclick: () => compareSheet(themes[0], id) }, "Compare");
}

async function compareSheet(theme, fromId) {
  await Promise.all([...new Set(theme.entries.map((e) => volOf(e.id)))].map((v) => loadVolume(v).catch(() => {})));
  const entry = (e) => {
    const p = verifiedPassage(library, e.id);
    return h("div", { class: "compare-entry" + (e.id === fromId ? " here" : "") },
      h("p", { class: "compare-trad" }, e.tradition, p && h("span", { class: "muted" }, ` · ${citeRef(p)}`)),
      h("p", {}, e.teaching),
      h("p", { class: "compare-diff" }, e.similar),
      p && h("details", {}, h("summary", {}, "Read the passage"),
        h("blockquote", { class: "book-quote" }, p.text, h("cite", {}, `tr. ${p.translator}`)),
        h("button", { class: "btn", onclick: () => { back.remove(); playFrom(e.id); } }, `Read on in ${p.author === "Marcus Aurelius" ? "the Meditations" : p.author}`)));
  };
  const back = sheet(
    h("p", { class: "eyebrow", style: { color: "var(--muted)", margin: 0 } }, "Compare"),
    h("h2", {}, theme.theme),
    h("p", {}, h("strong", {}, "Shared: "), theme.shared),
    h("p", {}, h("strong", {}, "Differs: "), theme.differs),
    theme.entries.map(entry),
    h("p", { class: "muted" }, "Compare, don't rank: each tradition is described as it understands itself, and each contains wide internal variety."),
    h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: () => back.remove() }, "Close")));
}

function principlesSheet() {
  const m = volIndex?.compare?.principles;
  if (!m) return;
  const back = sheet(
    h("p", { class: "eyebrow", style: { color: "var(--muted)", margin: 0 } }, "Reference"),
    h("h2", {}, "Core principles compared"),
    h("p", { class: "muted" }, m.note),
    m.rows.map((r) => h("div", { class: "principle" },
      h("h3", {}, r.question),
      h("dl", {}, m.traditions.flatMap((t, i) => [h("dt", {}, t), h("dd", {}, r.answers[i])])))),
    h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: () => back.remove() }, "Close")));
}

// The day's first card opens with an illuminated initial in the Insular manner
// (knotwork panel), or a geometric star frame on Quran cards. Only the first
// letter is drawn; the text itself is unchanged, and screen readers read it whole.
function illuminatedQuote(text, id) {
  const parts = splitInitial(text);
  if (!parts) return h("blockquote", { class: "quote" }, text); // starts with a number, etc.
  const { lead, letter, sep, rest } = parts;
  const art = h("span", { class: "initial", "aria-hidden": "true" });
  art.innerHTML = initialSVG(letter, { style: volOf(id) === "islam" ? "geometric" : "knot" });
  if (lead) art.append(h("span", { class: "initial-lead" }, lead));
  return h("blockquote", { class: "quote illuminated" }, art, h("span", { class: "sr-only" }, lead + letter + sep), rest);
}

// The original-language text (the Quran's Arabic), shown only when it matches its checksum.
function originalText(p) {
  if (!p.original || sha256(p.original) !== p.originalSha256) return null;
  return h("p", { class: "original", lang: p.originalLang, dir: "rtl" }, p.original);
}

// ---------- Saved: cards you liked, with your comments ----------

const snippet = (t, n = 170) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, "")}…` : t);

// Save and Share buttons for any card; mark is the ✦ next to its reference.
function cardActions(id, mark) {
  const label = () => (state.saved[id] ? "Saved ✦" : "Save");
  const save = h("button", { class: "btn save-btn", onclick: () => saveSheet(id, () => {
    save.textContent = label();
    if (mark) mark.textContent = state.saved[id] ? "✦" : "";
  }) }, label());
  const share = h("button", { class: "btn", onclick: () => shareCard(id) }, "Share");
  return [save, share];
}

// Share sheet (Messages, Mail, …) where the device has one, else copy.
async function shareCard(id) {
  const p = verifiedPassage(library, id);
  if (!p) return;
  const text = `${p.text}\n\n${fullRef(p)} (tr. ${p.translator})`;
  try {
    if (navigator.share) await navigator.share({ text });
    else { await navigator.clipboard.writeText(text); toast("Copied, ready to paste into a message"); }
  } catch {}
}

function saveSheet(id, onChange) {
  const p = verifiedPassage(library, id);
  if (!p) return;
  const was = state.saved[id];
  const note = h("textarea", { placeholder: "Why this one? What does it remind you of? (optional)" }, was?.comment || "");
  const done = (msg) => { persist(); back.remove(); onChange?.(); if (current() === "saved") renderSaved(); toast(msg); };
  const back = sheet(
    h("h2", {}, was ? "Saved card" : "Save this card"),
    h("p", { class: "muted" }, fullRef(p)),
    h("blockquote", { class: "book-quote" }, snippet(p.text, 260)),
    h("label", { class: "field" }, h("span", {}, "Your comment"), note),
    h("div", { class: "btn-row" },
      h("button", { class: "btn primary", onclick: () => {
        state.saved[id] = { date: was?.date || dayKey(), comment: note.value.trim() };
        const pts = was ? 0 : award("favourite", id);
        done(was ? "Comment saved" : pts ? `Saved · +${pts}` : "Saved");
      } }, was ? "Save comment" : "Save"),
      was && h("button", { class: "btn", onclick: () => { delete state.saved[id]; done("Removed from Saved"); } }, "Remove"),
      h("button", { class: "btn", onclick: () => back.remove() }, "Cancel")));
  setTimeout(() => note.focus(), 100);
}

let savedFilter = "all";

async function renderSaved() {
  document.body.classList.remove("on-cards");
  const vols = [...new Set(Object.keys(state.saved).map(volOf))];
  await Promise.all(vols.map((v) => loadVolume(v).catch(() => {})));
  const items = Object.entries(state.saved)
    .map(([id, sv]) => ({ id, ...sv, p: verifiedPassage(library, id) }))
    .filter((x) => x.p)
    .sort((a, b) => b.date.localeCompare(a.date));
  const authors = [...new Set(items.map((x) => x.p.author))];
  const themes = [...new Set(items.flatMap((x) => themesOf(x.id)))];
  const filters = [["all", "All"], ["notes", "With comments"], ...authors.map((a) => [`a:${a}`, a]), ...themes.map((t) => [`t:${t}`, THEMES[t].label])];
  if (!filters.some(([k]) => k === savedFilter)) savedFilter = "all";
  const shown = items.filter((x) =>
    savedFilter === "all" ? true
    : savedFilter === "notes" ? !!x.comment
    : savedFilter.startsWith("a:") ? x.p.author === savedFilter.slice(2)
    : themesOf(x.id).includes(savedFilter.slice(2)));
  view.replaceChildren(h("div", { class: "page" },
    h("p", { class: "eyebrow", style: { color: "var(--muted)" } }, "Saved"),
    h("h1", {}, "Cards you liked"),
    h("p", { class: "sub" }, items.length
      ? `${items.length} saved, stored only on this device. Tap one to read it, change your comment, share it or explain it.`
      : "Nothing saved yet. Tap Save on any card, or hold the day's passage, and add a comment if you like."),
    items.length > 0 && h("div", { class: "btn-row no-print", style: { marginTop: 0, marginBottom: "18px" } },
      h("button", { class: "btn", onclick: () => download(`stoa-saved-${dayKey()}.md`, savedMarkdown(items), "text/markdown") }, "Export Markdown")),
    items.length > 0 && h("div", { class: "filters" }, filters.map(([k, label]) =>
      h("button", { class: "chip", "aria-pressed": String(k === savedFilter), onclick: () => { savedFilter = k; renderSaved(); } }, label))),
    h("div", {}, shown.map((x) => h("button", { class: "entry", onclick: () => savedSheet(x.id) },
      h("div", { class: "when" }, fullRef(x.p)),
      h("div", { class: "snip quote-snip" }, snippet(x.p.text)),
      x.comment ? h("div", { class: "saved-comment" }, x.comment) : h("div", { class: "muted", style: { fontSize: "13px" } }, "No comment yet")))),
    items.length > 0 && !shown.length && h("p", { class: "muted" }, "Nothing under this filter.")));
}

function savedSheet(id) {
  const p = verifiedPassage(library, id);
  const sv = state.saved[id];
  if (!p || !sv) return;
  const note = h("textarea", { placeholder: "Your comment" }, sv.comment || "");
  note.addEventListener("change", () => { sv.comment = note.value.trim(); persist(); toast("Comment saved"); });
  const out = h("div");
  const back = sheet(
    h("p", { class: "muted" }, `Saved ${fmtDate(sv.date)}`),
    h("blockquote", { class: "book-quote" }, p.text, h("cite", {}, `${fullRef(p)} · tr. ${p.translator}`)),
    h("label", { class: "field" }, h("span", {}, "Your comment"), note),
    out,
    h("div", { class: "btn-row" },
      explainButton(id, out, [id], "Explain"),
      h("button", { class: "btn", onclick: () => shareCard(id) }, "Share"),
      h("button", { class: "btn", onclick: () => { back.remove(); playFrom(id); } }, `Read on in ${p.author.split(" ").pop()}`),
      h("button", { class: "btn", onclick: () => {
        if (!confirm("Remove this card and its comment from Saved?")) return;
        delete state.saved[id];
        persist();
        back.remove();
        renderSaved();
      } }, "Remove"),
      h("button", { class: "btn", onclick: () => { sv.comment = note.value.trim(); persist(); back.remove(); renderSaved(); } }, "Done")));
}

// ---------- Consult ----------

function renderConsult() {
  document.body.classList.remove("on-cards");
  const studied = studiedIds();
  const ta = h("textarea", { placeholder: "A hard meeting tomorrow, a decision, a person you're struggling with…" });
  const out = h("div");
  const go_ = h("button", { class: "btn primary", onclick: async () => {
    if (!ta.value.trim()) return;
    go_.disabled = true;
    out.replaceChildren(thinking());
    try {
      const r = await tutor("consult", { situation: ta.value.trim(), studied });
      out.replaceChildren(renderTutor(r.text, r.allowed));
    } catch (err) {
      out.replaceChildren(h("p", { class: "muted" }, err.message));
    }
    go_.disabled = false;
  } }, "Consult my library");
  view.replaceChildren(h("div", { class: "page" },
    h("button", { class: "btn", style: { marginBottom: "14px" }, onclick: () => go("browse") }, "← Browse"),
    h("p", { class: "eyebrow", style: { color: "var(--muted)" } }, "By situation"),
    h("h1", {}, "Consult"),
    h("p", { class: "sub" }, "Describe what's happening. The tutor picks two or three passages you've already studied that bear on it."),
    studied.length
      ? [h("div", { class: "panel" }, h("label", { class: "field" }, h("span", {}, "What's happening?"), ta), go_), out]
      : h("div", { class: "panel" }, h("p", {}, "Finish your first daily session and its passage joins your library. Consult draws only on what you've studied."))));
}

// ---------- You: scoreboard, profile, settings ----------

function renderYou() {
  document.body.classList.remove("on-cards");
  const today = dayKey();
  const pts = totalPoints(state.ledger);
  const rank = rankFor(pts);
  const sessions = sessionDates();
  const s = streak(sessions, today);
  const month = today.slice(0, 7);
  const graceLeft = GRACE_DAYS_PER_MONTH - s.graceDays.filter((d) => d.startsWith(month)).length;
  const meters = virtueMeters(Object.values(state.sessions).map((x) => dayByNum(x.day)?.virtue));
  const maxMeter = Math.max(4, ...Object.values(meters));
  const lowest = VIRTUES.reduce((a, b) => (meters[b] < meters[a] ? b : a));
  const highest = VIRTUES.reduce((a, b) => (meters[b] > meters[a] ? b : a));
  const pct = rank.next ? ((pts - rank.min) / (rank.next.min - rank.min)) * 100 : 100;

  const field = (label, key, multi) => {
    const input = multi ? h("textarea", {}, state.profile[key]) : h("input", { value: state.profile[key] });
    input.addEventListener("change", () => { state.profile[key] = input.value.trim(); persist(); toast("Saved"); });
    return h("label", { class: "field" }, h("span", {}, label), input);
  };
  const themeSel = h("select", {}, ["auto", "light", "dark"].map((t) =>
    h("option", { value: t, selected: state.settings.theme === t }, t === "auto" ? "Automatic (dark after 8pm)" : t[0].toUpperCase() + t.slice(1))));
  themeSel.addEventListener("change", () => { state.settings.theme = themeSel.value; persist(); applyTheme(); });
  const hide = h("input", { type: "checkbox", checked: state.settings.hideNumbers, style: { width: "auto" } });
  hide.addEventListener("change", () => { state.settings.hideNumbers = hide.checked; persist(); applyTheme(); });
  const mixW = h("input", { type: "range", min: 0, max: 100, step: 10, value: mixState().weight, style: { width: "100%" } });
  const mixWLabel = h("span", {}, `Shuffle: ${mixState().weight}% from volumes you've started, ${100 - mixState().weight}% discovery`);
  mixW.addEventListener("input", () => { mixState().weight = Number(mixW.value); mixWLabel.textContent = `Shuffle: ${mixW.value}% from volumes you've started, ${100 - mixW.value}% discovery`; persist(); });
  const token = h("input", { type: "password", value: state.settings.token, placeholder: "Only if your server has one", autocomplete: "off", autocapitalize: "off" });
  token.addEventListener("change", () => { state.settings.token = token.value.trim(); persist(); toast("Saved"); });
  const apiKey = h("input", { type: "password", value: state.settings.apiKey || "", placeholder: "sk-ant-…", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
  apiKey.addEventListener("change", () => { state.settings.apiKey = apiKey.value.trim(); persist(); toast(apiKey.value ? "Key saved on this device" : "Key removed"); });
  const tutorNote = status.claude
    ? `Tutor runs on your server (${status.models?.daily}; Go deeper uses ${status.models?.deep}).`
    : state.settings.apiKey
      ? "Tutor uses your API key (pay per use). Clear the key to go back to your Claude app."
      : "Tutor runs in your Claude app, on your subscription: Stoa copies the prompt, you paste the reply back. No extra cost.";

  view.replaceChildren(h("div", { class: "page" },
    h("p", { class: "eyebrow", style: { color: "var(--muted)" } }, "Scoreboard"),
    h("h1", {}, "Your practice"),
    h("p", { class: "sub" }, "Only you see this. Points come from practice, never from scrolling."),
    h("div", { class: "panel" },
      h("div", { class: "score-head" },
        h("div", {}, h("div", { class: "rank" }, rank.name), h("div", { class: "muted" }, rank.meaning)),
        h("div", { class: "big num" }, pts)),
      h("div", { class: "progress" }, h("i", { style: { width: `${pct}%` } })),
      h("div", { class: "muted" }, rank.next
        ? h("span", { class: "num" }, `${rank.next.min - pts} to ${rank.next.name}`)
        : "The ladder ends here. The Stoics said no one reaches the sage, so there's no rung for it.")),
    h("div", { class: "grid-2" },
      h("div", { class: "panel" }, h("div", { class: "big num" }, s.count), h("div", { class: "muted" }, `Day streak · ${graceLeft} grace ${graceLeft === 1 ? "day" : "days"} left this month`)),
      h("div", { class: "panel" }, h("div", { class: "big num" }, `${weekCount(sessions, today)}/${WEEKLY_TARGET}`), h("div", { class: "muted" }, "Sessions this week"))),
    h("h2", {}, "Four virtues"),
    h("div", { class: "panel" },
      h("div", { class: "meters" }, VIRTUES.map((v) => h("div", { class: "meter" },
        h("span", {}, v), h("div", { class: "progress" }, h("i", { style: { width: `${(meters[v] / maxMeter) * 100}%` } })), h("b", { class: "num" }, meters[v])))),
      h("p", { class: "muted", style: { marginBottom: 0, marginTop: "14px" } },
        meters[highest] === 0 ? "Each day you complete fills the meter of its passage's virtue." : `Heavy on ${highest}, light on ${lowest}.`)),
    h("h2", {}, "How points work"),
    h("div", { class: "panel muted" },
      h("p", { style: { margin: 0 } },
        `First passage read each day ${POINTS.session} · save a card ${POINTS.favourite} (up to 5 a day) · finish a unit ${POINTS.unit} · finish the course ${POINTS.course}. Swipes and time in the app score nothing.`),
      h("p", { style: { marginBottom: 0 } }, "Ranks: ", RANKS.map((r) => `${r.name} ${r.min.toLocaleString()}`).join(" · "))),
    h("h2", {}, "About you"),
    h("div", { class: "panel" },
      h("p", { class: "muted", style: { marginTop: 0 } }, "A short profile the tutor sees when you go deeper or consult. Nothing else is sent."),
      field("Role", "role"),
      field("Current challenges", "challenges", true),
      field("Goals", "goals", true)),
    h("h2", {}, "Settings"),
    h("div", { class: "panel" },
      h("label", { class: "field" }, h("span", {}, "Appearance"), themeSel),
      h("label", { class: "field", style: { display: "flex", gap: "10px", alignItems: "center" } }, hide, "Hide all numbers"),
      h("label", { class: "field" }, mixWLabel, mixW),
      !status.claude && h("label", { class: "field" }, h("span", {}, "Optional: Claude API key, pay per use (leave empty to use your Claude app)"), apiKey),
      status.tokenRequired && h("label", { class: "field" }, h("span", {}, "Access code"), token),
      status.tokenRequired && state.settings.token && h("div", { class: "btn-row", style: { marginTop: 0, marginBottom: "14px" } },
        h("button", { class: "btn", onclick: async () => {
          const link = `${location.origin}${location.pathname}?code=${encodeURIComponent(state.settings.token)}`;
          try {
            if (navigator.share) await navigator.share({ title: "Stoa setup link", url: link });
            else { await navigator.clipboard.writeText(link); toast("Setup link copied"); }
          } catch {}
        } }, "Share setup link to another device")),
      h("p", { class: "muted" }, tutorNote),
      h("div", { class: "btn-row" },
        h("button", { class: "btn", onclick: () => {
          if (!confirm("Delete your saved cards, points and progress from this device? This can't be undone.")) return;
          wipe();
          state = freshState();
          persist();
          toast("Everything deleted");
          renderYou();
        } }, "Delete everything"))),
    h("p", { class: "muted" }, `Texts: ${library.source}. `, h("a", { href: library.sourceUrl, target: "_blank", rel: "noopener" }, "Source"), "."),
    h("p", { class: "muted", style: { fontSize: "12px" } }, `App version ${APP_VERSION.replace("stoa-", "")}. It updates itself whenever you open it.`)));
}


// ---------- Library: Mix and Play ----------
// Outside the daily path, the library works like a music app. Reading here
// scores nothing. A run ends after 20 cards.

const MED = { id: "meditations", author: "Marcus Aurelius", work: "Meditations", translator: "George Long (1862)", why: "The foundation", course: 1 };
let volIndex = null;
const loadedVols = new Set(["meditations"]);
const volIds = {};
const ALONGSIDE = [
  { title: "Man's Search for Meaning", author: "Viktor Frankl" },
  { title: "Thoughts of a Philosophical Fighter Pilot", author: "James Stockdale" },
  { title: "The Book of Five Rings", author: "Miyamoto Musashi" },
];

async function loadIndex() {
  if (!volIndex) {
    const optional = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [lib, trad, cmp] = await Promise.all([
      fetch("data/volumes/index.json").then((r) => r.json()),
      optional("data/traditions.json"),
      optional("data/compare.json"),
    ]);
    volIndex = { ...lib, traditions: trad, compare: cmp };
  }
  return volIndex;
}
const traditionVolumes = () => volIndex?.traditions?.traditions || [];
const allVolumes = () => [{ ...MED, count: idsOf("meditations").length }, ...(volIndex?.volumes || []), ...traditionVolumes()];
const volOf = (id) => id.split(".")[0];
const metaOf = (vol) => allVolumes().find((v) => v.id === vol);
function idsOf(vol) {
  volIds[vol] ??= Object.keys(library.passages).filter((k) => k.startsWith(vol + "."));
  return volIds[vol];
}
async function loadVolume(vol) {
  if (loadedVols.has(vol)) return;
  const [d] = await Promise.all([fetch(`data/volumes/${vol}.json`).then((r) => r.json()), loadExplainers(vol)]);
  Object.assign(library.passages, d.passages);
  loadedVols.add(vol);
  delete volIds[vol];
}
// A subject is a theme, or "traditions" (every card in the Traditions wing).
const subjectLabel = (k) => (k === "traditions" ? "World traditions" : THEMES[k]?.label || k);
const isTradition = (vol) => traditionVolumes().some((t) => t.id === vol);
function subjectsMatch(want) {
  const trad = want.includes("traditions"), themes = want.filter((t) => t !== "traditions");
  return {
    vol: (v) => (trad && isTradition(v)) || themes.some((t) => v === "meditations" || (metaOf(v)?.themes?.[t] || 0) > 0),
    card: (id) => (trad && isTradition(volOf(id))) || themesOf(id).some((t) => themes.includes(t)),
  };
}

function themesOf(id) {
  const p = library.passages[id];
  p.themes ??= tagThemes(p.text);
  return p.themes;
}
const pick = (arr, rnd = Math.random) => arr[Math.floor(rnd() * arr.length)];

function mixState() {
  state.mix ??= { positions: {}, read: {}, weight: 70, run: null };
  return state.mix;
}

// Themes from the cards you've saved most recently, for the Daily Mix.
function dailyThemes() {
  const counts = {};
  const recent = Object.entries(state.saved).sort((a, b) => a[1].date.localeCompare(b[1].date)).slice(-10);
  for (const [id, sv] of recent) {
    const p = library.passages[id];
    if (p) for (const t of tagThemes(`${p.text} ${sv.comment || ""}`)) counts[t] = (counts[t] || 0) + 1;
  }
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t).slice(0, 2);
  return top.length ? top : ["control", "others"];
}

// Picks the next passage for a run.
async function nextPassage(run) {
  const mix = mixState();
  const last = run.ids.at(-1);
  const lastVol = last && volOf(last);
  await loadIndex();
  const vols = allVolumes().map((v) => v.id);
  if (run.mode === "play") {
    await loadVolume(run.vol);
    const ids = idsOf(run.vol);
    const pos = mix.positions[run.vol] || 0;
    mix.positions[run.vol] = pos + 1;
    return ids[pos % ids.length];
  }
  const want = run.mode === "echo" && last ? themesOf(last) : run.themes || [];
  const match = subjectsMatch(want);
  const lastAuthor = lastVol && metaOf(lastVol)?.author;
  // only volumes that hold the chosen subjects (counted in the index, so nothing extra downloads)
  const fit = want.length ? vols.filter(match.vol) : vols;
  // a jukebox: not the last author, and not a book from the last few cards, where possible
  const recent = new Set(run.ids.slice(-4).map(volOf));
  const away = fit.filter((v) => metaOf(v)?.author !== lastAuthor);
  const fresher = away.filter((v) => !recent.has(v));
  const others = fresher.length ? fresher : away.length ? away : fit.length ? fit : vols;
  const started = others.filter((v) => mix.positions[v] || mix.read[v]);
  const fresh = others.filter((v) => !started.includes(v));
  // Echo follows a compare link when the last card has one (e.g. Matthew 6:1–4 to Meditations 5.6)
  if (run.mode === "echo" && last && Math.random() < 0.7) {
    const linked = compareFor(last).flatMap((c) => c.entries.map((e) => e.id))
      .filter((id) => id !== last && !run.ids.includes(id) && volOf(id) !== lastVol);
    if (linked.length) {
      const id = pick(linked);
      await loadVolume(volOf(id));
      return id;
    }
  }
  for (let tries = 0; tries < 8; tries++) {
    // Shuffle weighting: mostly volumes you've started, some discovery
    const pool = started.length && (!fresh.length || Math.random() * 100 < mix.weight) ? started : fresh.length ? fresh : others;
    const vol = pick(pool);
    await loadVolume(vol);
    let ids = idsOf(vol).filter((id) => !run.ids.includes(id));
    if (want.length) ids = ids.filter(match.card);
    else if (Math.random() < 0.8) {
      const themed = ids.filter((id) => themesOf(id).length);
      if (themed.length) ids = themed;
    }
    // Prefer cards whose explainer is already stored in the app
    const explained = ids.filter((id) => explainers[id]);
    if (explained.length) ids = explained;
    if (ids.length) return pick(ids);
  }
  return pick(idsOf("meditations"));
}

async function startRun(mode, opts = {}) {
  const mix = mixState();
  mix.run = { mode, ids: [], i: 0, date: dayKey(), ...opts };
  if (mode === "daily") mix.run.themes = dailyThemes();
  await extendRun();
  await extendRun();
  persist();
  go("cards");
}

// Mix plays at random from the subjects you've picked (none picked: everything).
function mixSubjects() {
  const mix = mixState();
  mix.subjects = (mix.subjects || []).filter((k) => k === "traditions" || THEMES[k]);
  return mix.subjects;
}
function startMix() {
  const subjects = mixSubjects();
  return subjects.length ? startRun("theme", { themes: [...subjects] }) : startRun("shuffle");
}
// How many cards each subject holds, from the index counts (no downloads).
function subjectCounts() {
  const counts = {};
  for (const k of Object.keys(THEMES)) {
    counts[k] = idsOf("meditations").filter((id) => themesOf(id).includes(k)).length
      + allVolumes().reduce((n, v) => n + (v.themes?.[k] || 0), 0);
  }
  counts.traditions = traditionVolumes().reduce((n, t) => n + (t.count || 0), 0);
  return counts;
}

// Mix's subject picker: the Browse tiles. Pick three and Mix starts by itself;
// Everything starts at once; fewer than three can be played from the bar.
const MIX_PICK = 3;
async function renderMixSubjects() {
  hidePlayer();
  document.body.classList.remove("on-cards");
  await loadIndex();
  const chosen = new Set();
  const last = [...mixSubjects()];
  const counts = subjectCounts();
  const keys = [...Object.keys(SUBJECTS), "traditions"];
  const grid = h("div", { class: "subject-grid pick" });
  const summary = h("small", { class: "muted" });
  const buttons = h("div", { class: "btn-row" });
  const run = mixState().run?.date === dayKey() ? mixState().run : null;
  let starting = false;
  const play = (subjects) => {
    if (starting) return;
    starting = true;
    mixState().subjects = subjects;
    mixState().run = null;
    persist();
    startMix();
  };
  const tile = (glyph, label, blurb, n, on, click) =>
    h("button", { class: "subject", "aria-pressed": String(on), disabled: starting && !on, onclick: click },
      h("span", { class: "subject-check", "aria-hidden": "true" }, on ? "✓" : ""),
      h("span", { class: "subject-glyph", "aria-hidden": "true" }, glyph), h("b", {}, label), h("small", {}, blurb),
      n != null && h("small", { class: "subject-count" }, `${n.toLocaleString()} cards`));
  const toggle = (k) => {
    if (starting) return;
    chosen.has(k) ? chosen.delete(k) : chosen.add(k);
    if (chosen.size === MIX_PICK) {
      // the third pick starts the mix, after a beat so the tick shows
      draw(true);
      setTimeout(() => play([...chosen]), 450);
      return;
    }
    draw();
  };
  const draw = (full = false) => {
    grid.replaceChildren(
      tile("✶", "Everything", "The whole library: tap to start now", null, false, () => play([])),
      ...keys.map((k) => {
        const [glyph, blurb] = SUBJECTS[k] || TRADITIONS_TILE;
        return tile(glyph, subjectLabel(k), blurb, counts[k], chosen.has(k), () => toggle(k));
      }));
    const names = [...chosen].map(subjectLabel).join(" · ");
    summary.textContent = full ? `Starting: ${names}` : chosen.size ? `${chosen.size} of ${MIX_PICK}: ${names}` : `Pick ${MIX_PICK} and Mix starts`;
    buttons.replaceChildren(...[
      run && h("button", { class: "btn", onclick: () => go("cards") }, `Resume · card ${Math.min((run.i ?? 0) + 1, MIX_RUN_LENGTH)} of ${MIX_RUN_LENGTH}`),
      !full && chosen.size > 0 && h("button", { class: "btn primary", onclick: () => play([...chosen]) }, `Play ${chosen.size === 1 ? "just this one" : "these two"}`),
      !full && !chosen.size && last.length > 0 && h("button", { class: "btn", onclick: () => play(last) }, `Last mix: ${last.map(subjectLabel).join(" · ")}`),
    ].filter(Boolean));
  };
  draw();
  view.replaceChildren(h("div", { class: "page mix-pick" },
    h("p", { class: "eyebrow", style: { color: "var(--muted)" } }, "Mix"),
    h("h1", {}, `Pick ${MIX_PICK} subjects`),
    h("p", { class: "sub" }, "Mix starts as soon as you pick the third, and plays cards from all three at random, across every author and tradition."),
    grid,
    h("div", { class: "mix-go" }, summary, buttons)));
}

async function extendRun() {
  const run = mixState().run;
  if (!run || run.ids.length >= MIX_RUN_LENGTH) return null;
  const id = await nextPassage(run);
  run.ids.push(id);
  persist();
  return id;
}

function runLabel(run) {
  if (run.mode === "play") return `Play · ${metaOf(run.vol)?.author}`;
  if (run.mode === "shuffle") return "Mix · Everything";
  if (run.mode === "echo") return "Echo";
  if (run.mode === "daily") return `Daily Mix · ${run.themes.map(subjectLabel).join(" + ")}`;
  const names = (run.themes || []).map(subjectLabel);
  return names.length > 2 ? `Mix · ${names[0]} + ${names.length - 1} more` : names.length ? `Mix · ${names.join(" + ")}` : "Mix";
}

function mixCard(id, index, run) {
  const p = verifiedPassage(library, id);
  const vol = volOf(id);
  const bg = { "--card-bg": dusk(["wisdom", "justice", "courage", "temperance"][index % 4], 160 + (index % 3) * 20) };
  if (!p) return h("section", { class: "card", style: bg }, h("p", { class: "lede" }, library.passages[id]
    ? "This passage failed its integrity check, so it isn't shown."
    : "This card couldn't be loaded. Check your connection, then swipe on."));
  const mark = h("span", { class: "fav-mark" }, state.saved[id] ? "✦" : "");
  const ask = h("button", { class: "btn", onclick: () => card.explain.open() }, "Explain");
  const qsize = Math.max(19, Math.min(32, 32 - (p.text.length - 120) / 40));
  const card = h("section", { class: "card", style: { ...bg, "--qsize": `${qsize}px` } },
    h("button", { class: "eyebrow author-link", title: `Play ${p.author}`, onclick: () => playFrom(id) },
      `${p.author} · ${p.work}`, run.mode !== "play" && h("span", { class: "play-hint" }, " ▸ Play")),
    h("div", { class: "card-scroll" },
      illuminatedQuote(p.text, id),
      originalText(p),
      h("p", { class: "quote-ref" }, p.ref, mark, h("small", {}, `tr. ${p.translator}`)),
      themesOf(id).length > 0 && h("div", { class: "card-tags" }, [...themesOf(id)].sort((a, b) => (run.themes?.includes(b) ?? 0) - (run.themes?.includes(a) ?? 0)).slice(0, 3).map((t) =>
        h("button", { class: "tag-link", "aria-pressed": String(run.mode === "theme" && !!run.themes?.includes(t)), onclick: () => themeFrom(id, t) }, `${THEMES[t].label} ▸`))),
      h("div", { class: "btn-row" }, ask, compareButton(id), cardActions(id, mark))),
    index === 0 && h("p", { class: "hint" }, "Swipe left to explain · Swipe up for the next card"));
  explainPanel(card, id, [id]);
  card.dataset.id = id;
  card.dataset.vol = vol;
  return card;
}

// Tap an author on any card: switch into Play for that volume from there.
async function playFrom(id) {
  const vol = volOf(id);
  await loadVolume(vol);
  const mix = mixState();
  mix.positions[vol] = idsOf(vol).indexOf(id) + 1;
  const run = mix.run;
  const keep = run?.ids.includes(id) ? run.ids.slice(0, run.ids.indexOf(id) + 1) : [id];
  mix.run = { mode: "play", vol, ids: keep, i: keep.length - 1, date: dayKey() };
  await extendRun();
  persist();
  go("cards");
  toast(`Playing ${metaOf(vol).author}`);
}

// Tap a subject on any card: carry on through that subject, across authors.
async function themeFrom(id, theme) {
  const mix = mixState();
  const run = mix.run;
  const keep = run?.ids.includes(id) ? run.ids.slice(0, run.ids.indexOf(id) + 1) : [id];
  mix.run = { mode: "theme", themes: [theme], ids: keep, i: keep.length - 1, date: dayKey() };
  await extendRun();
  persist();
  go("cards");
  toast(subjectLabel(theme));
}

async function renderRun(startAt) {
  const mix = mixState();
  const run = mix.run;
  if (!run) return startRun("shuffle");
  document.body.classList.add("on-cards", "with-player");
  // a saved run can span several books; load them all before drawing (after a
  // restart only the Meditations is in memory)
  await Promise.all([...new Set(run.ids.map(volOf))].map((v) => loadVolume(v).catch(() => {})));
  if (mixState().run !== run) return; // replaced while loading
  const deck = h("div", { class: "deck" });
  const io = new IntersectionObserver((es) => es.forEach((en) => en.isIntersecting && en.target.classList.add("in")), { threshold: 0.35 });
  let appending = false;
  const endCard = () => h("section", { class: "card end", style: { "--card-bg": "radial-gradient(90% 60% at 50% 100%, #6b4a33 0%, transparent 70%), linear-gradient(180deg, #221d19, #0e0d0c)" } },
    h("p", { class: "eyebrow" }, `${MIX_RUN_LENGTH} cards`),
    h("h2", {}, "Enough for now."),
    h("p", { class: "soft" }, "That's the end of this run. Come back tomorrow, or pick another way in."),
    h("div", { class: "btn-row", style: { justifyContent: "center" } },
      h("button", { class: "btn", onclick: () => { mix.run = null; persist(); go("browse"); } }, "Browse"),
      h("button", { class: "btn", onclick: () => { mix.run = null; startRun("shuffle"); } }, "New shuffle")));
  const add = (id, i) => {
    const c = mixCard(id, i, run);
    deck.append(c);
    io.observe(c);
    watch.observe(c);
  };
  const watch = new IntersectionObserver(async (es) => {
    for (const en of es) {
      if (!en.isIntersecting) continue;
      const i = [...deck.children].indexOf(en.target);
      run.i = i;
      const vol = en.target.dataset.vol;
      if (vol && !en.target.dataset.counted) {
        en.target.dataset.counted = "1";
        mix.read[vol] = (mix.read[vol] || 0) + 1;
      }
      const title = document.getElementById("player-title");
      if (title && vol) title.textContent = `${metaOf(vol)?.author} · ${metaOf(vol)?.work}`;
      persist();
      // keep one card ahead; stop at the run length
      if (i >= deck.children.length - 2 && !appending) {
        appending = true;
        const id = await extendRun();
        if (id) add(id, run.ids.length - 1);
        else if (!deck.querySelector(".end")) { const e = endCard(); deck.append(e); io.observe(e); }
        appending = false;
      }
    }
  }, { threshold: 0.6 });
  run.ids.forEach((id, i) => add(id, i));
  if (run.ids.length >= MIX_RUN_LENGTH) { const e = endCard(); deck.append(e); io.observe(e); }
  view.replaceChildren(deck);
  showPlayer(run);
  const at = startAt ?? run.i ?? 0;
  if (at) requestAnimationFrame(() => deck.children[at]?.scrollIntoView());
}

function showPlayer(run) {
  let bar = document.getElementById("player");
  if (!bar) {
    bar = h("div", { id: "player", class: "player", role: "toolbar", "aria-label": "Player" });
    document.body.append(bar);
  }
  const deck = () => document.querySelector(".deck");
  const skip = () => { const d = deck(); d?.scrollTo({ top: (Math.round(d.scrollTop / d.clientHeight) + 1) * d.clientHeight, behavior: "smooth" }); };
  bar.replaceChildren(
    h("div", { class: "player-text" }, h("small", {}, runLabel(run)), h("span", { id: "player-title" }, "")),
    h("button", { "aria-label": "Shuffle", title: "Shuffle", class: run.mode === "shuffle" || run.mode === "theme" ? "on" : "", onclick: async () => {
      const r = mixState().run;
      r.ids = r.ids.slice(0, (r.i ?? 0) + 1);
      const subjects = mixSubjects();
      r.mode = subjects.length ? "theme" : "shuffle";
      r.themes = [...subjects];
      delete r.vol;
      await extendRun();
      renderRun(r.ids.length - 2);
    } }, icon("shuffle")),
    h("button", { "aria-label": "Subjects", title: "Subjects", onclick: () => { persist(); go("mix"); } }, icon("subjects")),
    h("button", { "aria-label": "Skip", title: "Skip", onclick: skip }, icon("forward")));
  bar.hidden = false;
}

function hidePlayer() {
  const bar = document.getElementById("player");
  if (bar) bar.hidden = true;
  document.body.classList.remove("with-player");
}

// Ways into the library for Browse and Mix's picker.
const SUBJECTS = {
  leadership: ["♜", "Rulers, generals and anyone in charge"],
  war: ["⚔", "Sun Tzu, Thucydides, Machiavelli and more"],
  control: ["⚖", "What is up to you, and what isn't"],
  others: ["☍", "Friends, anger, forgiveness"],
  duty: ["⚒", "Work, office and doing your part"],
  fame: ["✧", "Praise, reputation and the Metric Cage"],
  death: ["⧗", "Mortality and the shortness of time"],
  simplicity: ["○", "Enough, and wanting less"],
  faith: ["✺", "God, prayer and worship, across the traditions"],
  love: ["♡", "Mercy, charity and loving-kindness"],
  justice: ["§", "Right and wrong, law and dharma"],
  soul: ["◎", "Self, soul, Atman and not-self"],
  stillness: ["◌", "Calm, quiet and meditation"],
  suffering: ["☁", "Pain, grief and adversity"],
};
const TRADITIONS_TILE = ["❖", "Judaism, Christianity, Islam, Hinduism, Buddhism"];
const SHELVES = [
  ["The Stoics", ["meditations", "enchiridion", "discourses", "seneca"]],
  ["Greece and Rome", ["ethics", "epicurus", "onduties", "plutarch", "thucydides", "boethius"]],
  ["Strategy and statecraft", ["artofwar", "prince"]],
  ["The East", ["taoteching", "analects", "dhammapada"]],
  ["Essayists and moralists", ["montaigne", "bacon", "pascal", "rochefoucauld", "moralsentiments", "schopenhauer"]],
  ["Americans", ["franklin", "walden", "emerson"]],
  ["World traditions", ["judaism", "christianity", "islam", "hinduism", "buddhism"]],
];

async function renderBrowse() {
  hidePlayer();
  document.body.classList.remove("on-cards");
  const mix = mixState();
  view.replaceChildren(h("div", { class: "page" }, h("p", { class: "muted" }, "Opening the library…")));
  await loadIndex();
  const run = mix.run && mix.run.date === dayKey() && mix.run.ids.length < MIX_RUN_LENGTH + 1 ? mix.run : null;
  const mode = (label, sub, fn, glyph) => h("button", { class: "mode", onclick: fn }, h("span", { class: "mode-glyph", "aria-hidden": "true" }, glyph), h("span", {}, h("b", {}, label), h("small", {}, sub)));
  const daily = dailyThemes().map((t) => THEMES[t].label).join(" + ");
  const vols = allVolumes();
  const shelved = new Set(SHELVES.flatMap(([, ids]) => ids));
  const shelves = [...SHELVES, ["More", vols.map((v) => v.id).filter((id) => !shelved.has(id))]]
    .map(([name, ids]) => [name, ids.map((id) => vols.find((v) => v.id === id)).filter(Boolean)])
    .filter(([, list]) => list.length);
  const authorRow = (v) => {
    const pos = mix.positions[v.id] || 0;
    const read = state.courses?.[`book:${v.id}`]?.completedDay || 0;
    const reading = state.course === `book:${v.id}`;
    return h("button", { class: "entry", onclick: () => bookSheet(v) },
      h("div", { class: "when" }, `${v.author}${v.year ? ` · ${v.year}` : ""}${reading ? " · reading in Learn" : ""}`),
      h("div", { class: "what" }, v.work),
      h("div", { class: "snip" }, `${v.why}. ${read ? `Read ${read} of ${v.count}` : pos ? `Mixed to ${pos + 1} of ${v.count}` : `${v.count} passages`}.`));
  };
  const key = state.course || "meditations";
  const nowTitle = key === "meditations" ? "Marcus Aurelius · Meditations" : key.startsWith("book:")
    ? (() => { const v = vols.find((x) => `book:${x.id}` === key); return v ? `${v.author} · ${v.work}` : key; })()
    : (() => { const t = traditionVolumes().find((x) => x.id === key); return t ? `${t.author} · ${t.work}` : key; })();
  view.replaceChildren(h("div", { class: "page" },
    h("p", { class: "eyebrow", style: { color: "var(--muted)" } }, "Library"),
    h("h1", {}, "Browse"),
    h("p", { class: "sub" }, `Pick what Learn reads, or what Mix plays. On any card, tap the author to read on in that book, or a subject to follow it across authors. Mix scores nothing, and a run ends after ${MIX_RUN_LENGTH} cards.`),
    h("div", { class: "panel resume" },
      h("div", {}, h("div", { class: "muted" }, "Reading in Learn"), h("b", {}, nowTitle)),
      h("button", { class: "btn primary", onclick: () => go("learn") }, "Read")),
    run && h("div", { class: "panel resume" },
      h("div", {}, h("b", {}, runLabel(run)), h("div", { class: "muted" }, `Card ${Math.min((run.i ?? 0) + 1, run.ids.length)} of ${MIX_RUN_LENGTH}`)),
      h("button", { class: "btn primary", onclick: () => go("cards") }, "Resume")),
    h("h2", {}, "Mix"),
    h("div", { class: "modes" },
      mode("Pick 3 subjects", mixSubjects().length ? `Last mix: ${mixSubjects().map(subjectLabel).join(", ")}` : "Pick three and Mix starts by itself", () => go("mix"), "◈"),
      mode("Shuffle", "Everything, a new author every card", () => { mixState().subjects = []; startRun("shuffle"); }, "⤮"),
      mode("Daily Mix", daily, () => startRun("daily"), "☀"),
      mode("Echo", "Each card links to the last by subject", () => startRun("echo"), "∿")),
    h("h2", {}, "By subject"),
    h("p", { class: "muted" }, "Tap one to play it in Mix, or choose several above."),
    h("div", { class: "subject-grid" }, Object.entries(SUBJECTS).map(([k, [glyph, blurb]]) =>
      h("button", { class: "subject", onclick: () => startRun("theme", { themes: [k] }) },
        h("span", { class: "subject-glyph", "aria-hidden": "true" }, glyph), h("b", {}, THEMES[k].label), h("small", {}, blurb))),
      h("button", { class: "subject", onclick: () => startRun("theme", { themes: ["traditions"] }) },
        h("span", { class: "subject-glyph", "aria-hidden": "true" }, TRADITIONS_TILE[0]), h("b", {}, "World traditions"), h("small", {}, TRADITIONS_TILE[1]))),
    h("h2", {}, "By author"),
    shelves.flatMap(([name, list]) => [h("h3", { class: "shelf" }, name), h("div", {}, list.map(authorRow))]),
    traditionVolumes().length > 0 && [
      h("h2", {}, "World traditions"),
      h("p", { class: "muted" }, `Core passages from ${traditionVolumes().map((t) => t.author).join(", ")}, in four weekly themes: ${(volIndex.traditions.weeks || []).map((w) => w.theme).join(", ")}. Compare, don't rank.`),
      h("h3", { class: "shelf" }, "Courses for Learn"),
      h("div", {}, [{ id: "meditations", author: "Marcus Aurelius", work: "Meditations", days: course.days }, ...traditionVolumes()].map((c) => {
        const prog = c.id === "meditations" ? state.progress : state.courses?.[c.id];
        const current = (state.course || "meditations") === c.id;
        const at = prog?.completedDay || 0;
        return h("button", { class: "entry", onclick: () => startCourse(c.id) },
          h("div", { class: "when" }, `${c.author}${current ? " · reading in Learn" : ""}`),
          h("div", { class: "what" }, `${c.days.length}-passage course: ${c.work}`),
          h("div", { class: "snip" }, current ? `Passage ${Math.min(at + 1, c.days.length)} of ${c.days.length}. Tap to read on.` : at ? `Resume at passage ${at + 1}. Tap to read it in Learn.` : "Tap to read it in Learn, as much or as little as you like."));
      })),
      h("h3", { class: "shelf" }, "Compare"),
      h("div", { class: "filters", style: { flexWrap: "wrap" } },
        compareThemes().map((c) => h("button", { class: "chip", onclick: () => compareSheet(c) }, c.theme)),
        volIndex.compare?.principles && h("button", { class: "chip", onclick: principlesSheet }, "Core principles compared")),
      (volIndex.traditions.pending || []).map((p) => h("p", { class: "muted", style: { fontSize: "13px" } }, `${p.name}: coming. ${p.reason}`)),
    ],
    h("h2", {}, "By situation"),
    h("div", {}, mode("Consult", "Describe what's happening; the tutor picks passages you've studied", () => go("consult"), "⚖")),
    h("h2", {}, "Read alongside"),
    h("p", { class: "muted" }, "Still in copyright, so no quotes: the tutor gives you a summary instead."),
    h("div", {}, ALONGSIDE.map((b) => h("button", { class: "entry", onclick: () => alongsideSheet(b) },
      h("div", { class: "what" }, b.title), h("div", { class: "snip" }, b.author)))),
    h("h2", {}, "Coming to the library"),
    h("p", { class: "muted" }, volIndex.coming.join(" · "))));
}

// An author row: read the book in Learn (it resumes where you stopped) or play it in Mix.
function bookSheet(v) {
  const read = state.courses?.[`book:${v.id}`]?.completedDay || 0;
  const pos = mixState().positions[v.id] || 0;
  const back = sheet(h("p", { class: "eyebrow" }, `${v.author}${v.year ? ` · ${v.year}` : ""}`), h("h2", {}, v.work),
    h("p", { class: "muted" }, `${v.why}. ${v.count} passages.`),
    h("div", { class: "btn-row" },
      h("button", { class: "btn primary", onclick: () => { back.remove(); startCourse(`book:${v.id}`); } },
        read >= v.count ? "Read again in Learn" : read ? `Read in Learn (resume at ${read + 1})` : "Read in Learn"),
      h("button", { class: "btn", onclick: () => { back.remove(); startRun("play", { vol: v.id }); } }, pos ? `Play in Mix from ${pos + 1}` : "Play in Mix"),
      h("button", { class: "btn", onclick: () => back.remove() }, "Close")));
}

function alongsideSheet(book) {
  const out = h("div");
  const back = sheet(h("h2", {}, book.title), h("p", { class: "muted" }, `${book.author}. Summarised by the tutor, never quoted.`), out,
    h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: () => back.remove() }, "Close")));
  out.replaceChildren(thinking());
  tutor("alongside", { book: book.title })
    .then((r) => out.replaceChildren(renderTutor(r.text, [])))
    .catch((err) => out.replaceChildren(h("p", { class: "muted" }, err.message)));
}

// ---------- routing ----------

const ROUTES = {
  learn: renderLearn,
  // the Mix tab always opens its subject picker (with Resume when a run is going)
  mix: renderMixSubjects,
  cards: () => (mixState().run?.date === dayKey() ? renderRun() : startMix()),
  browse: renderBrowse,
  saved: renderSaved,
  consult: renderConsult,
  you: renderYou,
};
const ALIASES = { today: "learn", swipe: "mix", subjects: "mix", journal: "saved" }; // old links
const TAB_OF = { consult: "browse", cards: "mix" };
function current() {
  const t = location.hash.slice(1);
  return ROUTES[t] ? t : ALIASES[t] || "learn";
}
function go(tab) {
  if (location.hash.slice(1) === tab) route();
  else location.hash = tab;
}
function route() {
  const t = current();
  const tab = TAB_OF[t] || t;
  tabs.forEach((b) => (b.dataset.tab === tab ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  if (t !== "learn") document.querySelector(".install")?.remove();
  if (t !== "cards") hidePlayer();
  ROUTES[t]();
  window.scrollTo(0, 0);
}
tabs.forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
window.addEventListener("hashchange", route);
// a new day unlocks the next card; re-render if the app stays open past midnight
let lastDay = dayKey();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  checkForUpdate();
  if (dayKey() !== lastDay) {
    lastDay = dayKey();
    route();
  }
});
route();
statusReady.then(() => current() === "you" && renderYou());

// Force the newest version: on every open, and every time the app comes back
// to the front (a home-screen app resumes rather than reloading), ask the
// server which version is live. If it isn't this one, fetch the new service
// worker, drop the old caches and reload. APP_VERSION must match CACHE in
// sw.js; a test checks it, so bump both together.
let updating = false;
async function checkForUpdate() {
  if (updating || !navigator.onLine) return;
  try {
    const res = await fetch(`sw.js?check=${Date.now()}`, { cache: "no-store" });
    const live = (await res.text()).match(/const CACHE = "([^"]+)"/)?.[1];
    if (!live || live === APP_VERSION) return;
    // one attempt per version, so a stale CDN copy can't loop the reload
    try { if (sessionStorage.getItem("stoa.updatedTo") === live) return; sessionStorage.setItem("stoa.updatedTo", live); } catch {}
    updating = true;
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update().catch(() => {});
    if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    location.reload();
  } catch { /* offline or blocked: keep the version we have */ }
}
checkForUpdate();

if ("serviceWorker" in navigator) {
  // check for a new version on every open, bypassing the browser's cache of sw.js
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((r) => r.update()).catch(() => {});
  // when a new version takes over, reload once so the new tabs and code show
  let reloaded = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (hadController && !reloaded) { reloaded = true; location.reload(); }
  });
}
