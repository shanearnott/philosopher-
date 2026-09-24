// Claude's four jobs from the plan: Explain, Ask, Expound (+ one reply), Consult.
// The server builds every prompt from the locked library by passage ID, so the
// client can't smuggle in passage text, and Claude is told to cite passages
// only as [[id]] tokens. The app swaps tokens for verbatim text.

import Anthropic from "@anthropic-ai/sdk";

export const DAILY_MODEL = process.env.STOA_MODEL || "claude-sonnet-5";
export const DEEP_MODEL = process.env.STOA_DEEP_MODEL || "claude-opus-5";

const SYSTEM = `You are the tutor in Stoa, a private daily philosophy app that replaces a social feed. You have read the day's passage from Marcus Aurelius's Meditations (George Long's translation) alongside the user.

How you speak:
- You speak as yourself about Marcus. Never speak as Marcus or roleplay him.
- Never write out a quotation from any philosopher, and never put words in quotation marks as if Marcus said them. Paraphrase in your own words.
- To point to a passage, write its ID in double brackets on its own line, for example [[meditations.5.20]]. The app replaces the token with the verbatim text. Use only IDs you are given in this request.
- Be honest rather than flattering. Praise only what is actually good, and be specific.
- Plain prose in short paragraphs. No headings, lists or bold unless asked. Address the user as "you".
- Stay on conduct and character. Don't moralise about politics, and don't diagnose health problems; if the user seems in crisis, say plainly that a trusted person or professional is the right next step.`;

const LIMITS = { reflection: 4000, reply: 2000, situation: 2000, profile: 1200, recent: 600 };
const has = (library, id) => typeof id === "string" && Object.hasOwn(library.passages, id);
const clip = (s, n) => (typeof s === "string" ? s.slice(0, n) : "");

function passageBlock(library, id) {
  const p = library.passages[id];
  return `<passage id="${id}" ref="${p.work} ${p.ref}">\n${p.text}\n</passage>`;
}

function profileBlock(profile) {
  if (!profile) return "";
  const lines = [
    profile.role && `Role: ${clip(profile.role, 200)}`,
    profile.challenges && `Current challenges: ${clip(profile.challenges, LIMITS.profile)}`,
    profile.goals && `Goals: ${clip(profile.goals, LIMITS.profile)}`,
  ].filter(Boolean);
  return lines.length ? `<user_profile>\n${lines.join("\n")}\n</user_profile>` : "";
}

function recentBlock(recent) {
  if (!Array.isArray(recent) || !recent.length) return "";
  const items = recent
    .slice(0, 5)
    .map((r) => `- ${clip(r.ref, 20)}: ${clip(r.reflection, LIMITS.recent)}`)
    .join("\n");
  return `<recent_reflections>\n${items}\n</recent_reflections>`;
}

function studiedIds(library, studied, extra = []) {
  const ids = new Set([...(Array.isArray(studied) ? studied : []), ...extra]);
  return [...ids].filter((id) => has(library, id));
}

// Returns { model, effort, prompt, allowed } or throws a 400-style error.
export function buildRequest(body, library, course) {
  const { job, passageId, deeper } = body || {};
  const needsPassage = ["explain", "ask", "expound", "reply"].includes(job);
  if (needsPassage && !has(library, passageId)) throw badRequest("Unknown passage");
  const day = course.days.find((d) => `meditations.${d.ref}` === passageId);
  const context = day ? `<context>${day.context}</context>` : "";
  const studied = studiedIds(library, body.studied, needsPassage ? [passageId] : []);
  const others = studied.filter((id) => id !== passageId);
  const model = deeper ? DEEP_MODEL : DAILY_MODEL;
  const parts = [];
  let effort = "low";

  switch (job) {
    case "explain":
      parts.push(
        passageBlock(library, passageId),
        context,
        `Explain this passage in 80 to 120 words: what it means, the key idea in plain English, and one concrete modern example. Don't repeat the passage.`,
      );
      break;
    case "ask": {
      const area = ["work", "family", "decision"].includes(body.area) ? body.area : "work";
      parts.push(
        passageBlock(library, passageId),
        profileBlock(body.profile),
        `Write one question, under 35 words, that links this passage to the user's ${area === "decision" ? "current decisions" : area}. Make it specific to their profile if one is given. Output only the question.`,
      );
      break;
    }
    case "expound":
      effort = deeper ? "high" : "medium";
      parts.push(
        passageBlock(library, passageId),
        profileBlock(body.profile),
        recentBlock(body.recent),
        body.question ? `<question>${clip(body.question, 300)}</question>` : "",
        `<reflection>\n${clip(body.reflection, LIMITS.reflection)}\n</reflection>`,
        others.length ? `Passages the user has already studied (cite at most one): ${others.join(", ")}` : "",
        `Respond to the user's reflection in 150 to 250 words. Say what is strong in it, specifically. Then name at least one place where Marcus would push further, even if the reflection is good. ${others.length ? "If one of the studied passages genuinely bears on it, point to it with its [[id]] token." : "Don't cite other passages."} End with one short line they can carry into tomorrow.`,
      );
      break;
    case "reply":
      effort = deeper ? "high" : "medium";
      parts.push(
        passageBlock(library, passageId),
        `<reflection>\n${clip(body.reflection, LIMITS.reflection)}\n</reflection>`,
        `<your_response>\n${clip(body.response, 3000)}\n</your_response>`,
        `<user_reply>\n${clip(body.reply, LIMITS.reply)}\n</user_reply>`,
        `This is the user's one follow-up for today. Answer it in under 150 words, then close the conversation warmly; there is no further reply.`,
      );
      break;
    case "consult":
      if (!studied.length) throw badRequest("No studied passages yet");
      effort = deeper ? "high" : "medium";
      parts.push(
        ...studied.map((id) => passageBlock(library, id)),
        profileBlock(body.profile),
        `<situation>\n${clip(body.situation, LIMITS.situation)}\n</situation>`,
        `The user is consulting their library about the situation above. Choose the 2 or 3 passages above that bear on it most (fewer if fewer fit). For each, put its [[id]] token on its own line, then 2 or 3 sentences on how it applies to this situation. Finish with one practical next step. Use only passages given above.`,
      );
      break;
    default:
      throw badRequest("Unknown job");
  }

  const allowed = job === "consult" ? studied : [passageId, ...others];
  return { model, effort, prompt: parts.filter(Boolean).join("\n\n"), allowed };
}

function badRequest(message) {
  return Object.assign(new Error(message), { status: 400 });
}

let client;
export function hasKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function runTutor(req) {
  client ??= new Anthropic();
  const params = {
    model: req.model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: req.effort },
    messages: [{ role: "user", content: req.prompt }],
  };
  // Opus 5: re-run a classifier refusal on Anthropic's recommended fallback model
  const response =
    req.model === "claude-opus-5"
      ? await client.beta.messages.create({
          ...params,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        })
      : await client.messages.create(params);

  if (response.stop_reason === "refusal") {
    throw Object.assign(new Error("The tutor declined to answer this one."), { status: 422 });
  }
  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
  return { text, model: response.model, allowed: req.allowed };
}

export function errorStatus(err) {
  if (err.status && !(err instanceof Anthropic.APIError)) return [err.status, err.message];
  if (err instanceof Anthropic.AuthenticationError) return [502, "The server's Claude API key was rejected."];
  if (err instanceof Anthropic.RateLimitError) return [429, "Claude is rate-limited. Try again in a minute."];
  if (err instanceof Anthropic.APIConnectionError) return [503, "Couldn't reach Claude."];
  if (err instanceof Anthropic.APIError) return [502, `Claude API error (${err.status ?? "unknown"}).`];
  return [500, "Something went wrong."];
}
