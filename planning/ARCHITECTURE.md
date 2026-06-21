# Score Scroll — Architecture & Shared Contracts

These contracts are **frozen interfaces**. Every workstream codes against them and
mocks the ones it doesn't own. Changing a contract = a PR to this file first +
notify dependent workstreams.

## Target system

| Layer | Now | Target |
|-------|-----|--------|
| App | static `index.html` | **Next.js on Vercel**; web app + glasses app share the `<Player>` component |
| Render | offline headless Chrome (`tools/render.js`) | **client-side OSMD** in a Web Worker → canvas → strip PNG + schedule |
| Auth | none | magic-link / Google (Clerk or equivalent), progressive |
| Metadata | — | Postgres / Neon (users, songs, settings) |
| Asset storage | files in repo | Vercel Blob (strip PNGs + schedule JSON) |
| `.mscz` convert | local MuseScore | containerized MuseScore worker (Fly/Railway) or Vercel Sandbox, queued |
| Glasses delivery | one static URL | per-user **tokened** manifest served from the edge |

## Contract 1 — Song Asset (the heart of the system)
Output of the render pipeline; consumed by the player, storage, and glasses.
Already exists in `web/assets/*.json` — formalized here.

```jsonc
// schedule.json
{
  "id": "string",            // stable asset id
  "title": "string",
  "instrument": "violin",    // enum; drives renderer/layout
  "key": "G major",          // optional, display only
  "bpm": 120,                // default tempo (from MusicXML if present)
  "beatsPerBar": 4,
  "countIn": 4,              // lead-in beats
  "widthPx": 2833,           // native strip dimensions
  "heightPx": 210,
  "points": [                // note onsets, ascending by beat
    { "beat": 0.0, "x": 171, "rest": true },
    { "beat": 0.5, "x": 240, "rest": false }
  ]
}
```
- Paired with `strip.png`: white-on-black horizontal notation, `heightPx` tall.
- **Invariant:** `points` ascending by `beat`; player interpolates x linearly
  between them and extrapolates past the ends.

## Contract 2 — Render module (WS-B owns; everyone mocks)
A pure-ish browser function. No DOM assumptions beyond an offscreen canvas.

```ts
type RenderResult = { strip: Blob /* image/png */, schedule: Schedule };
type RenderOpts = { instrument?: string; bpm?: number; part?: number; countIn?: number };

// Parses MusicXML, renders single horizontal staff, inverts to white-on-black,
// extracts (beat -> x). Runs in a Web Worker. Throws RenderError with a
// user-facing message on unsupported files.
async function renderMusicXML(xml: string, opts?: RenderOpts): Promise<RenderResult>;

// Lists parts/staves so the UI can show a picker before final render.
async function listParts(xml: string): Promise<{ index: number; name: string }[]>;
```

## Contract 3 — Library / song API (WS-D owns)
```
POST /api/songs            body: { schedule, stripBlob } (multipart)  -> { id }
GET  /api/songs            -> [{ id, title, instrument, createdAt }]
GET  /api/songs/:id        -> { schedule, stripUrl }
PATCH/DELETE /api/songs/:id
GET  /api/me               -> { userId | null, plan }
```
- Anonymous users: assets keyed to an anon session id; claimable on sign-in.
- `stripUrl` is a Vercel Blob URL; `schedule` may be inlined or its own URL.

## Contract 4 — Glasses delivery (WS-E owns)
```
GET /g/:token              -> the glasses web app, scoped to that user's library
GET /api/g/:token/library  -> [{ id, title, instrument }]  (read-only, token-auth)
```
- `:token` is a long, unguessable per-user token (revocable). No login on-device.
- The glasses app is the existing menu+player, fed by the manifest. Adding a song
  on web makes it appear here on next open — **no re-pairing.**
- Pairing UX: web shows the URL + a QR (`fb-viewapp://web_app_deep_link?...&appUrl=<g-url>`).

## Contract 5 — Player component (WS-A owns)
`<Player schedule stripUrl onTempoChange ... />` — shared by web and glasses
routes. Pure rendering + the existing scroll/clock/metronome/count-in logic
lifted out of `index.html`. Input layer maps arrow keys + Enter (glasses) and
on-screen controls (web) to the same actions.

## Glasses runtime constraints (apply to anything rendered on-device)
- 600×600 viewport, `overflow:hidden`, `<meta name="mrbd-web-app-capable" content="yes">`.
- Additive display: black = transparent → light-on-dark UI; sheet music inverted.
- Input is arrow keys + Enter only (Neural Band). No cursor/touch.
- Served over public HTTPS.

## Repo / module boundaries (minimize merge conflicts)
```
app/                 Next.js routes (WS-A)
  (web)/             browser app + upload UI
  g/[token]/         glasses app
  api/               route handlers (WS-D, WS-E)
packages/
  player/            shared <Player> + scroll engine (WS-A)
  render/            renderMusicXML / listParts (WS-B)
  parse/             MusicXML normalization: parts, repeats, tempo (WS-C)
workers/
  mscz/              MuseScore conversion service (WS-F)
infra/               auth, db schema, blob helpers (WS-D)
```
