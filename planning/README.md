# Score Scroll — Productionization Project

This folder is the **source of truth** for turning Score Scroll from a demo
(hardcoded songs, offline render) into a self-serve product where anyone can
upload their own music and play it in the browser or on Meta Ray-Ban Display
glasses.

It is structured so **multiple agents can work in parallel** without colliding.

## Read in this order
1. [`PRD.md`](./PRD.md) — product vision, the decisions already made, roadmap, metrics, legal.
2. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system design + the **shared contracts** every workstream codes against.
3. [`WORKSTREAMS.md`](./WORKSTREAMS.md) — the parallel task board: scoped units, dependencies, acceptance criteria.

## How agents coordinate

- **Claim a workstream, not a file.** Each workstream (WS-A … WS-I) owns a
  distinct area of the codebase. Pick one open workstream, comment on its
  GitHub issue to claim it, and stay inside its boundaries.
- **Code against the contracts in `ARCHITECTURE.md`, not against each other.**
  The contracts (the song-asset schema, the render module interface, the
  library/glasses API shapes) are frozen interfaces. If you need to change one,
  open a PR that edits `ARCHITECTURE.md` first and flag every dependent WS.
- **Mock across boundaries.** If your WS depends on another that isn't done,
  build against the contract with a stub. WS-B (render) and WS-D (storage/API)
  are the two everything else mocks.
- **One PR per task.** Reference the task ID (e.g. `WS-C/T3`) and its GitHub issue.
- **Update status** in `WORKSTREAMS.md` (todo → in-progress → done) in the same PR.

## Current state (starting point)
- `web/index.html` — working single-file player (menu + scroll + count-in +
  metronome + tempo + bar nav). Assumes single-line treble, 4/4, no repeats.
- `tools/render.js` — offline OSMD render (MusicXML → strip PNG + schedule JSON).
  **This logic is the keystone to move into the browser (WS-B).**
- Assets are static files in `web/assets/`. No auth, no upload, no DB.

## The keystone insight
OpenSheetMusicDisplay is a **browser** library. The entire render pipeline can
run client-side in the user's tab — no render farm. Productionization is mostly
*moving code we already have* + adding accounts, storage, and a glasses-pairing
flow around it.
