# Story 4: the Flash-Next agent's own final statements

The last three substantive assistant messages of the story's pi session, verbatim apart from local paths. The session may continue after nudges, so read them as the agent's claims at the end.

Probe result is decisive: the note moved only 12.5 screen px for a 100 px pointer drag at zoom 2 (it does **not** stay under the pointer) — a real zoom bug in the drag maths, not a wrong expectation. Let me find the code:

---

Formula at `StickyNote.tsx:146` is correct (`dx / zoom`), so the bug is elsewhere — the drag only *tracked* 12.5 of 100 px. One more probe to separate "overlap steals the drag" from "zoom breaks tracking":

---

Story 4 is finished and the suite is back to a clean baseline. Final state:

**Verification (all from the project's own entry points)**
- `npm run typecheck` — clean on both tsconfigs (client + worker).
- `npm test` — **215/215** across 21 files (unit, component, integration).
- `npm run test:e2e` — **60 passed, 3 failed**. All 15 Story-4 tests pass in chromium, Firefox and WebKit; TC-21's real board-open time after a SIGKILL + restart is 175–220 ms for 2 000 notes (budget 3 000 ms).

**The one real bug I found this stretch was in my own test harness, not the app.** Persistence tests used fixed ports; Playwright runs the three browser projects concurrently, so a test could attach to *another browser's* server (readiness only checked "some server answers 200"), which then legitimately showed an empty board — a `Received: 0` that looked exactly like lost persistence. Fixed by OS-assigned ports plus a proof that the server answering is *our* child process; a lost port race now fails loudly instead of silently reading foreign state.

**TC-32 (the 3 remaining failures) is pre-existing and outside Story 4**, and I verified rather than assumed:
- It fails with identical numbers when `StickyNote.tsx` and `styles.css` are reverted to HEAD.
- The drag-to-world maths (`dx / zoom` at `src/client/objects/StickyNote.tsx:146`) is **correct** — a throwaway probe moving one unobstructed note 100 screen px at 200 % zoom gave exactly (+50, +25) world.
- The failure only appears in TC-32's two-overlapping-notes setup, where the note tracks ~1/8 of the pointer distance; that points at z-order / pointer-capture interaction from stories 1–2. I stopped there deliberately: it is not this story, and I did not bend the test's expectation to make the suite look green.

**Worth knowing for the next story:** at HEAD the Worker could not start at all — `wrangler.jsonc` declared `ROOM_PATH_PREFIX` as a bare string in `vars`, which workerd rejects ("Incorrect type for map entry"), so no e2e test was runnable before this work. That is fixed, which is why the persistence suite is the first to actually exercise the real Worker + real SQLite + real WebSockets.

Diagnostic probes were deleted; the only files in the tree are Story-4 work.
