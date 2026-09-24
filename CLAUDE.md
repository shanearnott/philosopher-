# Stoa

A daily philosophy app to replace Instagram. The plan lives in the Claude Doc
"Stoa — A Philosophy Feed to Replace Instagram". See README.md for layout.

## Workflow rules (from the owner)

- **At the end of every new feature section, always commit and push, and
  check the work in to `main`.** Don't wait to be asked, and don't batch
  several features into one push. Pushing to `main` publishes the site to
  https://shanearnott.github.io/philosopher-/ via `.github/workflows/pages.yml`,
  so run `npm test` first and confirm the deploy workflow succeeds afterwards.
- Keep moving: when a request has several parts, finish, check in and push each
  part in turn.

## Content rules

- Original words only: passages are verbatim from the public-domain editions
  in `public/data/`, checksummed. Never write or edit a quote by hand;
  regenerate with `npm run ingest` / `npm run ingest:volumes`.
- Course text (context, paraphrase, questions) must not put non-verbatim words
  in quotation marks; `test/library.test.mjs` enforces this.
- Explainers are written here, not generated at runtime: every card's Explain
  button shows a stored explainer from `public/data/explainers/<volume>.json`,
  built from `scripts/explainers/<volume>[-part].mjs` by `npm run explainers`.
  Each has three parts: `meaning` (the passage in plain, layman's English),
  `today` (how it applies to modern life) and `you` (how it applies to the
  owner: builds autonomous systems, leads teams, public service and defence
  interests, family, replacing an Instagram habit with a morning session).
  **Whenever a new author or text is added, write explainers for it in the
  same check-in** (all Meditations passages; at least the featured cards of
  every other volume). Don't put non-verbatim words in quotation marks.
  "Go deeper" then hands a richer prompt to Claude.
- Traditions wing (`scripts/traditions/`): passages come only from the
  public-domain or CC0 editions listed in `scripts/ingest-traditions.mjs`
  (`npm run ingest:traditions`); every tradition card's explainer also needs
  `context` (Background: history, how the branches read it, key original-
  language terms). Compare cards live in `scripts/traditions/compare.mjs`.
  Describe each tradition as it understands itself; never rank them.
  Sikhism is pending until a public-domain English translation is reachable.
- The tutor defaults to the user's Claude app (hand-off, no API cost); an API
  key is optional.
