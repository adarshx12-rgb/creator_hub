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
- Twitch Helix API (optional) as a second discovery source — channel search plus that channel's
  official Clips, embedded via Twitch's own clip player
- Anthropic API (optional) for LLM-based query understanding, with a regex heuristic fallback
- Browser `localStorage` for saved moments, recent searches, uploads, and export jobs (see
  limitations below)
- A Supabase schema migration for the future auth/projects/transcripts phase (not yet applied to a
  live project)

## Local setup

Requires Node 20+.

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
| `ANTHROPIC_API_KEY` | Smarter query parsing (subject/topic/duration extraction) | Falls back to a regex heuristic parser — search still works |
| `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET` | Twitch as a second discovery source | Twitch results are simply omitted with a "Twitch isn't configured yet" notice; YouTube keeps working |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | Not used yet | No effect — reserved for the auth/projects phase |

Get a YouTube key from the [Google Cloud Console](https://console.cloud.google.com/) with the
**YouTube Data API v3** enabled. The API has a daily quota; when it's exhausted the app shows a
"daily search limit reached" state rather than failing silently.

Get a free Twitch client ID/secret from the [Twitch Developer Console](https://dev.twitch.tv/console/apps).
Twitch has no full-text "search by topic" API — only channel-name search — so Twitch results only
appear when the parsed query names something close to a real channel/person; it then lists that
channel's existing official Clips (a Clip is a moment someone already created and shared, which is
exactly the "point to the source's own re-use path" pattern used for YouTube). **Kick is not
integrated**: Kick currently has no official public API for search, VODs, or clips, so there is
nothing to wire up without resorting to scraping or an unofficial third-party API, which this
project does not do.

### Other scripts

```bash
npm run build       # production build
npm run start        # run the production build
npm run lint          # eslint
npm run typecheck  # tsc --noEmit
```

## What's implemented

1. **Search/home** — natural-language search box, five example queries, and a locally-remembered
   recent-searches list. One orchestrated entrance animation on load; respects
   `prefers-reduced-motion`.
2. **Results** — real YouTube and (optionally) Twitch search merged into one grid (via
   `/api/search`), each card labeled with its platform, with sort (relevance/newest/most viewed),
   client-side duration and source filtering, cursor-based pagination (YouTube only — Twitch has no
   page-token pagination of its own, so its clips are folded into page one), and honest
   empty/error/quota/setup-required/partial-provider-failure states. Query parsing tries the
   Anthropic API first (extracting subject, topic, visual requirements, and a target duration
   range), and falls back to a regex heuristic if no key is configured or the call fails.
3. **Video detail** (`/video/[provider]/[id]`) — official embedded playback for both platforms (or
   an honest "embedding disabled"/"not configured" state), source attribution with copy-link, and a
   moments panel: **Save current timestamp** captures the real YouTube player position and stores a
   `?t=`-timestamped link (Twitch clip playback is a plain iframe embed with no JS control API wired
   up yet, so Twitch bookmarks save the source itself); a separate field lets you paste in an
   official YouTube or Twitch Clip link rather than fabricating one. Topic chips are intentionally
   absent here with an explanation — they'd require transcript access this build doesn't have.
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
- **Transcript-based AI moments and topic chips.** These require authorized access to a video's
  audio/transcript, which this build doesn't have for source-only YouTube discovery results.
- **Wider-web search beyond YouTube/Twitch**, and Kick specifically. Kick has no official public API
  for search, VODs, or clips today — only livestream/channel/chat/category/event endpoints — so
  there's no compliant way to add it yet. The source filter shows it as "coming soon" rather than
  pretending it works.
- **Twitch topic search.** Twitch's official API has no full-text "search clips/VODs by content"
  endpoint, only channel-name search, so a Twitch result only ever means "this channel's existing
  Clips," not "a clip anywhere on Twitch about this topic." This is a platform capability gap, not a
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
