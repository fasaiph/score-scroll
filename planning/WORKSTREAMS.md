# Score Scroll — Workstreams (parallel task board)

Each workstream owns a distinct module (see `ARCHITECTURE.md` → boundaries) so
agents can work in parallel. Status legend: `todo` · `wip` · `done`. Update the
status inline in the PR that touches the task.

**Dependency-free starters (begin immediately):** WS-B, WS-A, WS-D.
WS-B (render) and WS-D (storage/API) are mocked by everyone — prioritize their
contracts landing first.

---

## WS-A — App shell & shared player · `packages/player`, `app/`
Lift the working scroll engine out of `index.html` into a reusable `<Player>`;
stand up the Next.js shell with web + glasses routes.
- A/T1 `todo` — Next.js on Vercel scaffold; web route + `g/[token]` route.
- A/T2 `todo` — Extract scroll/clock/metronome/count-in/bar-nav into `<Player>` (Contract 5).
- A/T3 `todo` — Input layer: arrow-keys+Enter (glasses) and on-screen controls (web) → same actions.
- A/T4 `todo` — Wire `<Player>` to load a song by `{schedule, stripUrl}`.
- **Done when:** an existing song plays identically to today via the new component on both routes.

## WS-B — In-browser render (KEYSTONE) · `packages/render`
Move `tools/render.js` logic into the browser/Web Worker (Contract 2).
- B/T1 `todo` — Port OSMD single-horizontal-staff render to run in a Worker.
- B/T2 `todo` — Capture inverted white-on-black strip PNG from canvas (no headless Chrome).
- B/T3 `todo` — Extract `(beat → x)` schedule via cursor walk; emit Contract 1 JSON.
- B/T4 `todo` — `listParts()` for the part picker; `RenderError` with user-facing messages.
- B/T5 `todo` — Parity test: browser output matches `tools/render.js` for the two demo songs.
- **Done when:** `renderMusicXML(xml)` returns a valid strip+schedule entirely client-side.

## WS-C — Upload & MusicXML robustness · `packages/parse`
Normalize real-world files before render (the 60% unglamorous work).
- C/T1 `todo` — Upload UI: accept `.musicxml/.mxl/.mid`; drag-drop; validation + errors.
- C/T2 `todo` — Multi-part → part/staff picker (feeds WS-B `listParts`).
- C/T3 `todo` — Unroll repeats / D.C. / D.S. / coda into a linear stream.
- C/T4 `todo` — Handle tempo changes & time-signature changes.
- C/T5 `todo` — Pickup (anacrusis) bars, key changes, multi-page.
- C/T6 `todo` — MIDI import (tempo + notes) path.
- **Done when:** the priority-ordered cases render correctly or fail with a clear message.

## WS-D — Auth, data model & storage · `infra/`, `app/api`
Progressive auth + library API (Contracts 3).
- D/T1 `todo` — Magic-link / Google auth; anonymous session id.
- D/T2 `todo` — Postgres schema (users, songs, settings); Vercel Blob for assets.
- D/T3 `todo` — `/api/songs` CRUD + `/api/me`.
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
- F/T1 `todo` — Containerized MuseScore (+ Xvfb) service or Vercel Sandbox: `.mscz → MusicXML`.
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
