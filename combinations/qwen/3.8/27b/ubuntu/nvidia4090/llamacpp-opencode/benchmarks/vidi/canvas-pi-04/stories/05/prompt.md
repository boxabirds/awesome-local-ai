You are implementing the web app "vidi6" (a collaborative whiteboard) in the current directory, one story at a time.

This session's job: implement **story 5 — Share a board with others using a link**.

The full specification is at `spec/` (read-only; do not modify it). For this story read, in this order:
- `spec/stories/005-share-a-board-with-others-using-a-link/prd.md` — what the user must experience (requirements, exact UI text)
- `spec/stories/005-share-a-board-with-others-using-a-link/design.md` — how to build it (files, named settings, interfaces, test cases)
- `spec/stories/005-share-a-board-with-others-using-a-link/tasks.md` — the ordered tasks, each with a "Done when"

Stories already processed in this repository, in order: 1 (done), 2 (done), 3 (partial), 4 (done).
Story 3 was ended before it was complete. Tasks in its tasks.md that were not verified then: 1, 2, 3, 4, 5, 6, 7, 8, 9. Do not do those tasks for their own sake. If story 5 needs behaviour story 3 was meant to provide and it is missing, implement it to story 3's design and record it in `NOTES.md` under "Gap filled from story 3". Never stub, mock or fake product code to stand in for it.
Stories 6 and 13-17 are NOT part of this build. Where a design mentions them (presence, offline device copies, sign-in, dashboard, comments, export), leave the hook out; do not implement those stories.

Rules:
1. Follow the design: its repository layout, file names, named settings in `src/shared/config.ts`, exported interfaces, and the exact UI text and `aria-label`s the PRD and design specify.
2. Work through tasks.md in order. Write the tests the design lists (unit, component, integration, e2e) and make them pass. Do not delete or weaken tests to make them pass.
3. Before you finish, run `npm run build`, `npm run typecheck` and every `npm run test:*` script that exists, and fix failures. For e2e, Chromium is sufficient if other browsers are not installed.
4. Do not ask questions; there is nobody to answer. Make a reasonable decision, note it in `NOTES.md`, and continue.
5. When the story is complete, commit all work with git using the message `story 5: Share a board with others using a link`.
