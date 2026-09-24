import {
  POINTS, RANKS, VIRTUES, WEEKLY_TARGET, GRACE_DAYS_PER_MONTH, REFLECTION_MIN_WORDS, MIX_RUN_LENGTH, MIX_REFLECTION_DAILY_CAP, sha256,
  dayKey, addDays, wordCount, totalPoints, rankFor, pointsFor, streak, weekCount,
  virtueMeters, todaysDay, verifiedPassage, guardReply, journalMarkdown, citeRef,
} from "./logic.js";
import { load, save, wipe, freshState } from "./store.js";
import { buildRequest, handoffText } from "./prompts.js";
import { callClaude } from "./direct.js";
import { THEMES, tagThemes } from "./themes.js";

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

function recentReflections(excludeId) {
  return state.journal
    .filter((e) => e.reflection && e.id !== excludeId && e.ref)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map((e) => ({ ref: e.ref, reflection: e.reflection }));
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
    part("In plain English", e.meaning), part("Today", e.today), part("For you", e.you));
}

function explainButton(id, out, studied, label) {
  const deeper = h("button", { class: "btn", onclick: async () => {
    deeper.disabled = true;
    const note = h("div");
    out.append(note);
    note.replaceChildren(thinking());
    try {
      const e = explainers[id];
      const r = await tutor("deeper", { passageId: id, studied, explainer: e ? `${e.meaning}\n${e.today}\n${e.you}` : "" });
      note.replaceChildren(h("p", { class: "explainer-label" }, "Deeper"), renderTutor(r.text, r.allowed));
      deeper.remove();
    } catch (err) {
      note.replaceChildren(h("p", { class: "tutor-note" }, err.message));
      deeper.disabled = false;
    }
  } }, handoffMode() ? "Go deeper in Claude" : "Go deeper");
  const btn = h("button", { class: "btn", onclick: async () => {
    btn.disabled = true;
    await loadExplainers(id.split(".")[0]);
    if (explainers[id]) {
      out.replaceChildren(explainerView(id));
      btn.replaceWith(deeper);
      return;
    }
    out.replaceChildren(thinking());
    try {
      const r = await tutor("explain", { passageId: id, studied });
      out.replaceChildren(renderTutor(r.text, r.allowed));
      btn.replaceWith(deeper);
    } catch (err) {
      out.replaceChildren(h("p", { class: "tutor-note" }, err.message));
      btn.disabled = false;
    }
  } }, label);
  return btn;
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
  if (current() === "today") showInstallBanner();
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
  const step = { ArrowDown: 1, PageDown: 1, " ": 1, ArrowUp: -1, PageUp: -1 }[e.key];
  if (!step) return;
  e.preventDefault();
  const i = Math.round(deck.scrollTop / deck.clientHeight) + step;
  deck.scrollTo({ top: i * deck.clientHeight, behavior: "smooth" });
});

// ---------- journal helpers ----------

function entryFor(date, day) {
  let e = state.journal.find((j) => j.date === date && j.day === day.day);
  if (!e) {
    e = {
      id: `${date}-${day.day}`, date, day: day.day, passageId: pid(day), ref: day.ref,
      virtue: day.virtue, theme: day.theme, question: "", reflection: "", response: "",
    };
    state.journal.push(e);
  }
  return e;
}

function pendingCheckin(today) {
  return state.journal
    .filter((e) => e.date < today && e.date >= addDays(today, -2) && e.ref && !e.applied)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
}

// ---------- Today: the daily swipe ----------

function renderToday() {
  const today = dayKey();
  const { day: dayNum, done, finished } = todaysDay(state.progress, state.sessions, today, course.days.length);
  if (finished && !state.sessions[today]) return renderReview();
  const day = dayByNum(dayNum);
  const passage = verifiedPassage(library, pid(day));
  const entry = state.journal.find((j) => j.date === today && j.day === day.day);
  document.body.classList.add("on-cards");

  const deck = h("div", { class: "deck" });
  const cards = [];
  const bg = (angle) => ({ "--card-bg": dusk(day.virtue, angle) });
  let quickRequested = false;

  const next = (el) => {
    const i = cards.indexOf(el);
    cards[i + 1]?.scrollIntoView({ behavior: "smooth" });
  };

  // 0. Next-day check-in (the highest-value action)
  const pending = !done && pendingCheckin(today);
  if (pending) {
    const example = h("textarea", { class: "reflect", style: { minHeight: "18vh" }, placeholder: "Where did it show up? One or two sentences." });
    const card = h("section", { class: "card", style: bg(200) },
      h("p", { class: "eyebrow" }, "Check-in"),
      h("h2", {}, `Did you apply ${pending.ref}?`),
      h("p", { class: "soft" }, pending.question || "Yesterday's passage, in practice."),
      example,
      h("div", { class: "btn-row" },
        h("button", { class: "btn gold", onclick: () => {
          if (wordCount(example.value) < 3) return toast("Add a short example first");
          pending.applied = { yes: true, example: example.value.trim(), date: today };
          const pts = award("checkin", pending.id);
          persist();
          toast(pts ? `Practice beats reading · +${pts}` : "Saved");
          next(card);
        } }, "Yes, here's how"),
        h("button", { class: "btn", onclick: () => {
          pending.applied = { yes: false, date: today };
          persist();
          next(card);
        } }, "Not yet")));
    cards.push(card);
  }

  // 1. Passage
  const fav = () => !!state.favourites[pid(day)];
  const favMark = h("span", { class: "fav-mark" }, fav() ? "✦" : "");
  const qsize = passage ? Math.max(19, Math.min(34, 34 - (passage.text.length - 120) / 40)) : 24;
  const passageCard = h("section", { class: "card", style: { ...bg(180), "--qsize": `${qsize}px` } },
    h("p", { class: "eyebrow" }, `Day ${day.day} of ${course.days.length} · ${unitOf(day).title}`),
    h("div", { class: "card-scroll" },
      passage
        ? h("blockquote", { class: "quote" }, passage.text)
        : h("p", { class: "lede" }, "This passage failed its integrity check, so it isn't shown. Re-run the ingest script."),
      passage && h("p", { class: "quote-ref" }, `${passage.work} ${passage.ref}`, favMark,
        h("small", {}, `Marcus Aurelius · tr. ${passage.translator}`))),
    h("p", { class: "hint" }, "Hold to save · Swipe up"));
  let holdTimer;
  const startHold = (e) => {
    if (e.target.closest("button")) return;
    passageCard.classList.add("holding");
    holdTimer = setTimeout(() => {
      passageCard.classList.remove("holding");
      if (fav()) {
        delete state.favourites[pid(day)];
        favMark.textContent = "";
        toast("Removed from favourites");
      } else {
        state.favourites[pid(day)] = today;
        favMark.textContent = "✦";
        const pts = award("favourite", pid(day));
        toast(pts ? `Saved to favourites · +${pts}` : "Saved to favourites");
      }
      persist();
      navigator.vibrate?.(12);
    }, 650);
  };
  const endHold = () => { clearTimeout(holdTimer); passageCard.classList.remove("holding"); };
  passageCard.addEventListener("pointerdown", startHold);
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => passageCard.addEventListener(ev, endHold));
  passageCard.addEventListener("contextmenu", (e) => e.preventDefault());
  cards.push(passageCard);

  // 2. Context
  cards.push(h("section", { class: "card", style: bg(160) },
    h("p", { class: "eyebrow" }, "Context"),
    h("p", { class: "lede" }, day.context),
    h("div", { class: "keyword" },
      h("span", { class: "greek" }, day.keyword.greek),
      h("span", { class: "translit" }, day.keyword.translit),
      h("div", { class: "gloss" }, day.keyword.gloss))));

  // 3. Explainer (text only, for focus)
  const explainOut = h("div");
  const explainBtn = explainButton(pid(day), explainOut, studiedIds(day), "Longer explanation");
  const explainer = h("section", { class: "card", style: { "--card-bg": "linear-gradient(180deg, #1d1b18, #121110)" } },
    h("p", { class: "eyebrow" }, "Explainer"),
    h("div", { class: "card-scroll" },
      h("span", { class: "label-para" }, "Plain-English paraphrase · not Marcus's words"),
      h("p", { class: "lede" }, day.paraphrase),
      explainOut,
      h("div", { class: "btn-row" }, explainBtn,
        !done && h("button", { class: "btn", onclick: () => {
          quickRequested = true;
          endCard.scrollIntoView({ behavior: "smooth" });
        } }, "Quick mode: finish here"))));
  cards.push(explainer);

  // 4. Apply
  const e0 = entry || null;
  const chosen = { question: e0?.question || "" };
  const choices = Object.entries(day.apply).map(([area, q]) => {
    const btn = h("button", { class: "choice", "aria-pressed": String(chosen.question === q), onclick: () => pick(q, btn) },
      h("small", {}, area === "decision" ? "A current decision" : area), q);
    btn.dataset.area = area;
    return btn;
  });
  const tailored = h("div");
  function pick(q, btn) {
    chosen.question = q;
    applyCard.querySelectorAll(".choice").forEach((b) => b.setAttribute("aria-pressed", String(b === btn)));
    const e = entryFor(today, day);
    e.question = q;
    persist();
    questionEcho.textContent = q;
  }
  const tailorBtn = h("button", { class: "btn", onclick: async () => {
    const area = applyCard.querySelector('.choice[aria-pressed="true"]')?.dataset.area || "work";
    tailorBtn.disabled = true;
    tailored.replaceChildren(thinking());
    try {
      const r = await tutor("ask", { passageId: pid(day), area });
      const btn = h("button", { class: "choice", onclick: () => pick(r.text, btn) }, h("small", {}, "Tailored to you"), r.text);
      tailored.replaceChildren(btn);
      pick(r.text, btn);
    } catch (err) {
      tailored.replaceChildren(h("p", { class: "tutor-note" }, err.message));
    }
    tailorBtn.disabled = false;
  } }, "Tailor to me");
  const applyCard = h("section", { class: "card", style: bg(140) },
    h("p", { class: "eyebrow" }, "Apply"),
    h("div", { class: "card-scroll" }, choices, tailored,
      h("div", { class: "btn-row" }, tailorBtn, h("button", { class: "btn", onclick: () => next(applyCard) }, "Skip"))));
  cards.push(applyCard);

  // 5. Reflect
  const questionEcho = h("p", { class: "soft" }, chosen.question || "What does this passage ask of you today?");
  const ta = h("textarea", { class: "reflect", placeholder: "Write, or tap the mic and speak. A minute or three." });
  ta.value = e0?.reflection || "";
  const counter = h("span", {}, "");
  const updateCount = () => {
    const n = wordCount(ta.value);
    counter.textContent = n >= REFLECTION_MIN_WORDS ? `${n} words` : `${n} / ${REFLECTION_MIN_WORDS} words`;
  };
  updateCount();
  let draftTimer;
  ta.addEventListener("input", () => {
    updateCount();
    clearTimeout(draftTimer);
    draftTimer = setTimeout(() => { entryFor(today, day).reflection = ta.value; persist(); }, 500);
  });
  const mic = dictationButton(ta, updateCount);
  // On this day: what you wrote on this passage last time round
  const lastTime = state.journal
    .filter((j) => j.passageId === pid(day) && j.date < today && wordCount(j.reflection) > 0)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  const reflectCard = h("section", { class: "card", style: bg(120) },
    h("p", { class: "eyebrow" }, "Reflect"),
    lastTime && h("details", { class: "last-time" },
      h("summary", {}, `You wrote on this passage on ${fmtDate(lastTime.date)}`),
      h("p", {}, lastTime.reflection)),
    questionEcho,
    ta,
    h("div", { class: "meta-row" }, counter, mic),
    h("div", { class: "btn-row" }, h("button", { class: "btn primary", onclick: () => {
      const e = entryFor(today, day);
      e.reflection = ta.value.trim();
      if (!e.question) e.question = chosen.question;
      persist();
      if (wordCount(e.reflection) >= REFLECTION_MIN_WORDS) {
        const pts = award("reflection", e.id);
        if (pts) toast(`The real work · +${pts}`);
      }
      ta.blur();
      next(reflectCard);
    } }, "Save reflection")));
  cards.push(reflectCard);

  // 6. Tutor expounds
  const expoundOut = h("div", { class: "card-scroll" });
  const expoundCard = h("section", { class: "card", style: { "--card-bg": "linear-gradient(180deg, #1f1c18, #121110)" } },
    h("p", { class: "eyebrow" }, "The tutor"),
    expoundOut);
  const drawExpound = () => {
    const e = state.journal.find((j) => j.date === today && j.day === day.day);
    expoundOut.replaceChildren();
    if (e?.response) {
      const allowed = [pid(day), ...studiedIds()];
      expoundOut.append(renderTutor(e.response, allowed));
      if (e.replyResponse) {
        expoundOut.append(h("p", { class: "soft" }, h("em", {}, "You: "), e.reply), renderTutor(e.replyResponse, allowed));
        expoundOut.append(h("p", { class: "tutor-note" }, "Saved to your journal."));
      } else {
        const replyTa = h("textarea", { class: "reflect", style: { minHeight: "14vh" }, placeholder: "Reply once more (optional)" });
        const send = h("button", { class: "btn", onclick: async () => {
          if (!replyTa.value.trim()) return;
          send.disabled = true;
          send.replaceChildren(thinking());
          try {
            const r = await tutor("reply", {
              passageId: pid(day), studied: studiedIds(day), reflection: e.reflection, response: e.response, reply: replyTa.value.trim(),
            });
            e.reply = replyTa.value.trim();
            e.replyResponse = r.text;
            persist();
            drawExpound();
          } catch (err) {
            send.disabled = false;
            send.textContent = "Send";
            toast(err.message);
          }
        } }, "Send");
        expoundOut.append(h("p", { class: "tutor-note" }, "Saved to your journal."), replyTa, h("div", { class: "btn-row" }, send));
      }
      return;
    }
    const hasReflection = wordCount(e?.reflection) > 0;
    expoundOut.append(h("p", { class: "lede" }, hasReflection
      ? "The tutor has read the passage with you, and will respond to what you wrote."
      : "Write a reflection on the card above and the tutor will respond to it."));
    if (!hasReflection) return;
    const out = h("div");
    const ask = (deeper) => async () => {
      row.remove();
      out.replaceChildren(thinking());
      try {
        const r = await tutor("expound", {
          passageId: pid(day), studied: studiedIds(day), deeper,
          reflection: e.reflection, question: e.question, recent: recentReflections(e.id),
        });
        e.response = r.text;
        persist();
        drawExpound();
      } catch (err) {
        out.replaceChildren(h("p", { class: "tutor-note" }, `${err.message} Your reflection is saved to your journal.`));
        expoundOut.append(row);
      }
    };
    const row = h("div", { class: "btn-row" },
      h("button", { class: "btn primary", onclick: ask(false) }, handoffMode() ? "Ask the tutor in Claude" : "Hear from the tutor"),
      !handoffMode() && h("button", { class: "btn", onclick: ask(true), title: "Uses a larger model; for long reflections" }, "Go deeper"));
    expoundOut.append(out, row);
  };
  drawExpound();
  // refresh when arriving from the reflect card
  new IntersectionObserver((es) => es[0].isIntersecting && drawExpound(), { threshold: 0.6 }).observe(expoundCard);
  cards.push(expoundCard);

  // End card
  const endStats = h("div", { class: "stats" });
  const endMsg = h("p", { class: "soft" });
  const endCard = h("section", { class: "card end", style: { "--card-bg": "radial-gradient(90% 60% at 50% 100%, #6b4a33 0%, transparent 70%), linear-gradient(180deg, #221d19, #0e0d0c)" } },
    h("p", { class: "eyebrow" }, "Session complete"),
    h("h2", {}, "Done for today."),
    endStats,
    endMsg,
    h("div", { class: "btn-row", style: { justifyContent: "center" } },
      h("button", { class: "btn", onclick: () => eveningSheet() }, state.evenings[today] ? "Evening review ✓" : "Evening review"),
      h("button", { class: "btn", onclick: () => go("journal") }, "Journal")));
  const drawEnd = (earned) => {
    const sessions = Object.keys(state.sessions);
    const s = streak(sessions, today);
    endStats.replaceChildren(
      h("div", { class: "stat" }, h("b", { class: `num ${earned ? "shimmer" : ""}` }, totalPoints(state.ledger)), h("span", {}, "Points")),
      h("div", { class: "stat" }, h("b", { class: "num" }, s.count), h("span", {}, "Day streak")),
      h("div", { class: "stat" }, h("b", { class: "num" }, `${weekCount(sessions, today)}/${WEEKLY_TARGET}`), h("span", {}, "This week")));
    const nextDay = dayByNum(state.progress.completedDay + 1);
    endMsg.textContent = nextDay
      ? `Tomorrow: day ${nextDay.day}, ${unitOf(nextDay).title.toLowerCase()}. Nothing more to see today.`
      : "That was the last day of the Meditations. Tomorrow: your review week.";
  };
  drawEnd(false);
  new IntersectionObserver((es) => {
    if (!es[0].isIntersecting) return;
    const earned = completeSession(day, quickRequested && !state.sessions[today] ? "quick" : "full");
    drawEnd(earned > 0);
    if (earned > 0) toast(`+${earned} points`);
  }, { threshold: 0.7 }).observe(endCard);
  cards.push(endCard);

  // entrance motion + gentle parallax
  const io = new IntersectionObserver((es) => es.forEach((en) => en.isIntersecting && en.target.classList.add("in")), { threshold: 0.35 });
  cards.forEach((c) => { deck.append(c); io.observe(c); });
  deck.addEventListener("scroll", () => {
    const y = deck.scrollTop / deck.clientHeight;
    cards.forEach((c, i) => c.style.setProperty("--shift", String(Math.max(-1, Math.min(1, i - y)))));
  }, { passive: true });
  view.replaceChildren(deck);
  setTimeout(showInstallBanner, 1500);
  if (done && !finished) toast("Done for today. Revisiting.");
}

// Course 1 ends with a review week: your saved passages and your own best
// reflections, as cards. Then you can start the path again.
function renderReview() {
  document.body.classList.add("on-cards");
  const deck = h("div", { class: "deck" });
  const bg = { "--card-bg": "radial-gradient(90% 60% at 50% 0%, #6b5a33 0%, transparent 70%), linear-gradient(180deg, #221d19, #0e0d0c)" };
  const favs = Object.entries(state.favourites).sort((a, b) => a[1].localeCompare(b[1])).slice(0, 10)
    .map(([id]) => verifiedPassage(library, id)).filter(Boolean);
  const best = state.journal.filter((e) => e.ref && wordCount(e.reflection) >= REFLECTION_MIN_WORDS)
    .sort((a, b) => wordCount(b.reflection) - wordCount(a.reflection)).slice(0, 5);
  const cards = [
    h("section", { class: "card", style: bg },
      h("p", { class: "eyebrow" }, "Review week"),
      h("h2", {}, `You've finished the Meditations.`),
      h("p", { class: "lede" }, `${course.days.length} days, ${Object.keys(state.sessions).length} ${Object.keys(state.sessions).length === 1 ? "session" : "sessions"}. Swipe through the passages you saved and the best of what you wrote.`)),
    ...favs.map((p, i) => h("section", { class: "card", style: bg },
      h("p", { class: "eyebrow" }, `Saved passage ${i + 1} of ${favs.length}`),
      h("div", { class: "card-scroll" }, h("blockquote", { class: "quote", style: { "--qsize": `${Math.max(19, Math.min(30, 30 - (p.text.length - 120) / 40))}px` } }, p.text),
        h("p", { class: "quote-ref" }, citeRef(p))))),
    ...best.map((e) => h("section", { class: "card", style: bg },
      h("p", { class: "eyebrow" }, `You wrote · ${fmtDate(e.date)} · on ${e.ref}`),
      h("div", { class: "card-scroll" }, h("p", { class: "lede", style: { whiteSpace: "pre-wrap" } }, e.reflection)))),
    h("section", { class: "card end", style: bg },
      h("p", { class: "eyebrow" }, "What next"),
      h("h2", {}, "Begin again, or wander."),
      h("p", { class: "soft" }, "Repeat the path from day one; your journal stays, so you'll see what you wrote last time. Or explore the library in Mix."),
      h("div", { class: "btn-row", style: { justifyContent: "center" } },
        h("button", { class: "btn primary", onclick: () => {
          if (!confirm("Start the 120-day path again from day 1? Your journal and points stay.")) return;
          state.progress.completedDay = 0;
          state.progress.round = (state.progress.round || 1) + 1;
          persist();
          renderToday();
        } }, "Start again"),
        h("button", { class: "btn", onclick: () => go("journal") }, "Journal"))),
  ];
  if (!favs.length) cards.splice(1, 0, h("section", { class: "card", style: bg },
    h("p", { class: "eyebrow" }, "Saved passages"), h("p", { class: "lede" }, "You didn't save any passages this time. Next round, hold a passage card to keep it.")));
  const io = new IntersectionObserver((es) => es.forEach((en) => en.isIntersecting && en.target.classList.add("in")), { threshold: 0.35 });
  cards.forEach((c) => { deck.append(c); io.observe(c); });
  view.replaceChildren(deck);
}

// Records the day's session; returns points earned now.
function completeSession(day, mode) {
  const today = dayKey();
  const existing = state.sessions[today];
  if (existing && (existing.mode === "full" || mode === "quick")) return 0;
  let earned = award(mode === "quick" ? "quick" : "session");
  state.sessions[today] = { day: day.day, mode };
  const e = entryFor(today, day);
  e.mode = mode;
  if (day.day > state.progress.completedDay) {
    state.progress.completedDay = day.day;
    const unitDays = course.days.filter((d) => d.unit === day.unit);
    if (unitDays[unitDays.length - 1].day === day.day) earned += award("unit", `${course.id}.${day.unit}`);
    if (day.day === course.days.length) earned += award("course", course.id);
  }
  persist();
  return earned;
}

// ---------- voice dictation (where the browser supports it) ----------

function dictationButton(textarea, onChange) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return h("span");
  let rec = null;
  const btn = h("button", { class: "mic", "aria-label": "Dictate", onclick: () => {
    if (rec) return rec.stop();
    rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = navigator.language || "en-GB";
    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) {
          const sep = textarea.value && !/\s$/.test(textarea.value) ? " " : "";
          textarea.value += sep + ev.results[i][0].transcript.trim();
        }
      }
      textarea.dispatchEvent(new Event("input"));
      onChange();
    };
    rec.onend = () => { rec = null; btn.classList.remove("live"); };
    rec.onerror = () => toast("Dictation stopped");
    rec.start();
    btn.classList.add("live");
  } }, "🎙");
  return btn;
}

// ---------- evening review (Seneca's three questions) ----------

function sheet(...content) {
  const back = h("div", { class: "sheet-backdrop", onclick: (e) => e.target === back && back.remove() });
  back.append(h("div", { class: "sheet", role: "dialog", "aria-modal": "true" }, ...content));
  document.body.append(back);
  return back;
}

function eveningSheet() {
  const today = dayKey();
  const prev = state.evenings[today] || {};
  const f = (label, key) => {
    const t = h("textarea", {}, prev[key] || "");
    return [h("label", { class: "field" }, h("span", {}, label), t), t];
  };
  const [l1, well] = f("What did I do well today?", "well");
  const [l2, badly] = f("What did I do badly?", "badly");
  const [l3, undone] = f("What did I leave undone?", "undone");
  const back = sheet(
    h("h2", {}, "Evening review"),
    h("p", { class: "muted" }, "Seneca's three questions, to close the day."),
    l1, l2, l3,
    h("div", { class: "btn-row" },
      h("button", { class: "btn primary", onclick: () => {
        if (!well.value.trim() && !badly.value.trim() && !undone.value.trim()) return toast("Answer at least one");
        state.evenings[today] = { well: well.value.trim(), badly: badly.value.trim(), undone: undone.value.trim() };
        const pts = award("evening");
        persist();
        back.remove();
        toast(pts ? `Loop closed · +${pts}` : "Saved");
        route();
      } }, "Save"),
      h("button", { class: "btn", onclick: () => back.remove() }, "Cancel")));
}

// ---------- Journal ----------

let journalFilter = "all";

function allEntries() {
  const byDate = new Map();
  const list = state.journal
    .filter((e) => e.reflection || e.response || e.mode || e.applied || e.situation)
    .map((e) => ({ ...e }));
  for (const e of list) if (!byDate.has(e.date)) byDate.set(e.date, e);
  for (const [date, ev] of Object.entries(state.evenings)) {
    if (byDate.has(date)) byDate.get(date).evening = ev;
    else list.push({ id: `evening-${date}`, date, title: "Evening review", evening: ev });
  }
  return list.sort((a, b) => b.date.localeCompare(a.date));
}

function renderJournal() {
  document.body.classList.remove("on-cards");
  const entries = allEntries();
  const themes = [...new Set(entries.map((e) => e.theme).filter(Boolean))];
  const filters = ["all", "favourites", ...VIRTUES, ...themes];
  const shown = entries.filter((e) =>
    journalFilter === "all" ? true
    : journalFilter === "favourites" ? state.favourites[e.passageId]
    : e.virtue === journalFilter || e.theme === journalFilter);

  const list = h("div");
  if (!shown.length) list.append(h("p", { class: "muted" }, entries.length ? "Nothing under this filter yet." : "Your journal fills one entry per session. Over time it becomes your own Meditations."));
  for (const e of shown) {
    const p = e.passage || (e.passageId && library.passages[e.passageId]);
    list.append(h("button", { class: "entry", onclick: () => entrySheet(e) },
      h("div", { class: "when" }, fmtDate(e.date)),
      h("div", { class: "what" }, p ? citeRef(p) : e.title || "Entry", state.favourites[e.passageId] ? h("span", { class: "fav-mark" }, "✦") : null),
      h("div", { class: "snip" }, e.reflection || e.situation || (e.evening && e.evening.well) || "Read, no reflection written."),
      h("div", {}, e.virtue && h("span", { class: "tag" }, e.virtue), e.theme && h("span", { class: "tag" }, e.theme),
        e.applied?.yes && h("span", { class: "tag" }, "applied"))));
  }

  const past = course.days.filter((d) => d.day <= state.progress.completedDay);
  view.replaceChildren(h("div", { class: "page" },
    h("p", { class: "eyebrow", style: { color: "var(--muted)" } }, "Journal"),
    h("h1", {}, "My Meditations"),
    h("p", { class: "sub" }, `${entries.length} ${entries.length === 1 ? "entry" : "entries"}, stored only on this device.`),
    h("div", { class: "btn-row no-print", style: { marginTop: 0, marginBottom: "18px" } },
      h("button", { class: "btn", onclick: exportMarkdown }, "Export Markdown"),
      h("button", { class: "btn", onclick: printBook }, "Export PDF"),
      h("button", { class: "btn", onclick: eveningSheet }, "Evening review")),
    h("div", { class: "filters no-print" }, filters.map((f) =>
      h("button", { class: "chip", "aria-pressed": String(f === journalFilter), onclick: () => { journalFilter = f; renderJournal(); } }, f))),
    list,
    past.length ? h("h2", {}, "Past cards") : null,
    past.length ? h("p", { class: "muted" }, "Revisit any day you've studied. The path itself only moves forward one day at a time.") : null,
    h("div", { class: "filters", style: { flexWrap: "wrap" } }, past.map((d) =>
      h("button", { class: "chip", onclick: () => pastSheet(d) }, `${d.day} · ${d.ref}`)))));
}

function fmtDate(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function passageQuote(id, entry) {
  const snap = entry?.passage;
  const p = snap && sha256(snap.text) === snap.sha256 ? snap : verifiedPassage(library, id);
  return p ? h("blockquote", { class: "book-quote" }, p.text, h("cite", {}, `${citeRef(p)} · tr. ${p.translator}`)) : null;
}

function entrySheet(e) {
  const allowed = [e.passageId, ...studiedIds(), ...(e.allowed || [])].filter(Boolean);
  const real = state.journal.find((j) => j.id === e.id);
  const back = sheet(
    h("p", { class: "muted" }, fmtDate(e.date)),
    e.passageId ? passageQuote(e.passageId, e) : h("h2", {}, e.title || "Entry"),
    e.situation && [h("h3", {}, "The situation"), h("p", { class: "prose" }, e.situation)],
    e.question && h("p", { class: "muted" }, e.question),
    e.reflection && [h("h3", {}, "My reflection"), h("p", { class: "prose" }, e.reflection)],
    e.response && [h("h3", {}, "The tutor"), renderTutor(e.response, allowed)],
    e.reply && [h("h3", {}, "My reply"), h("p", { class: "prose" }, e.reply)],
    e.replyResponse && renderTutor(e.replyResponse, allowed),
    e.applied && h("p", {}, h("strong", {}, "Applied it? "), e.applied.yes ? `Yes. ${e.applied.example || ""}` : "Not yet."),
    e.evening && [h("h3", {}, "Evening review"),
      h("p", { class: "prose" }, `Done well: ${e.evening.well || "—"}\nDone badly: ${e.evening.badly || "—"}\nLeft undone: ${e.evening.undone || "—"}`)],
    h("div", { class: "btn-row" },
      h("button", { class: "btn", onclick: () => back.remove() }, "Close"),
      h("button", { class: "btn", onclick: () => {
        if (!confirm("Delete this entry? This can't be undone.")) return;
        if (real) state.journal = state.journal.filter((j) => j !== real);
        if (e.evening) delete state.evenings[e.date];
        persist();
        back.remove();
        renderJournal();
      } }, "Delete entry")));
}

function pastSheet(d) {
  const back = sheet(
    h("p", { class: "muted" }, `Day ${d.day} · ${unitOf(d).title}`),
    passageQuote(pid(d)),
    h("h3", {}, "Context"), h("p", {}, d.context),
    h("h3", {}, "Plain-English paraphrase"), h("p", { class: "prose" }, d.paraphrase),
    h("div", { class: "btn-row" }, h("button", { class: "btn", onclick: () => back.remove() }, "Close")));
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportMarkdown() {
  download(`stoa-journal-${dayKey()}.md`, journalMarkdown(allEntries(), library), "text/markdown");
}

function printBook() {
  const entries = allEntries().reverse();
  const book = h("div", { class: "page" },
    h("h1", {}, "My Meditations"), h("p", { class: "sub" }, "A journal kept with Stoa"),
    entries.map((e) => h("div", { class: "entry-print" },
      h("h2", {}, fmtDate(e.date)),
      e.passageId && passageQuote(e.passageId, e),
      e.reflection && h("p", { class: "prose" }, e.reflection),
      e.response && renderTutor(e.response, [e.passageId, ...studiedIds()]),
      e.evening && h("p", { class: "prose" }, `Done well: ${e.evening.well}\nDone badly: ${e.evening.badly}\nLeft undone: ${e.evening.undone}`))));
  view.replaceChildren(book);
  setTimeout(() => { window.print(); renderJournal(); }, 200);
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
      out.replaceChildren(renderTutor(r.text, r.allowed), h("div", { class: "btn-row" },
        h("button", { class: "btn", onclick: (ev) => {
          state.journal.push({ id: `consult-${Date.now()}`, date: dayKey(), title: "Consult", situation: ta.value.trim(), response: r.text, allowed: r.allowed });
          persist();
          ev.target.disabled = true;
          ev.target.textContent = "Saved to journal";
        } }, "Save to journal")));
    } catch (err) {
      out.replaceChildren(h("p", { class: "muted" }, err.message));
    }
    go_.disabled = false;
  } }, "Consult my library");
  view.replaceChildren(h("div", { class: "page" },
    h("p", { class: "eyebrow", style: { color: "var(--muted)" } }, "Situation mode"),
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
  const sessions = Object.keys(state.sessions);
  const s = streak(sessions, today);
  const month = today.slice(0, 7);
  const graceLeft = GRACE_DAYS_PER_MONTH - s.graceDays.filter((d) => d.startsWith(month)).length;
  const meters = virtueMeters(state.journal);
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
        meters[highest] === 0 ? "Each reflection fills the meter of its passage's virtue." : `Heavy on ${highest}, light on ${lowest}.`)),
    h("h2", {}, "How points work"),
    h("div", { class: "panel muted" },
      h("p", { style: { margin: 0 } },
        `Daily session ${POINTS.session} · quick mode ${POINTS.quick} · reflection of ${REFLECTION_MIN_WORDS}+ words ${POINTS.reflection} · next-day check-in ${POINTS.checkin} · evening review ${POINTS.evening} · favourite ${POINTS.favourite} (up to 5 a day) · finish a unit ${POINTS.unit} · finish the course ${POINTS.course}. Swipes, time in app and extra words score nothing.`),
      h("p", { style: { marginBottom: 0 } }, "Ranks: ", RANKS.map((r) => `${r.name} ${r.min.toLocaleString()}`).join(" · "))),
    h("h2", {}, "About you"),
    h("div", { class: "panel" },
      h("p", { class: "muted", style: { marginTop: 0 } }, "A short profile the tutor sees, with your last five reflections. Nothing else is sent."),
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
        h("button", { class: "btn", onclick: exportMarkdown }, "Export journal"),
        h("button", { class: "btn", onclick: () => {
          if (!confirm("Delete your whole journal, points and progress from this device? This can't be undone.")) return;
          wipe();
          state = freshState();
          persist();
          toast("Everything deleted");
          renderYou();
        } }, "Delete everything"))),
    h("p", { class: "muted" }, `Texts: ${library.source}. `, h("a", { href: library.sourceUrl, target: "_blank", rel: "noopener" }, "Source"), ".")));
}


// ---------- Library: Mix and Play ----------
// Outside the daily path, the library works like a music app. Reading here
// scores nothing; reflecting on a card scores 10, up to 3 a day. A run ends
// after 20 cards.

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
  volIndex ??= await fetch("data/volumes/index.json").then((r) => r.json());
  return volIndex;
}
const allVolumes = () => [{ ...MED, count: idsOf("meditations").length }, ...(volIndex?.volumes || [])];
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

// Themes from recent reflections, for the Daily Mix.
function dailyThemes() {
  const counts = {};
  for (const e of state.journal.filter((j) => j.reflection).slice(-10)) {
    const p = e.passage || library.passages[e.passageId];
    for (const t of tagThemes(`${e.reflection} ${p?.text || ""}`)) counts[t] = (counts[t] || 0) + 1;
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
  const lastAuthor = lastVol && metaOf(lastVol)?.author;
  const others = vols.filter((v) => metaOf(v)?.author !== lastAuthor);
  const started = others.filter((v) => mix.positions[v] || mix.read[v]);
  const fresh = others.filter((v) => !started.includes(v));
  const want = run.mode === "echo" && last ? themesOf(last) : run.themes || [];
  for (let tries = 0; tries < 8; tries++) {
    // Shuffle weighting: mostly volumes you've started, some discovery
    const pool = started.length && (!fresh.length || Math.random() * 100 < mix.weight) ? started : fresh.length ? fresh : others;
    const vol = pick(pool);
    await loadVolume(vol);
    let ids = idsOf(vol).filter((id) => !run.ids.includes(id));
    if (want.length) ids = ids.filter((id) => themesOf(id).some((t) => want.includes(t)));
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
  renderRun();
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
  if (run.mode === "shuffle") return "Shuffle";
  if (run.mode === "echo") return "Echo";
  if (run.mode === "daily") return `Daily Mix · ${run.themes.map((t) => THEMES[t].label).join(" + ")}`;
  return THEMES[run.themes?.[0]]?.label || "Mix";
}

function mixReflectSheet(id) {
  const p = library.passages[id];
  const ta = h("textarea", { placeholder: "What does this say to you today?" });
  const back = sheet(
    h("h2", {}, "Reflect"),
    h("p", { class: "muted" }, `${p.author}, ${p.ref}. Reflecting here scores ${POINTS.mixReflection}, up to ${MIX_REFLECTION_DAILY_CAP} a day.`),
    h("label", { class: "field" }, ta),
    h("div", { class: "btn-row" },
      h("button", { class: "btn primary", onclick: () => {
        if (!ta.value.trim()) return toast("Write something first");
        const e = {
          id: `mix-${Date.now()}`, date: dayKey(), kind: "mix", title: "Mix", passageId: id, ref: p.ref,
          passage: { work: p.work, author: p.author, translator: p.translator, ref: p.ref, text: p.text, sha256: p.sha256 },
          theme: themesOf(id)[0], reflection: ta.value.trim(),
        };
        state.journal.push(e);
        const pts = award("mixReflection", e.id);
        persist();
        back.remove();
        toast(pts ? `Saved to your journal · +${pts}` : "Saved to your journal");
      } }, "Save"),
      h("button", { class: "btn", onclick: () => back.remove() }, "Cancel")));
  setTimeout(() => ta.focus(), 100);
}

function mixCard(id, index, run) {
  const p = verifiedPassage(library, id);
  const vol = volOf(id);
  const bg = { "--card-bg": dusk(["wisdom", "justice", "courage", "temperance"][index % 4], 160 + (index % 3) * 20) };
  if (!p) return h("section", { class: "card", style: bg }, h("p", { class: "lede" }, "This passage failed its integrity check, so it isn't shown."));
  const out = h("div");
  const ask = explainButton(id, out, [id], "Explain");
  const qsize = Math.max(19, Math.min(32, 32 - (p.text.length - 120) / 40));
  const card = h("section", { class: "card", style: { ...bg, "--qsize": `${qsize}px` } },
    h("button", { class: "eyebrow author-link", title: `Play ${p.author}`, onclick: () => playFrom(id) },
      `${p.author} · ${p.work}`, run.mode !== "play" && h("span", { class: "play-hint" }, " ▸ Play")),
    h("div", { class: "card-scroll" },
      h("blockquote", { class: "quote" }, p.text),
      h("p", { class: "quote-ref" }, p.ref, state.favourites[id] ? h("span", { class: "fav-mark" }, "✦") : null, h("small", {}, `tr. ${p.translator}`)),
      out,
      h("div", { class: "btn-row" },
        h("button", { class: "btn", onclick: () => mixReflectSheet(id) }, "Reflect"),
        ask,
        h("button", { class: "btn", onclick: (ev) => {
          if (state.favourites[id]) delete state.favourites[id];
          else state.favourites[id] = dayKey();
          persist();
          ev.target.textContent = state.favourites[id] ? "Saved ✦" : "Save";
        } }, state.favourites[id] ? "Saved ✦" : "Save"))));
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
  const keep = run ? run.ids.slice(0, run.ids.indexOf(id) + 1) : [id];
  mix.run = { mode: "play", vol, ids: keep, i: keep.length - 1, date: dayKey() };
  await extendRun();
  persist();
  renderRun(keep.length - 1);
  toast(`Playing ${metaOf(vol).author}`);
}

function renderRun(startAt) {
  const mix = mixState();
  const run = mix.run;
  if (!run) return renderMix();
  document.body.classList.add("on-cards", "with-player");
  const deck = h("div", { class: "deck" });
  const io = new IntersectionObserver((es) => es.forEach((en) => en.isIntersecting && en.target.classList.add("in")), { threshold: 0.35 });
  let appending = false;
  const endCard = () => h("section", { class: "card end", style: { "--card-bg": "radial-gradient(90% 60% at 50% 100%, #6b4a33 0%, transparent 70%), linear-gradient(180deg, #221d19, #0e0d0c)" } },
    h("p", { class: "eyebrow" }, `${MIX_RUN_LENGTH} cards`),
    h("h2", {}, "Enough for now."),
    h("p", { class: "soft" }, "That's the end of this run. Reflect on one of them in your journal, or come back tomorrow."),
    h("div", { class: "btn-row", style: { justifyContent: "center" } },
      h("button", { class: "btn", onclick: () => { mix.run = null; persist(); renderMix(); } }, "Back to the library"),
      h("button", { class: "btn", onclick: () => go("journal") }, "Journal")));
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
    h("button", { "aria-label": "Shuffle", title: "Shuffle", class: run.mode === "shuffle" ? "on" : "", onclick: async () => {
      const r = mixState().run;
      r.ids = r.ids.slice(0, (r.i ?? 0) + 1);
      r.mode = "shuffle";
      delete r.vol;
      await extendRun();
      renderRun(r.ids.length - 2);
    } }, "⤮"),
    h("button", { "aria-label": "Pause", title: "Pause", onclick: () => { persist(); renderMix(); } }, "❚❚"),
    h("button", { "aria-label": "Skip", title: "Skip", onclick: skip }, "⏭"));
  bar.hidden = false;
}

function hidePlayer() {
  const bar = document.getElementById("player");
  if (bar) bar.hidden = true;
  document.body.classList.remove("with-player");
}

async function renderMix() {
  hidePlayer();
  document.body.classList.remove("on-cards");
  const mix = mixState();
  view.replaceChildren(h("div", { class: "page" }, h("p", { class: "muted" }, "Opening the library…")));
  await loadIndex();
  const run = mix.run && mix.run.date === dayKey() && mix.run.ids.length < MIX_RUN_LENGTH + 1 ? mix.run : null;
  const mode = (label, sub, fn, glyph) => h("button", { class: "mode", onclick: fn }, h("span", { class: "mode-glyph", "aria-hidden": "true" }, glyph), h("span", {}, h("b", {}, label), h("small", {}, sub)));
  const daily = dailyThemes().map((t) => THEMES[t].label).join(" + ");
  view.replaceChildren(h("div", { class: "page" },
    h("p", { class: "eyebrow", style: { color: "var(--muted)" } }, "Library"),
    h("h1", {}, "Mix"),
    h("p", { class: "sub" }, `Outside the daily path. Reading here scores nothing; reflecting on a card scores ${POINTS.mixReflection}, up to ${MIX_REFLECTION_DAILY_CAP} a day. A run ends after ${MIX_RUN_LENGTH} cards.`),
    run && h("div", { class: "panel resume" },
      h("div", {}, h("b", {}, runLabel(run)), h("div", { class: "muted" }, `Card ${Math.min((run.i ?? 0) + 1, run.ids.length)} of ${MIX_RUN_LENGTH}`)),
      h("button", { class: "btn primary", onclick: () => renderRun() }, "Resume")),
    h("div", { class: "modes" },
      mode("Shuffle", "A new author every card", () => startRun("shuffle"), "⤮"),
      mode("Daily Mix", daily, () => startRun("daily"), "☀"),
      mode("Echo", "Each card links to the last by theme", () => startRun("echo"), "∿")),
    h("h2", {}, "Themed mix"),
    h("div", { class: "filters", style: { flexWrap: "wrap" } },
      Object.entries(THEMES).map(([k, t]) => h("button", { class: "chip", onclick: () => startRun("theme", { themes: [k] }) }, t.label))),
    h("h2", {}, "Play one author"),
    h("div", {}, allVolumes().map((v) => {
      const pos = mix.positions[v.id] || 0;
      return h("button", { class: "entry", onclick: () => startRun("play", { vol: v.id }) },
        h("div", { class: "when" }, `${v.author}${v.year ? ` · ${v.year}` : ""}`),
        h("div", { class: "what" }, v.work),
        h("div", { class: "snip" }, `${v.why}. ${v.translator}. ${pos ? `Resume at ${pos + 1} of ${v.count}` : `${v.count} passages`}.`),
        v.flagged && h("div", { class: "muted", style: { fontSize: "12px" } }, `Licence note: ${v.flagged}`));
    })),
    h("h2", {}, "Coming to the library"),
    h("p", { class: "muted" }, volIndex.coming.join(" · ")),
    h("h2", {}, "Read alongside"),
    h("p", { class: "muted" }, "Still in copyright, so no quotes: the tutor gives you a summary instead."),
    h("div", {}, ALONGSIDE.map((b) => h("button", { class: "entry", onclick: () => alongsideSheet(b) },
      h("div", { class: "what" }, b.title), h("div", { class: "snip" }, b.author))))));
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

const ROUTES = { today: renderToday, mix: () => (mixState().run && mixState().run.date === dayKey() ? renderRun() : renderMix()), journal: renderJournal, consult: renderConsult, you: renderYou };
function current() {
  const t = location.hash.slice(1);
  return ROUTES[t] ? t : "today";
}
function go(tab) {
  if (location.hash.slice(1) === tab) route();
  else location.hash = tab;
}
function route() {
  const t = current();
  tabs.forEach((b) => (b.dataset.tab === t ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  if (t !== "today") document.querySelector(".install")?.remove();
  if (t !== "mix") hidePlayer();
  ROUTES[t]();
  window.scrollTo(0, 0);
}
tabs.forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
window.addEventListener("hashchange", route);
// a new day unlocks the next card; re-render if the app stays open past midnight
let lastDay = dayKey();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && dayKey() !== lastDay) {
    lastDay = dayKey();
    route();
  }
});
route();
statusReady.then(() => current() === "you" && renderYou());

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
