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
- The tutor defaults to the user's Claude app (hand-off, no API cost); an API
  key is optional.
