# Stoa

A phone app to take Instagram's slot on your home screen. The same thumb-swipe habit, but each swipe moves you through real philosophy: the book or course you're reading, one passage at a time.

This is **Phase 1** of the plan (*Stoa — A Philosophy Feed to Replace Instagram*): a web app you save to your home screen, covering the full 120-day Meditations core path in 12 themed units, ending with a review week.

## What's in it

- **Learn is your current reading.** The Learn tab shows the course or book you're reading (the Meditations path by default), one full-screen passage per card, swiped vertically. Read as many as you like in a session, or stop any time: Learn resumes at the next unread passage, marked *Resume*. A passage counts as read once you swipe past it. On Meditations days the explainer panel also holds the course's context, Greek keyword, plain-English paraphrase and the questions to carry into the day. Pick what Learn reads under *Browse*: tap any author for *Read in Learn* (or *Play in Mix*), or pick a course under *World traditions → Courses for Learn*. Each keeps its own place. There's nothing to write.
- **Original words only.** Each passage is verbatim George Long (1862), pulled from the Standard Ebooks edition by `scripts/ingest.mjs` and stored with a SHA-256 checksum. The app won't show a passage whose text doesn't match its checksum.
- **Explainers built into the app.** Swiping left on a card, or tapping *Explain*, shows a stored explainer straight away, with no Claude call and no cost. It has three parts: *In plain English* (what the passage says, in everyday words), *Today* (how it applies to modern life) and *For you* (applied to your own life: leadership, public service, defence and strategy, building autonomous systems, family, and the morning habit that replaced Instagram). Explainers cover all 120 course days and every one of the 471 Meditations passages, plus 16 featured cards in each other volume (21 for Epicurus). Outside Play, Swipe draws from explained cards. A **Go deeper** button then hands a richer prompt to Claude, with the stored explainer included, for history, connections, the strongest objection and two practices. Cards without a stored explainer (mostly in Play) go straight to Claude.
- **The tutor (Claude).** It does three jobs: *Go deeper* (after a stored explainer), *Explain* (only for cards without a stored explainer) and *Consult* (picks 2–3 passages you've already studied that bear on a situation you describe). Claude cites passages only as IDs, and the app inserts the verbatim text. Any quoted phrase that isn't in the library loses its quote marks and is marked `≈` as a paraphrase.
- **Navigation.** Five tabs: **Learn** (your current reading), **Mix**, **Browse**, **Saved** and **You**. *Mix* is a random jukebox. The Mix tab always opens its subject picker (with *Resume* when a run is going): the same tiles as *Browse → By subject*, each with its card count. The picker is always dark, like the cards it leads into. Pick three (a tick marks each) and Mix starts by itself as soon as the third is picked: the other tiles drift away in a ripple from your last tap and the three picks glow, playing cards from all three at random, across every author and tradition, never the same author twice running. *Everything* does the same: its tile glows, every other tile fades, and the whole library starts; with one or two picked, *Play* starts those; *Last mix* repeats the previous three. The sliders in the mini-player (or *Browse → Mix → Pick 3 subjects*) reopen the picker. **Updates:** every time the app opens or comes back to the front, it asks the server which version is live; if it's newer, it drops its old caches and reloads once. The version shows at the bottom of *You*. Swipe up and down for cards; swipe left on any card (or tap *Explain*) to slide its explainer in, and right to close it. The same works on Learn's cards, and with the arrow keys on an iPad keyboard. On any card, tap the author to read on in that book (Play), or a subject tag to follow that subject across authors. *Browse* is the way in: *Mix* (Choose subjects, Shuffle, Daily Mix, Echo), *By subject* (leadership, war and strategy, control, other people, work and duty, fame, death and time, simplicity, faith and prayer, love and compassion, justice and right action, the self and the soul, stillness and the mind, suffering and hardship, and World traditions for every tradition card), *By author* (grouped as the Stoics, Greece and Rome, strategy and statecraft, the East, essayists and moralists, Americans), *By situation* (Consult) and *Read alongside*. The mini-player shows the run, with Shuffle, Subjects and Skip. Shuffle never shows the same author twice in a row and leans 70/30 towards volumes you've started (adjustable). A run ends after 20 cards with *Enough for now*. Reading scores nothing. Volumes: Epictetus (Enchiridion, Discourses), Seneca (Dialogues), Cicero (On Duties), Boethius, Montaigne, Bacon, the Tao Te Ching, the Dhammapada, Adam Smith, Thucydides, Franklin, Pascal, Plutarch, Sun Tzu, Machiavelli, Confucius, Aristotle, La Rochefoucauld, Epicurus, Thoreau, Emerson and Schopenhauer. Most come from Standard Ebooks; Cicero, Montaigne, Bacon, the Dhammapada, Pascal, Plutarch, La Rochefoucauld and Schopenhauer come from Project Gutenberg via the GITenberg mirror. Editors' and transcribers' notes are stripped (Montaigne's bracketed notes, page markers); translators' own brackets are kept. Numbered works keep their standard numbers; prose works are cited by chapter and paragraph (¶) in that edition. A *Read alongside* shelf (Frankl, Stockdale, Musashi) gives tutor summaries only, never quotes, since those books are in copyright.
- **Traditions wing.** Core passages from five religious traditions, per the plan: Judaism (Tanakh in the 1917 JPS translation; Pirkei Avot, Charles Taylor 1897), Christianity (World English Bible; The Imitation of Christ, William Benham 1874), Islam (Quran, Marmaduke Pickthall 1930, with the Arabic from Tanzil alongside), Hinduism (Bhagavad Gita in K. M. Ganguli's Mahabharata; Isha, Katha and Kena Upanishads, Swami Paramananda 1919) and Buddhism (suttas in Bhikkhu Sujato's CC0 translation, with the Müller Dhammapada). 30–38 passages each, over four weekly themes: Foundations, Ethics, The self, Purpose and practice. Verbatim and checksummed like every other card, with licence and source on each. Every tradition card has a stored explainer with a *Background* part (history, how the main branches read it, key terms in the original language). **Compare** cards set the same theme side by side across the traditions and the Stoics, with what's shared and what differs (ten themes, from giving without show to prayer and stillness; e.g. Matthew 6:1–4 with Meditations 5.6); a Compare button appears on any card in a theme, and Echo follows these links. *Core principles compared* is the plan's reference matrix (ultimate reality, the human problem, the path, the goal, after death, central ethic). Compare, don't rank: each tradition is described as it understands itself. Each tradition is also a **daily course** (30–38 passages): pick it under *Browse → World traditions → Courses for Learn* and Today reads through it, with the Arabic on Quran cards and the Background part in each explainer. Each course keeps its own progress; the streak and weekly target count a session on any course. Sikhism is pending: no public-domain English translation was reachable (Macauliffe 1909), and the open Gurbani databases carry modern, in-copyright translations. `npm run ingest:traditions` rebuilds them from `scripts/traditions/selections.mjs`.
- **Saved.** Tap **Save** on any card (or hold the day's passage) to keep it, with an optional comment on why it landed. The Saved tab lists them newest first, filterable by author, theme or *With comments*; tap one to edit the comment, read the explainer, share it, or read on in that author. **Share** on any card opens the phone's share sheet (Messages, Mail, …) with the verbatim passage and its reference. Export to Markdown. Existing favourites carried over as saved cards.
- **Quick mode.** Stop after card 3 on busy days. The streak is kept, and you get fewer points.
- **Scoreboard.** Points come from practice only: session 10, quick 4, saving a card 2 (up to 5 a day), unit 50, course 250. Also: ranks from Novice to Mentor (deliberately no Sage), four virtue meters (one tick per completed day, by its passage's virtue), a daily streak with 2 grace days a month, a weekly target of 5, and an option to hide all numbers.
- **Private.** Everything is stored on your phone (browser storage). The only data that leaves it is what the tutor needs: the passage ID, your short profile, and the situation you describe when you consult.
- **Illuminated initial.** Every passage card (in Learn, Mix and the review week) opens with an initial, which sets the original text apart from the explainer and deep-dive panels. It's drawn in the manner of the Book of Kells: a muted gilt letter on a knotwork panel with spiral corners, or a geometric star frame on Quran cards (no figurative art). It's drawn as SVG (`public/js/illumination.js`); only the first letter is drawn (after any quote mark), or the verse number when a card starts with one (the Dhammapada), the text is unchanged, and screen readers read it whole.
- **Look.** Designed as a museum at dusk: EB Garamond and Inter, marble, ink, terracotta and gold, slow cross-fades and a slight parallax. Dark mode turns on automatically after 8pm. Nothing flashes and nothing makes a sound.
- Hold the passage card to save it as a favourite. Voice dictation works where the browser supports it. The app also works offline apart from the tutor.

## Put it on your phone or iPad

### Easiest: GitHub Pages (free, nothing to run)

GitHub hosts the app at **https://shanearnott.github.io/philosopher-/**. There's no server, so the tutor calls Claude directly from your device with your own API key.

1. **Publish.** Every push to `main` runs the tests and publishes `public/` to the `gh-pages` branch, which GitHub Pages serves (see `.github/workflows/pages.yml`). You can also run it from the **Actions** tab (**Deploy to GitHub Pages → Run workflow**).
2. **If the page doesn't appear**, go to the repo's **Settings → Pages** and set **Source** to **Deploy from a branch**, with branch `gh-pages` and folder `/ (root)`.
3. **On your phone or iPad**, open the address in Safari. Stoa shows a banner: tap **Share**, then **Add to Home Screen**, and move it to where Instagram was.
4. **The tutor.** By default the tutor hands off to your Claude app: Stoa copies a ready-made prompt and opens Claude, so it uses your existing plan and adds no API cost. Stored explainers need no Claude at all. If you'd rather have replies inside Stoa, add a Claude API key from [console.anthropic.com](https://console.anthropic.com/settings/keys) under **You → Settings**. Do this *inside the home-screen app*, because iOS keeps its storage separate from Safari.

About the key: it stays in that device's storage and is sent only to `api.anthropic.com`. It is never in the repo or on the website. Anyone else who opens the site sees the app but has no tutor unless they add their own key. To stop spending a lot, set a monthly spend limit in the Anthropic console.

### With a server: Render (keeps the key off your devices)

This is the plan's original design: a small server holds the key, and devices only need an access code.

1. Tap [**Deploy to Render**](https://render.com/deploy?repo=https://github.com/shanearnott/philosopher-) and sign in with GitHub. Render reads `render.yaml` and asks for two values:
   - `ANTHROPIC_API_KEY`: your key from [console.anthropic.com](https://console.anthropic.com) (API Keys).
   - `STOA_ACCESS_TOKEN`: an access code you make up, such as `olive-grove-1862`. It stops strangers using your API credit.

   You get an address like `https://stoa-xxxx.onrender.com`. The free plan sleeps when idle, so the first open of the day takes about 30 seconds.
2. Open `https://stoa-xxxx.onrender.com/?code=olive-grove-1862` on each device to save the code, then add Stoa to your home screen as above.

With a server, once one device is set up, go to **You → Settings → Share setup link to another device** and AirDrop or message the link to yourself. If you ever open the app without the code, it asks for it the first time the tutor is needed.

Each device keeps its own progress and saved cards, since everything is stored on the device.

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
| `STOA_DEEP_MODEL` | `claude-opus-5` | Model for **Go deeper**. It uses server-side refusal fallback. |
| `STOA_DAILY_CALL_CAP` | `60` | Maximum tutor calls per day, as a cost guard. |
| `PORT` | `8787` | |

## Texts and numbering

`npm run ingest` re-downloads the text and rebuilds `public/data/library.json`. Standard Ebooks paragraphs don't carry section numbers, and a few paragraphs split or merge the standard sections (for example, 4.3 spans two paragraphs). So every passage is mapped to its paragraph explicitly in `scripts/ingest.mjs` and checked against its opening words. Each book is aligned in `ALIGN` (which paragraphs merge, which hold two sections and are left out) and checked against well-known passages in `ANCHORS`; every book must come out at its standard section count. The library holds 471 of the ~488 sections; the 17 left out sit in verse clusters (e.g. 7.36–7.41) where the edition doesn't separate sections cleanly.

`npm run ingest:volumes` rebuilds the wider library in `public/data/volumes/` (one file per volume, loaded only when Mix or Learn needs it). Still to come, because no edition was reachable for ingest: Seneca's Letters (Gummere's translation was never on Project Gutenberg) and the Bhagavad Gita. Plutarch is Stewart and Long's translation (vol. I) rather than Dryden/Clough.

### Explainers for new texts

When you add an author or text, write its explainers in the same check-in. Run `node scripts/pick-featured.mjs <volume>` for suggested cards (well-known passages first, then the best-themed card from each stretch of the work), write `scripts/explainers/<volume>.mjs`, and run `npm run explainers`. The build rejects any part under eight words, any card id that doesn't exist, and any words in quotation marks that aren't verbatim from the passage. The tests fail if a library volume has no explainers or fewer than 15.

## Layout

```
server.js                 static server + /api/tutor (holds the API key)
lib/tutor.js              runs tutor requests on the server with the Anthropic SDK
scripts/ingest.mjs        Meditations pipeline: download, align, checksum
scripts/ingest-volumes.mjs   the wider library for Mix, Learn and Browse
scripts/explainers/       hand-written explainers (plain meaning, today, for you), one file per volume or part
scripts/build-explainers.mjs  validates them and writes public/data/explainers/ (runs before npm test)
scripts/pick-featured.mjs suggests featured cards for a new volume
scripts/tag-themes.mjs    stores each card's subjects and the per-volume counts Mix uses (npm run themes)
public/                   the app (no build step)
  data/library.json       locked passage library (generated)
  data/course-meditations.json   the 120-day path: context, key word, paraphrase, questions
  js/prompts.js           Claude prompts for Explain / Ask / Expound / Reply / Consult (shared)
  js/direct.js            calls Claude from the browser with your own key (GitHub Pages)
  js/logic.js             points, streaks, ranks, quote guard, checksum (pure, tested)
  js/themes.js            subjects (tagged by keyword) for Mix, By subject, Echo and Daily Mix
  js/app.js               UI
test/                     node --test
.github/workflows/pages.yml   test + publish to GitHub Pages on push to main
render.yaml               one-click Render hosting (server mode)
```

`npm test` runs checksum integrity, a check that course text never misquotes a passage, the points, streak and rank rules, the quote guard, and prompt building.

## Next (from the plan)

- **Phase 2:** all 120 core days, CC0 museum imagery (Met, Art Institute of Chicago, Rijksmuseum), echoes across courses, and the live Headlines lens (web search).
- **Phase 3:** a native SwiftUI app with offline texts, one notification a day, and a home-screen widget.
- **Phase 4:** Epictetus, Seneca and the rest of the roadmap, reusing the ingest pipeline.
