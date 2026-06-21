# Score Scroll — PRD

## Vision
**Auto-scrolling, beat-locked sheet music for any screen — and a magic trick on
your glasses.** Upload a score, and every note crosses a fixed playhead exactly
on the beat. Practice on a laptop/tablet today; the Meta Ray-Ban Display is the
wow-factor and differentiator, not the only target.

**Strategic reframe:** this is *not* a glasses app. The scroller is useful on any
screen now, so the TAM is **every musician who practices**, not just Display
owners. Web-first, glasses as the halo. De-risks us from one hardware platform.

## Decisions already made (ADR-style)

| # | Decision | Why |
|---|----------|-----|
| D1 | **Web-first**, glasses as halo | Bigger TAM; the scroller works on any screen; single hardware bet is risky |
| D2 | **Render in the browser** (client-side OSMD) | OSMD is JS; removes the render-farm bottleneck; marginal cost per upload ≈ $0 |
| D3 | **MusicXML/MXL is the happy path**, not `.mscz` | Universal export; OSMD parses it in-browser with no server. `.mscz` needs the MuseScore binary → V2 server worker |
| D4 | **Progressive auth** — anonymous to try, account to persist/sync/glasses | Protect the activation moment; only gate persistence and the glasses URL |
| D5 | **Private-locker model** — everything private, no public score sharing in V1 | A personal storage tool for content you own is low legal risk; a distribution platform is high risk |
| D6 | **Configure on the big screen, consume on the glasses** | No keyboard on glasses; build library on web/phone, push via a tokened personal URL |
| D7 | **All-Cloudflare infra** (Pages + Workers + R2 + D1); avoid Vercel for hosting | Cheapest at any scale — R2 has $0 egress; CF Pages is commercial-OK on free tier (Vercel Hobby is non-commercial). Browser render = $0 compute. See `ARCHITECTURE.md` → Infrastructure & cost |

## Answering the two open questions
- **Upload format:** Accept **MusicXML / MXL** (and MIDI) directly, parsed
  in-browser. Tell users *"Export your score as MusicXML."* Support `.mscz` via a
  server worker in V2.
- **Accounts:** Progressive. **No account to try** (land → upload → play). Account
  required only to (a) save a cross-device library and (b) get a stable glasses
  URL. Magic-link / Google, no passwords.

## Roadmap (phased)
- **Phase 1 — Self-serve MVP:** in-browser render, MusicXML upload, part picker,
  library, add-to-glasses URL + QR, anonymous-first auth. → WS-A, WS-B, WS-C(core), WS-D, WS-E.
- **Phase 2 — Robust & sticky:** repeats/multi-part/tempo & key changes,
  practice tools (loop, slow-down, transpose), `.mscz` worker, account sync. → WS-C(full), WS-F, WS-G.
- **Phase 3 — Expand instruments:** guitar tabs + chords/lyrics (different
  renderer — real work), vocals/lyrics scroll, multi-instrument. → WS-I.
- **Phase 4 — Platform:** setlists/gig mode, MIDI/foot-pedal control, mobile
  companion, *carefully-licensed* shared library, teacher/team accounts.

## MVP scope (ruthless)
In: MusicXML upload → in-browser render → play (browser) → save (optional auth) →
add-to-glasses URL + QR; library list/rename/delete; auto-read tempo w/ BPM
fallback; part/staff picker.
Out (MVP): guitar, sharing, `.mscz`, practice tools, mobile app.

## Robustness gap (will generate support tickets)
Current code assumes single-line treble, 4/4, no repeats, steady tempo. Real
uploads break this. Priority order: (1) multi-part → part picker, (2) repeats /
D.C. / D.S. / coda → unroll to linear, (3) tempo & time-sig changes, (4) pickup
bars / key changes / multi-page, (5) graceful failure with a clear message.

## Business model
Freemium, metered on library size + practice power.
- **Free:** a few songs, browser + glasses, core scroller.
- **Pro (~$5–8/mo):** unlimited library, cross-device sync, practice tools,
  `.mscz` upload, backing tracks.
- Glasses crowd = small, high-intent, press-worthy. Browser/tablet musicians =
  the volume. Price for the volume.

## Legal (see D5)
Private by default; ToS + upload-rights attestation; DMCA agent + takedown flow;
do not index/expose uploads. Sharing (Phase 4) is a legal project, not a feature.

## Metrics (instrument from day one)
- **Activation:** % visitors who upload *and* hit play (the true aha).
- **Glasses attach:** % of accounts that add the glasses URL.
- **Retention:** weekly practice sessions / plays per user.
- **Funnel drop:** upload failures by file type → tells us what to fix next.

## First three things to build
1. Move OSMD render into the browser (WS-B).
2. Generic upload → render → play loop with **no signup wall** (WS-A + WS-C core).
3. Tokened per-user glasses URL + QR (WS-E).
