# Score Scroll — Workstreams (parallel task board)

> **🚀 MVP SHIPPED → https://score-scroll-app.vercel.app** (code in `app/`).
> Upload MusicXML → renders **in the browser** (keystone proven) → plays → saved
> to a local IndexedDB library. No server, no accounts. Done: WS-B core, WS-A
> player/input, WS-C/T1 upload, WS-D via IndexedDB ($0 path). Next: WS-C robustness
> (parts/repeats/tempo), WS-D cloud sync, WS-E per-user glasses URL.
> _(MVP is on Vercel for speed; production host → Cloudflare Pages per D7.)_


Each workstream owns a distinct module (see `ARCHITECTURE.md` → boundaries) so
agents can work in parallel. Status legend: `todo` · `wip` · `done`. Update the
status inline in the PR that touches the task.

**Dependency-free starters (begin immediately):** WS-B, WS-A, WS-D.
WS-B (render) and WS-D (storage/API) are mocked by everyone — prioritize their
contracts landing first.

---

## WS-A — App shell & shared player · `app/js/player.js`, `app/`
Reusable scroll engine + app shell. **Player DONE in MVP** (`SS.Player`).
- A/T1 `todo` — Next.js/SPA on **Cloudflare Pages** scaffold + `g/[token]` route (MVP is static on Vercel).
- A/T2 `done` — scroll/clock/metronome/count-in/bar-nav extracted into `SS.Player` (Contract 5).
- A/T3 `done` — Input layer: arrow-keys+Enter (glasses) and on-screen clicks (web) → same actions.
- A/T4 `done` — Player loads a song by schedule (+ live notation element).

## WS-B — In-browser render (KEYSTONE) · `app/js/render.js`
Move `tools/render.js` logic into the browser (Contract 2). **DONE in MVP** (`SS.render`).
- B/T1 `done` — OSMD single-horizontal-staff render runs in the browser.
- B/T2 `n/a` — No raster: the player scrolls the rendered DOM element directly (cheaper).
- B/T3 `done` — `(beat → x)` schedule via cursor walk; emits Contract 1.
- B/T4 `wip` — `RenderError` with user-facing messages done; `listParts()` picker → todo (with WS-C/T2).
- B/T5 `done` — Verified live: in-browser render of both samples + an uploaded file.
- **Optional later:** move render into a Web Worker if main-thread jank appears on big scores.

## WS-C — Upload & MusicXML robustness · `packages/parse`
Normalize real-world files before render (the 60% unglamorous work).
- C/T1 `done` — Upload UI: accept `.musicxml/.xml/.mxl`; validation + error toasts. (drag-drop + `.mid` → todo)
- C/T2 `todo` — Multi-part → part/staff picker (feeds WS-B `listParts`).
- C/T3 `todo` — Unroll repeats / D.C. / D.S. / coda into a linear stream.
- C/T4 `todo` — Handle tempo changes & time-signature changes.
- C/T5 `todo` — Pickup (anacrusis) bars, key changes, multi-page.
- C/T6 `todo` — MIDI import (tempo + notes) path.
- **Done when:** the priority-ordered cases render correctly or fail with a clear message.

## WS-D — Auth, data model & storage · `infra/`, `app/api`
Progressive auth + library API (Contracts 3). Cheap stack: Clerk-free/Workers-auth +
**D1** (metadata) + **R2** (assets). **$0-MVP step DONE:** `app/js/library.js` =
IndexedDB-only (no DB/auth), stores MusicXML text + re-renders on open.
- D/T1 `todo` — Magic-link / Google auth (Clerk free or Workers + Resend); anonymous session id.
- D/T2 `todo` — D1 schema (users, songs, settings); R2 bucket for strip PNGs.
- D/T3 `todo` — `/api/songs` CRUD + `/api/me` (Cloudflare Workers).
- D/T4 `todo` — Claim-on-signup: migrate anon assets to the new account.
- **Done when:** a song uploaded anonymously survives sign-in and lists across devices.

## WS-E — Glasses delivery & pairing · `app/g/[token]`, `app/api/g`
Tokened per-user URL + QR; configure-on-web/consume-on-glasses loop (Contract 4).
- E/T1 `todo` — Per-user revocable token + `/api/g/:token/library`.
- E/T2 `todo` — `g/[token]` serves the glasses app fed by the manifest.
- E/T3 `todo` — "Add to glasses" UI: URL + QR (`fb-viewapp://...`) + instructions.
- E/T4 `todo` — Verify constraints on-device (600×600, additive, arrow-keys). No re-pairing on library change.
- **Done when:** adding a song on web appears on the paired glasses with no re-add.

## WS-F — `.mscz` conversion worker · `workers/mscz`
- F/T1 `todo` — **Scale-to-zero** MuseScore (+ Xvfb) runner (Cloud Run / Fly stop / Vercel Sandbox): `.mscz → MusicXML`. Pay-per-conversion, never idle.
- F/T2 `todo` — Upload queue + status; hand MusicXML to the WS-B path.
- **Done when:** a `.mscz` upload yields the same result as its MusicXML export.

## WS-G — Practice tools · `packages/player` (additive)
- G/T1 `todo` — Loop a section (set in/out bars).
- G/T2 `todo` — Slow-down trainer (tempo % independent of notation).
- G/T3 `todo` — Transpose; per-song persisted settings.
- G/T4 `todo` — Setlists / gig mode ordering.

## WS-H — Legal, ToS & analytics · cross-cutting
- H/T1 `todo` — ToS + upload-rights attestation gate; DMCA agent + takedown flow.
- H/T2 `todo` — Private-by-default enforcement (no public asset URLs leaking).
- H/T3 `todo` — Analytics events: activation, glasses-attach, retention, upload-failure-by-type.

## WS-I — Guitar / tabs / chords+lyrics (Phase 3) · `packages/render` (new renderer)
- I/T1 `todo` — Tab + chord/lyric renderer (ChordPro / Guitar Pro import) — separate from notation.
- I/T2 `todo` — Lyrics/vocals scroll mode.
- **Note:** different rendering model than staff notation; scope as its own project.

---

## Suggested first sprint (Phase 1 MVP)
Parallel: **WS-B** (render keystone) · **WS-A/T1-T2** (shell + player) · **WS-D/T1-T3** (auth + API).
Then converge: **WS-C/T1-T2** (upload + part picker) → **WS-E** (glasses URL). Ship.
