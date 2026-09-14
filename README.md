# MomentScout

A workspace for short-form creators to search for a person, subject, or topic; find real public
video sources with clear attribution; preview and save moments; and — for footage they have the
rights to — trim and crop a clip. Temporary product name, easy to rebrand later (see
`lib/constants.ts`).

This is a working slice of the full product described for this project, built as a vertical slice
per the delivery order: a real search integration, a full local-first save/collections flow, and a
complete trim/crop editing UI. Auth, cloud persistence, and the FFmpeg export worker are
**not yet wired up** — see [What's deferred](#whats-deferred-and-why) below.

## Stack

- Next.js 16 (App Router, TypeScript), Tailwind CSS v4
- [`motion`](https://motion.dev) for the interface's animation (hero reveal, route transitions,
  trim-handle and crop-drag interactions)
- YouTube Data API v3 for real search, metadata, and embedded playback
- Twitch Helix API (optional) for channel discovery, past broadcasts, highlights, uploads, and
  official clips, with Twitch's own video and clip players
- Anthropic API (optional) for LLM-based query understanding, with a regex heuristic fallback, and
  for the transcript and cross-check roles of AI video analysis
- Gemini API (optional) for public-YouTube video analysis: footage scans for visual moments, and
  every analysis role when Claude isn't configured
- Browser `localStorage` for saved moments, recent searches, uploads, and export jobs (see
  limitations below)
- A Supabase schema migration for the future auth/projects/transcripts phase (not yet applied to a
  live project)

## Local setup

Requires Node 20+ for the website. The analysis worker uses Node 24+ because it runs TypeScript
directly with Node's native type stripping.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open http://localhost:3000.

### Environment variables

| Variable | Required for | Behavior if missing |
|---|---|---|
| `YOUTUBE_API_KEY` | Real search results and video detail pages | The app runs and shows an honest "search isn't configured yet" state instead of results |
| `ANTHROPIC_API_KEY` | Smarter query parsing; Claude for the transcript and cross-check roles of AI video analysis | Search falls back to a regex heuristic parser; analysis runs every role on Gemini |
| `GEMINI_API_KEY` | Footage scans of public YouTube videos, and fallback for the text roles | Without it (and with Claude configured), analysis works from captions only; with neither model key the analysis action stays disabled |
| `GEMINI_VIDEO_MODEL` | Optional Gemini model override | Uses `gemini-3.8-flash` |
| `GEMINI_FALLBACK_MODELS` | Optional comma-separated Gemini 3.x Flash models to use when the primary model's daily quota is used up | Analysis stops with a quota message until the quota resets |
| `ANALYSIS_READER_MODEL` / `ANALYSIS_REVIEWER_MODEL` | Optional model for the transcript and cross-check roles (`claude-…` or `gemini-…`) | `claude-opus-5` when `ANTHROPIC_API_KEY` is set, otherwise the Gemini model |
| `ANALYSIS_VISUAL_PASS` | Optional `auto`, `always` or `off` footage scanning | `auto`: skipped for speech-led videos whose captions cover the footage |
| `ANALYSIS_WINDOW_SECONDS` | Optional seconds of video per section (300–3600) | `600`: ten-minute sections, all analyzed in parallel |
| `ANALYSIS_CONCURRENCY` | Optional number of Gemini requests sent at once (1–4) | `2` (Claude requests: up to 4) |
| `ANALYSIS_WORKER_AUTOSTART` | Set to `0` to stop the website starting the analysis worker | The worker starts with the website when `GEMINI_API_KEY` or `ANTHROPIC_API_KEY` is set |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Twitch as a second discovery source | Twitch results are simply omitted with a "Twitch isn't configured yet" notice; YouTube keeps working |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Not used yet | No effect — reserved for the auth/projects phase |

Get a YouTube key from the [Google Cloud Console](https://console.cloud.google.com/) with the
**YouTube Data API v3** enabled. The API has a daily quota; when it's exhausted the app shows a
"daily search limit reached" state rather than failing silently.

Get a free Twitch client ID/secret from the [Twitch Developer Console](https://dev.twitch.tv/console/apps).
Twitch has no full-text "search by topic" API — only channel-name search — so Twitch results only
appear when the query names a channel/person; it then lists a bounded selection of that channel's
videos and official clips. Pasting a Twitch channel, video, or clip URL also works. **Kick is not
integrated**: Kick currently has no official public API for search, VODs, or clips, so there is
nothing to wire up without resorting to scraping or an unofficial third-party API, which this
project does not do.

### Enable Twitch

**Integration status (2026-09-14):** Implemented in the local project. Channel discovery returns
videos and official clips; direct Twitch URL lookup, embedded playback, source bookmarks,
thumbnail support, token refresh, and API error handling are wired up.

**Homepage showcase:** a skew-rotating card deck shows YouTube's official `mostPopular` chart
(`videos.list`, 1 quota unit, cached for an hour) with titles, channels, and a link to each video's
source page. Without `YOUTUBE_API_KEY`, or if the request fails, it shows clearly labeled example
topics instead. Beside it, an illustrated clip workflow (marked "Example") shows trimming and 9:16
reframing. Both support pause/replay and reduced motion: when the device asks for reduced motion,
cards cross-fade instead of rotating, and a "Turn on animations" button lets the visitor opt back in
(remembered in `localStorage`).

**Activation pending:** `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` were not configured when
checked. Add both values using the steps below, restart the server, and verify a real channel
search, video playback, clip playback, and saved-source reopening in the browser.

1. Register an application in the [Twitch Developer Console](https://dev.twitch.tv/console/apps).
2. Set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET` in `.env.local` (or your host's server environment).
   Keep the secret server-side; do not use a `NEXT_PUBLIC_` variable. This integration uses an app
   access token, so visitors do not need to log in to Twitch.
3. Restart the development server, then search a channel's login or paste
   `https://www.twitch.tv/videos/VIDEO_ID`, `https://clips.twitch.tv/CLIP_SLUG`, or
   `https://www.twitch.tv/CHANNEL/clip/CLIP_SLUG` with real IDs.

The player derives Twitch's `parent` parameter from the current hostname after mounting. Use HTTPS
in production. Below Twitch's minimum embed width of 400px, an external watch link replaces the
player. Deleted, expired, or restricted videos may not play; the Twitch link remains available.
See the [official embed requirements](https://dev.twitch.tv/docs/embed/video-and-clips/).

Twitch results are a bounded discovery batch on the first results page (up to 20 items from up to
three channels); subsequent pages currently paginate YouTube only. Helix supports cursors, but
separate Twitch pagination is not implemented. Clip ordering sorts the fetched sample, not the
channel's entire clip history. Twitch bookmarks save the source or official clip; automatic
player timestamp capture remains YouTube-only. Downloads and live streams are not included.

Run `node --test tests/twitch.test.cjs` for mocked Twitch contract tests. These check URL parsing,
embed parameters, metadata normalization, token refresh, missing credentials, rate limits, and
partial failures without calling Twitch. Live search/playback still needs configured credentials
and a browser check.

### Other scripts

```bash
npm run build       # production build
npm run start        # run the production build
npm run lint          # eslint
npm run typecheck  # tsc --noEmit
npm run analysis:worker # run the analysis worker by itself (autostart off)
npm run test:analysis   # mocked analysis/API contract tests
```

### AI video breakdown (public YouTube videos)

Opening an eligible YouTube video automatically starts transcript retrieval and analysis. The timeline
beneath the player follows playback and shows **key moments**, **potential moments**, and lower-potential
suggestions in separate colors. Overlapping clips remain individually selectable. Click a highlight,
adjust its start/end, preview the raw source range (playback stops at its end), and save the selection
to Collections. Saving a selection stores source timestamps; it does not download an MP4.

The worker fetches existing timestamped captions through [Supadata's native transcript API](https://docs.supadata.ai/get-transcript).
`SUPADATA_API_KEY` is required alongside the YouTube key and at least one model key. If the caption
service is not configured, analysis shows a setup message before queuing a job. If captions cannot be
fetched, analysis stops with a retryable user action instead of generating a new AI transcript. The
application never requests AI transcription. Captions may be creator-provided or auto-generated by
YouTube. Expand the transcript to search and seek cues, or inspect just the selected clip's text.

**How the models cowork.** Each role goes to the model best placed for it:

| Role | Default model | What it does |
|---|---|---|
| Plan | Transcript model, low effort | Once per job, reads caption excerpts from the start, middle and end. Decides the video type, a shared label vocabulary, and whether moments are likely to be visual. |
| Transcript | `claude-opus-5`, low effort | Reads each section's captions and proposes spoken moments and topic chapters. It cites captions by index, so timestamps come from the captions, not the model. |
| Cross-check | `claude-opus-5`, medium effort | In a fresh request, keeps, revises or rejects every spoken moment against the same captions. It cannot add moments; its revisions are re-validated in code. |
| Footage | `gemini-3.8-flash` | Watches the public YouTube section for moments that are seen, shown on screen, or heard as non-speech sound. Only Gemini accepts YouTube URLs, so it is the only footage model. |

By default the cross-check is a skeptical second pass by the same model family as the transcript
reader. For a check by a different family, set `ANALYSIS_REVIEWER_MODEL` to a Gemini model (it then
uses Gemini quota). `claude-haiku-4-5` is a faster, cheaper `ANALYSIS_READER_MODEL`; the reader
decides which moments exist at all, so a weaker reader can miss moments the cross-check can't restore.

Without `ANTHROPIC_API_KEY`, Gemini runs the plan, transcript and cross-check roles as text-only
requests. If Claude rejects its key, runs out of quota or keeps failing after retries, that role moves
to the Gemini models for the rest of the job. Claude Opus 5 requests opt into Anthropic's server-side
refusal fallback (`fallbacks: "default"`), which re-runs a declined request on Anthropic's recommended
model. A request the whole chain declines fails that section; it is not resent to another provider.

**Why it is faster.** The previous pipeline sent every ten-minute section of video to Gemini twice
at high thinking, and ran the first section alone before starting the rest. Now:

- speech-led videos (podcasts, interviews, talks) whose captions cover the video skip the footage
  scan, so they use text requests only;
- a footage scan is a single pass at Gemini's default (medium) thinking and reports only visual
  moments, so it writes less;
- each section's transcript track and footage scan run at the same time, and all sections start
  together after planning, with separate request limits for Gemini and Claude.

**Run it:** add `SUPADATA_API_KEY`, `YOUTUBE_API_KEY`, and `GEMINI_API_KEY` and/or `ANTHROPIC_API_KEY` to `.env.local`, then run `npm run dev`. The
website starts the analysis worker as a separate background process through Next.js's
`instrumentation.ts` hook. Worker logs appear in the same terminal, and the worker stops when the
website stops. Restart `npm run dev` after changing keys.

To run the worker on its own instead, set `ANALYSIS_WORKER_AUTOSTART=0` and run
`npm run analysis:worker`. If no worker is running, the panel says so instead of sitting on
"Queued".

**Quality and quota.** By default videos up to two hours are split into ten-minute sections with a
10-second overlap. Each job makes one planning request. A speech-led section costs two text requests
(transcript, then cross-check); a section with a footage scan adds one Gemini video request at the same
time. `ANALYSIS_WINDOW_SECONDS` accepts 300-3600. Progress names the current phase, counts only
cross-checked sections, and shows whether footage was scanned, the models used, and the measured run
time. Transient failures retry with backoff, quota exhaustion moves a role to its next model, and failed
sections can be retried twice from the UI. If one track of a section fails, the other is cancelled.
Stored transcripts and the plan are reused on retries and restart. Opening a new video consumes API
quota automatically; cancellation stops active requests.

**Accuracy safeguards.** Transcript cues must have finite, ordered, valid source timestamps. Malformed
caption responses fail rather than being presented as complete. Transcript moments must cite captions
that exist, in order, with their evidence caption inside the moment; their timestamps are read from
those captions. The cross-check must decide on every moment, or the section is retried. Its revisions
must stay within the section, keep their evidence inside the range and overlap real captions. Boundaries
are widened by at most five seconds so a clip doesn't cut a caption in half. Footage moments must fit
their section and video, and scans with excerpt-relative timestamps are rejected rather than shifted
speculatively. Footage moments come from a single pass: text can't verify what is on screen, so preview
them. These checks do not guarantee perfect words or factual accuracy; review source playback before
using a clip. Caption text and all video content are untrusted data, never model instructions.
Highlight descriptions are paraphrases; transcript text is labeled separately. AI clip potential is not
a confidence score or replay measurement.

**Storage.** Jobs are owner-scoped (an HttpOnly cookie) under `.data/analysis` (or
`ANALYSIS_DATA_DIR`), kept for 24 hours, resumable after a worker restart, and cancellable. Jobs from
earlier analysis formats are ignored and cleaned up. Nothing downloads the YouTube stream.

**"Most replayed" is not available.** YouTube's replay heatmap is only available to a channel's owner
through the YouTube Analytics API; the public Data API doesn't expose it, and scraping it is out of
bounds for this project. Top clip candidates are labelled as AI-ranked content suggestions, not replay
statistics.

## What's implemented

1. **Search/home** — natural-language search box, five example queries, and a locally-remembered
   recent-searches list. One orchestrated entrance animation on load; respects
   `prefers-reduced-motion`.
2. **Results** — real YouTube and (optionally) Twitch search merged into one grid (via
   `/api/search`), each card labeled with its platform, with sort (relevance/newest/most viewed),
   client-side duration and source filtering, cursor-based pagination (YouTube only — Twitch's
   bounded video/clip batch is folded into page one), and honest
   empty/error/quota/setup-required/partial-provider-failure states. Query parsing tries the
   Anthropic API first (extracting subject, topic, visual requirements, and a target duration
   range), and falls back to a regex heuristic if no key is configured or the call fails.
3. **Video detail** (`/video/[provider]/[id]`) — official embedded playback for both platforms (or
   an honest "embedding disabled"/"not configured" state), source attribution with copy-link, and a
   moments panel: **Save current timestamp** captures the real YouTube player position and stores a
   `?t=`-timestamped link (Twitch playback is a plain iframe embed with no JS control API wired
   up yet, so Twitch bookmarks save the source itself); a separate field lets you paste in an
   official YouTube or Twitch Clip link rather than fabricating one. For public YouTube videos, the
   **AI video breakdown** panel adds the AI-detected video type, highlights, top clip candidates,
   and spoken topics.
4. **Collections** — saved sources grouped (per platform + video) with their timestamps/clips, plus
   your local uploads. Clicking a saved timestamp reopens the video at that exact second
   (`/video/[provider]/[id]?t=…`).
5. **Studio** — drag-and-drop upload, a real trim timeline (drag or arrow-key the handles, click to
   scrub, preview-selection playback that stops at the out point), and crop modes (Original / 9:16 /
   1:1) with manual drag-to-reposition panning, plus a "fit whole frame" alternative to hard
   cropping.
6. **Exports** — jobs queued from Studio, shown with an honest **Blocked** status and the reason
   (no processing worker connected), rather than a fake progress bar.

## What's deferred, and why

Per the delivery order, this build stops after the core workspace + real discovery + local save
flow + full trim/crop UI. Not implemented yet:

- **Auth and cloud persistence.** Everything currently lives in the browser's `localStorage` for a
  single implicit local workspace — there's no login, no multi-device sync, and no real
  `projects`/`saved_sources`/`bookmarks` tables in use. The schema for that phase is written and
  ready at `supabase/migrations/0001_init.sql`, with row-level-security policies scoped to
  `auth.uid()`, but no Supabase project is connected.
- **The FFmpeg export worker.** Trim and crop selections are fully interactive and validated
  client-side, but nothing renders an actual MP4 — there's no durable job queue, no worker process,
  and this environment doesn't even have `ffmpeg`/`ffprobe` installed. Export jobs are saved with a
  clear "blocked, worker not connected" status rather than a fabricated success or progress bar.
- **Twitch AI analysis and arbitrary remote video files.** AI analysis supports public YouTube videos
  with existing captions. Twitch playback works, but Twitch analysis needs an authorized upload path.
- **Targeted footage verification.** Footage moments come from one Gemini pass. Re-watching only short
  clips around each candidate would check them more cheaply than a second full pass, but isn't built.
- **Wider-web search beyond YouTube/Twitch**, and Kick specifically. Kick has no official public API
  for search, VODs, or clips today — only livestream/channel/chat/category/event endpoints — so
  there's no compliant way to add it yet. The source filter shows it as "coming soon" rather than
  pretending it works.
- **Twitch topic search.** Twitch's official API has no full-text "search clips/VODs by content"
  endpoint, only channel-name search, so a Twitch result means "this channel's videos and
  clips," not "a clip anywhere on Twitch about this topic." This is a platform capability gap, not a
  bug.
- **Visual scene indexing and first-party replay analytics** — explicitly later-phase per the
  product plan.

## Known limitations worth knowing about

- **Uploads are session-local.** A Studio upload becomes a browser Blob URL. It survives
  client-side navigation within the app, but a hard page refresh invalidates it (the file itself was
  never sent anywhere — nothing to persist without real storage). The UI says "for the current
  browser session" for this reason.
- **No cross-device or cross-browser sync** for anything, since there's no backend yet — everything
  is `localStorage` on one device/browser.
- **The synthetic duration/quota numbers for YouTube aren't hardcoded** — the app reads the API's
  actual error `reason` (e.g. `quotaExceeded`) rather than assuming a specific daily limit, since
  quotas can change.

## Verification performed

### Existing-captions preference - 2026-09-15

- Removed automatic AI transcription. Existing YouTube captions are now required for analysis.
- Missing `SUPADATA_API_KEY` is reported before queuing; caption retrieval failures produce a clear
  retry message and consume no Gemini transcription requests.
- Updated model contract tests to verify two analysis passes, and added missing-caption-service checks.
- All 17 analysis/API tests, TypeScript and ESLint passed.
- Live caption retrieval still requires a Supadata key; none was configured during this update.

### Automatic transcripts and clip selection - 2026-09-15 (before caption-only preference)

- Production build, TypeScript and ESLint passed. The build needed network access for Google Fonts.
- All 16 analysis/API tests passed with mocked provider responses, including original-language
  transcript parsing, invalid timing, silent ranges, speech grounding, three-pass requests,
  owner isolation, retry limits, cancellation and job restoration.
- Headless Chromium checks passed at desktop and 390px mobile widths using fixture analysis and
  a simulated YouTube player: automatic job submission, overlapping markers, edited range preview
  stopping at its end, transcript search/seek, saved ranges and reload without duplicate submission.
- Live Gemini model discovery succeeded, but transcription attempts with both `gemini-3.8-flash`
  and `gemini-3.7-flash` returned HTTP 503. A minimal video request also timed out. Real transcription
  quality and the complete live pipeline could not be verified in this session.
- Native caption retrieval was contract-tested; `SUPADATA_API_KEY` was not configured for a live check.
- The successful live checks below describe the earlier video-only implementation, before this update.

### Twitch integration update — 2026-09-14

- Production build, TypeScript check, and ESLint passed.
- All eight tests in `tests/twitch.test.cjs` passed using mocked API responses, including URL
  validation, embed parameters, metadata mapping, token reuse/refresh, missing credentials,
  rate limits, partial failures, and missing/expired videos.
- Live Twitch search and playback were not verified because credentials were not configured.
  The earlier browser checks below predate this Twitch update.

### AI breakdown refinement — 2026-09-14

- Fixed two request bugs that made every real analysis fail. The worker sent an unsupported
  `generationConfig.responseFormat` field (HTTP 400), and Gemini rejects this response schema when its
  arrays carry `maxItems`. Requests now use `responseMimeType` + `responseJsonSchema`, verified live.
- Live end-to-end runs used the real API route and worker with `GEMINI_VIDEO_MODEL=gemini-3.7-flash`,
  because testing had used up the day's free-tier quota for `gemini-3.8-flash`:
  - a 2-minute Naval Ravikant interview clip was classified as a talk, with "Hot Take" and "Advice"
    highlights and three topic chapters, in 30 s including queueing;
  - a 5-minute onboard drift video was classified as vehicles/motorsport, with "Drift" and
    "Tandem Drift" highlights backed by visual evidence, in 12 s;
  - a clipped section of a 16-minute video came back in 14 s with correct original-video timestamps.
- Headless Chrome rendered the panel with those results at 1440 px and 400 px widths, with no
  horizontal overflow, page exceptions or console errors.
- The production build, TypeScript and ESLint passed. All 11 tests in `tests/analysis.test.ts` passed
  with mocked Gemini responses, and all 8 Twitch tests still pass.
- Worker autostart, verified with `next start`: the build did not start a worker; the running server
  started one, the API reported it online, and it completed a queued job. It switched from the used-up
  `gemini-3.8-flash` quota to `gemini-3.7-flash` and retried a 503 along the way. Killing the website
  process also ended the worker, and a later worker cleared the lock it left behind. `next dev` uses the
  same hook but was not restarted here, because a dev server was already running.
- Not verified: a two-hour multi-section run, which would spend several requests of the daily quota,
  and quality on gaming or sports footage. Detection quality varies by video; suggestions are estimates.

### Earlier project verification

- `npm run build`, `npm run typecheck`, and `npm run lint` all pass clean.
- Manually drove all five routes (`/`, `/results`, `/collections`, `/studio`, `/exports`) plus a
  video detail page in a real headless-Chromium session: no console errors, no failed network
  requests, correct active-nav highlighting, correct empty/setup-required states, and a full
  upload → trim → crop → export → "job appears in Exports" pass with a synthetic test clip.
- Could not verify real YouTube search results end-to-end (no API key configured in this
  environment) — verified instead that the request/response shapes match the current
  `search.list`/`videos.list` docs and that the setup-required path renders correctly.
- Could not run an actual FFmpeg export (not implemented this phase, and `ffmpeg` isn't installed in
  this environment either) — see "What's deferred" above.
