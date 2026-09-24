// Server side of the tutor: runs requests built by public/js/prompts.js with
// the Anthropic SDK, so the API key stays on the server.

import Anthropic from "@anthropic-ai/sdk";
import { buildRequest as build, requestBody, FALLBACK_BETA, DEFAULT_MODELS } from "../public/js/prompts.js";

export const DAILY_MODEL = process.env.STOA_MODEL || DEFAULT_MODELS.daily;
export const DEEP_MODEL = process.env.STOA_DEEP_MODEL || DEFAULT_MODELS.deep;

export const buildRequest = (body, library, course) =>
  build(body, library, course, { daily: DAILY_MODEL, deep: DEEP_MODEL });

let client;
export function hasKey() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

export async function runTutor(req) {
  client ??= new Anthropic();
  const params = requestBody(req);
  const response = params.fallbacks
    ? await client.beta.messages.create({ ...params, betas: [FALLBACK_BETA] })
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
