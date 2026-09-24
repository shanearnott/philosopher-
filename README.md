# Stoa

A phone app to take Instagram's slot on your home screen. The same thumb-swipe habit, but each swipe moves you through real philosophy, and the day's session ends after one passage.

This is **Phase 1** of the plan (*Stoa — A Philosophy Feed to Replace Instagram*): a web app you save to your home screen, covering Meditations Units 1–3 (30 days).

## What's in it

- **The daily swipe.** Six full-screen cards, swiped vertically: Passage → Context → Explainer → Apply → Reflect → Tutor, then an end card that says *Done for today.* The path is locked to one passage a day. When you've finished, you can revisit past cards or your journal, but the path doesn't move until tomorrow.
- **Original words only.** Each passage is verbatim George Long (1862), pulled from the Standard Ebooks edition by `scripts/ingest.mjs` and stored with a SHA-256 checksum. The app won't show a passage whose text doesn't match its checksum.
- **The tutor (Claude).** It does the four jobs from the plan: *Explain* (a longer explanation), *Ask* (tailors the Apply question to your profile), *Expound* (responds to your reflection and always names one place you could go further, with one follow-up reply) and *Consult* (picks 2–3 passages you've already studied that bear on a situation you describe). Claude cites passages only as IDs, and the app inserts the verbatim text. Any quoted phrase that isn't in the library loses its quote marks and is marked `≈` as a paraphrase.
- **Quick mode.** Stop after card 3 on busy days. The streak is kept, and you get fewer points.
- **Scoreboard.** Points come from practice only: session 10, quick 4, reflection of 50+ words 20, next-day "did you apply it?" check-in 25, evening review (Seneca's three questions) 15, favourite 2 (up to 5 a day), unit 50. Also: ranks from Novice to Mentor (deliberately no Sage), four virtue meters, a daily streak with 2 grace days a month, a weekly target of 5, and an option to hide all numbers.
- **Journal.** One entry per session. You can filter by virtue, theme or favourites, delete any entry, and export to Markdown or print to PDF as a book.
- **Private.** Everything is stored on your phone (browser storage). The only data that leaves it is what the tutor needs: the passage ID, your reflection, your short profile and your last five reflections.
- **Look.** Designed as a museum at dusk: EB Garamond and Inter, marble, ink, terracotta and gold, slow cross-fades and a slight parallax. Dark mode turns on automatically after 8pm. Nothing flashes and nothing makes a sound.
- Hold the passage card to save it as a favourite. Voice dictation works where the browser supports it. The app also works offline apart from the tutor.

## Put it on your phone or iPad (no terminal needed)

1. **Host it.** Tap [**Deploy to Render**](https://render.com/deploy?repo=https://github.com/shanearnott/philosopher-/tree/claude/instagram-replacement-app-pv9lkx) and sign in with GitHub. Render reads `render.yaml` and asks for two values:
   - `ANTHROPIC_API_KEY`: your key from [console.anthropic.com](https://console.anthropic.com) (API Keys).
   - `STOA_ACCESS_TOKEN`: an access code you make up, such as `olive-grove-1862`. It stops strangers using your API credit.

   After a few minutes you get an address like `https://stoa-xxxx.onrender.com`. The free plan sleeps when idle, so the first open of the day takes about 30 seconds.
2. **Open your setup link** on the phone or iPad, in Safari: `https://stoa-xxxx.onrender.com/?code=olive-grove-1862`. The code is saved on that device, and you never type it again.
3. **Add to Home Screen.** Stoa shows a banner telling you how: tap **Share**, then **Add to Home Screen**. From then on it opens full screen like an app and works offline apart from the tutor.
4. **Put it where Instagram was.** Move Instagram off your first page.

Already set up on one device? Go to **You → Settings → Share setup link to another device** and AirDrop or message the link to yourself. If you ever open the app without the code, it asks for it the first time the tutor is needed.

Each device keeps its own journal, since everything is stored on the device.

On iPad the cards use a centred reading column with larger type. With an iPad keyboard, ↑ and ↓ (or Space) move between cards.

## Run it on a computer

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start      # http://localhost:8787
```

The daily path works without an API key; you just won't get tutor responses.

Any other Node host with HTTPS (Fly, Railway, a VPS) works the same way as Render: set the environment variables below and run `npm start`.

| Env var | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Claude API key. It stays on the server and never reaches the phone. |
| `STOA_ACCESS_TOKEN` | none | If set, the app must send this token to use the tutor. |
| `STOA_MODEL` | `claude-sonnet-5` | Model for daily sessions (the plan's Sonnet choice). |
| `STOA_DEEP_MODEL` | `claude-opus-5` | Model for **Go deeper** on long reflections. It uses server-side refusal fallback. |
| `STOA_DAILY_CALL_CAP` | `60` | Maximum tutor calls per day, as a cost guard. |
| `PORT` | `8787` | |

## Texts and numbering

`npm run ingest` re-downloads the text and rebuilds `public/data/library.json`. Standard Ebooks paragraphs don't carry section numbers, and a few paragraphs split or merge the standard sections (for example, 4.3 spans two paragraphs). So every passage is mapped to its paragraph explicitly in `scripts/ingest.mjs` and checked against its opening words. The library currently holds 42 passages: the 30 course days plus anchor passages for later units. Adding a day means adding its mapping there first.

## Layout

```
server.js                 static server + /api/tutor (holds the API key)
lib/tutor.js              Claude prompts for Explain / Ask / Expound / Reply / Consult
scripts/ingest.mjs        text pipeline: download, split, map, checksum
public/                   the app (no build step)
  data/library.json       locked passage library (generated)
  data/course-meditations.json   the 30-day path: context, key word, paraphrase, questions
  js/logic.js             points, streaks, ranks, quote guard, checksum (pure, tested)
  js/app.js               UI
test/                     node --test
```

`npm test` runs checksum integrity, a check that course text never misquotes a passage, the points, streak and rank rules, the quote guard, and prompt building.

## Next (from the plan)

- **Phase 2:** all 120 core days, CC0 museum imagery (Met, Art Institute of Chicago, Rijksmuseum), echoes across courses, and the live Headlines lens (web search).
- **Phase 3:** a native SwiftUI app with offline texts, one notification a day, and a home-screen widget.
- **Phase 4:** Epictetus, Seneca and the rest of the roadmap, reusing the ingest pipeline.
