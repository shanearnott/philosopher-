// Calls Claude straight from the browser with the user's own API key, for
// when Stoa is hosted as a static site (GitHub Pages) with no server. The key
// is kept in this device's storage and sent only to api.anthropic.com.
// No SDK here: the static site has no build step to bundle one.

import { requestBody, FALLBACK_BETA } from "./prompts.js";

export async function callClaude(apiKey, req) {
  const body = requestBody(req);
  const headers = {
    "content-type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  if (body.fallbacks) headers["anthropic-beta"] = FALLBACK_BETA;

  let res;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body) });
  } catch {
    throw new Error("Couldn't reach Claude. Check your connection.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) throw new Error("Claude rejected your API key. Check it in You → Settings.");
    if (res.status === 429) throw new Error("Claude is rate-limited. Try again in a minute.");
    if (res.status === 402 || res.status === 403) throw new Error("Your Claude account can't make this request (billing or permissions).");
    throw new Error(`Claude API error (${res.status}).`);
  }
  if (data.stop_reason === "refusal") throw new Error("The tutor declined to answer this one.");
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("").trim();
  return { text, model: data.model, allowed: req.allowed };
}
