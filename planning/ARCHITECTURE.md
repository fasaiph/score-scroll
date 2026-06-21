# Score Scroll — Architecture & Shared Contracts

These contracts are **frozen interfaces**. Every workstream codes against them and
mocks the ones it doesn't own. Changing a contract = a PR to this file first +
notify dependent workstreams.

## Target system (cheapest stack — see "Infrastructure & cost" below)

| Layer | Now | Target |
|-------|-----|--------|
| Host web + glasses app | static `index.html` | **Cloudflare Pages** (free, unlimited bandwidth, commercial-OK); app is Next.js or static SPA, web + glasses share the `<Player>` component |
| API | — | **Cloudflare Workers** (free 100k req/day, scale-to-zero) |
| Render | offline headless Chrome (`tools/render.js`) | **client-side OSMD** in a Web Worker → canvas → strip PNG + schedule ($0 compute) |
| Auth | none | **Clerk** free tier (10k MAU) or magic-links on Workers + Resend, progressive |
| Metadata | — | **Cloudflare D1** (SQLite) — users, songs, settings, schedule JSON |
| Asset storage | files in repo | **Cloudflare R2** (10 GB free, **$0 egress**) for strip PNGs |
| `.mscz` convert | local MuseScore | scale-to-zero MuseScore runner (Cloud Run / Fly stop / Vercel Sandbox), queued, **pay-per-conversion** |
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
- `stripUrl` is an R2 URL (or Supabase Storage); `schedule` may be inlined or its own URL.

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

## Infrastructure & cost

**Principle:** the render runs in the browser, so there is **$0 server compute** for
the core feature. Cost reduces to storage + DB + auth + bandwidth — all on fat free
tiers. This runs **free to thousands of users.**

**Cheapest stack (recommended): all-Cloudflare.** Cheapest at *any* scale because R2
has **zero egress fees** (egress is what makes image-serving expensive elsewhere).
- Pages (host, unlimited bandwidth, commercial-OK) · Workers (API) · R2 (strip PNGs) ·
  D1 (library + schedules) · Clerk-free or Workers-magic-links (auth).

**Simplest-cheap alternative: Supabase + Cloudflare Pages.** Folds auth + Postgres +
storage into one free tier (50k MAU, 500 MB DB, 1 GB storage) = less to wire up.
Caveats: free projects pause after ~1 week idle; 5 GB/mo egress cap (front strips
with the CF CDN to cache). Use this if dev-time matters more than the last few dollars.

**$0 MVP (defer accounts):** render in-browser, store the library in **IndexedDB on
the device** — no DB, no auth, no recurring cost. Only on "add to glasses" upload that
user's assets under a token to R2. Add accounts/DB later when users want cross-device sync.

**The one real cost = `.mscz` conversion** (needs the MuseScore binary). Launch
MusicXML-only ($0 compute); when you add `.mscz`, use a **scale-to-zero** runner so you
pay per conversion, never for idle.

> ⚠️ **Avoid Vercel for hosting if monetizing:** Vercel's free Hobby tier is
> **non-commercial** — the moment there's revenue you owe Pro ($20/mo). Cloudflare
> Pages permits commercial use on the free tier. (Vercel DX is great, just not cheapest
> once there's money.) Vercel Sandbox is still fine as a *per-invocation* `.mscz` runner.

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
