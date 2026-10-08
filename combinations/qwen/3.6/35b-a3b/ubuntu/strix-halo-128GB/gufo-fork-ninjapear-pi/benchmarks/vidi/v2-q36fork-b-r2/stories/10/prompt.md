You are implementing the web app "vidi6" (a collaborative whiteboard) in the current directory, one story at a time.

This session's job: implement **story 10 — Draw shapes and connect them with arrows that follow when moved**.

The full specification is at `spec/` (read-only; do not modify it). For this story read, in this order:
- `spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/prd.md` — what the user must experience (requirements, exact UI text)
- `spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/design.md` — how to build it (files, named settings, interfaces, test cases)
- `spec/stories/010-draw-shapes-and-connect-them-with-arrows-that-foll/tasks.md` — the ordered tasks, each with a "Done when"

Stories already processed in this repository, in order: 1 (done), 2 (partial), 3 (partial), 4 (partial), 5 (partial), 7 (done), 8 (done), 9 (done).
Story 2 was ended before it was complete. Tasks in its tasks.md that were not verified then: 4, 5, 6, 7, 8. Do not do those tasks for their own sake. If story 10 needs behaviour story 2 was meant to provide and it is missing, implement it to story 2's design and record it in `NOTES.md` under "Gap filled from story 2". Never stub, mock or fake product code to stand in for it.
Story 3 was ended before it was complete. Tasks in its tasks.md that were not verified then: 1, 2, 3, 4, 5, 6, 7, 8, 9. Do not do those tasks for their own sake. If story 10 needs behaviour story 3 was meant to provide and it is missing, implement it to story 3's design and record it in `NOTES.md` under "Gap filled from story 3". Never stub, mock or fake product code to stand in for it.
Story 4 was ended before it was complete. Tasks in its tasks.md that were not verified then: 1, 2, 3, 4, 5, 6, 7, 8, 9. Do not do those tasks for their own sake. If story 10 needs behaviour story 4 was meant to provide and it is missing, implement it to story 4's design and record it in `NOTES.md` under "Gap filled from story 4". Never stub, mock or fake product code to stand in for it.
Story 5 was ended before it was complete. Tasks in its tasks.md that were not verified then: 1, 2, 3, 4, 5, 6, 7. Do not do those tasks for their own sake. If story 10 needs behaviour story 5 was meant to provide and it is missing, implement it to story 5's design and record it in `NOTES.md` under "Gap filled from story 5". Never stub, mock or fake product code to stand in for it.
Stories 6 and 13-17 are NOT part of this build. Where a design mentions them (presence, offline device copies, sign-in, dashboard, comments, export), leave the hook out; do not implement those stories.

Rules:
1. Follow the design: its repository layout, file names, named settings in `src/shared/config.ts`, exported interfaces, and the exact UI text and `aria-label`s the PRD and design specify.
2. Work through tasks.md in order. Write the tests the design lists (unit, component, integration, e2e) and make them pass. Do not delete or weaken tests to make them pass.
3. Before you finish, run `npm run build`, `npm run typecheck` and every `npm run test:*` script that exists, and fix failures. For e2e, Chromium is sufficient if other browsers are not installed.
4. Do not ask questions; there is nobody to answer. Make a reasonable decision, note it in `NOTES.md`, and continue.
5. When the story is complete, commit all work with git using the message `story 10: Draw shapes and connect them with arrows that follow when moved`.

After that commit, run `git rev-parse HEAD` and end your final reply with exactly this line: STORY 10 DONE <commit hash>. The story is not finished until you have sent it. `spec/` is read-only: you cannot change it, and the Status column in tasks.md is not yours to update. Track your progress on the tasks in `PROGRESS.md` (todo, doing, done, blocked). Every server you start (a dev server, `wrangler dev` and its inspector port, a test's web server) must listen on a port from $AGENT_PORT_FIRST to $AGENT_PORT_LAST (environment variables: 16 ports, yours alone); other ports may be refused.
