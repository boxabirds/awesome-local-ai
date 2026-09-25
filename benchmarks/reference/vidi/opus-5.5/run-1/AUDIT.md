# Delivery audit: Claude Opus 5.5 reference

This audit uses the rubric in [`benchmarks/vidi/audit.md`](../../../../vidi/audit.md). Four auditors (fresh Opus 5.5 subagents) each covered a group of stories. They checked every task, every design test case and every PRD requirement against the code, triaged each held-out failure, and compared the agent's own completion claims with what they found. They used code reading, the held-out results, and their own runs in scratch copies.

One reviewer then applied a single standard across **both** setups:
- only faults present in the **delivered** (final) code count; faults fixed in a later story are listed separately;
- severities were calibrated;
- rows with the same root cause were merged;
- each setup was checked for the other's weak-test patterns;
- process breaches (a story never committed, tests not written first) were counted the same way for both.

**Held-out suite (fixed):** 71–73/75 over three full runs (73, 72, 71); the official `accept.json` is 71/75.
**Agent completion claims:** 0 false or overstated.

## Head to head (same rubric, same reviewer)

| Counted rows, total (high/medium/low) | Opus 5.5 reference | Flash-Next canvas-pi-01 |
|---|---|---|
| **functional** | 4 (0/3/1) | 33 (2/20/11) |
| false-claim | 0 (0/0/0) | 13 (1/5/7) |
| missing-test | 1 (0/0/1) | 27 (0/17/10) |
| weak-test | 2 (0/0/2) | 34 (0/11/23) |
| design-deviation | 10 (0/0/10) | 20 (0/0/20) |
| held-out suite (fixed) | 71–73/75 | 60/75 |

Functional faults per story:

| Story | 1 | 2 | 3 | 4 | 5 | 7 | 8 | 9 | 10 | 11 | 12 | Total |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Opus 5.5 | 0 | 1 | 0 | 1 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | **4** |
| Flash-Next | 0 | 1 | 2 | 2 | 1 | 7 | 1 | 2 | 1 | 3 | 13 | **33** |

## Counted faults, one per row

| # | Story | Category | Severity | Requirement | Discrepancy | Evidence |
|---|---|---|---|---|---|---|
| 1 | 2 | functional | medium | sticky.delete, sel.group_delete, sel.nudge | Delete/Backspace and arrow-key nudges are ignored whenever a button has keyboard focus (e.g. right after clicking a colour swatch on the selected note), because the board key handler returns early for any BUTTON target; the PRD (sticky.delete, sel.group_delete, sel.nudge) only exempts editing, form fields and a read-only board. | src/client/board/useBoardKeys.ts:53-56 isButtonTarget and :141 `if (isButtonTarget(e.target)) return;` (present since 0d03e2b src/client/App.tsx:36 isInteractiveTarget includes 'BUTTON'); held-out story-02 'golden path: create, type, select, recolour, delete' and story-03 'create, type, move, recolo |
| 2 | 4 | functional | medium | persist.partial_damage | One damaged log row loses every later saved change by the same author (Yjs keeps them pending behind the missing clock), not 'only that one change'. The TC-09 fixture writes each change from a fresh Yjs client, so the test can't expose this. | src/worker/board-store.ts:174-187 @95d5890 (quarantine then continue applying rows); NOTES.md:221-224 admits it; tests/fixtures/boards.ts LogBuilder.step (new Y.Doc per change) @95d5890; own-run on the build machine with the workspace's yjs: 10 single-author updates, update 7 truncated -> quarantine |
| 3 | 11 | functional | medium | pen.smooth | The finished stroke is drawn as midpoint quadratic curves through the simplified points, which cut corners well beyond the 1 screen px limit (a clean right-angle 'L' with 100 px arms, simplified to 3 points, renders a curve 12.5 px from the drawn path); only the stored vertices, not the finished stroke, stay within tolerance, and NOTES.md acknowledges the curve 'can cut slightly inside at sharp corners'. | src/shared/geometry/simplify.ts:91-104 (smoothPath: M p0, Q p[i] mid(p[i],p[i+1]), L pn) rendered by src/client/objects/StrokeObject.tsx:39,63; tolerance only enforced on raw points vs simplified polyline in simplify.ts:28-55 and tests/unit/stroke.test.ts:55-74 |
| 4 | 9 | functional | low | text.auto_width | Once auto-width text wraps, its box is the widest wrapped line plus padding instead of 600 units, so a 300-character sentence gets a 549.9-unit box where the PRD verification and TC-08/TC-26 expect 600. | src/client/objects/textLayout.ts:161-162 (width = min(longest wrapped line + TEXT_AUTO_WIDTH_PADDING_WORLD, 600)); own run: 50 words 'word0 … word9' (299 chars) at size M stored width 549.94, 7 lines |
| 5 | 3 | missing-test | low | TC-30 (task 9) | Task 9's nightly e2e teardown check (closing each context calls destroy() and no reconnect attempts follow) is not in the nightly e2e; it was replaced by a jsdom component test with a fake provider, i.e. a different layer (disclosed by the agent). | tests/e2e/live-collaboration.nightly.spec.ts:100 (TC-30 has no teardown assertion); substitute tests/component/ConnectionStatus.test.tsx:210 'unmount destroys the provider and emits nothing afterwards'; agent-reports/story-03.md 'Left undone' |
| 6 | 1 | weak-test | low | TC-07 | The TC-07 test ('a viewport size change does not alter the camera') builds a resized viewport but never passes it to anything, then compares worldToScreen(cam, p) with itself, so it cannot fail. | tests/unit/camera.test.ts:111-122 @00cefee (`resized` only asserted != VIEWPORT; `worldToScreen(cam, worldPoint)` compared with the same call) |
| 7 | 3 | weak-test | low | task 5 (TC-05, TC-06; SELF.fetch boundary) | TC-05 and TC-06 call the imported handler (worker.fetch) instead of going through the configured Worker with SELF.fetch as the design requires, so TC-06 checks the Worker's own env.ASSETS.fetch fallback rather than the assets-layer SPA routing that serves /b/* when deployed. | tests/integration/worker.test.ts:7 (import worker), :35-48 @00cefee; wrangler.jsonc assets.run_worker_first (/api/*, /__test/* only); src/worker/index.ts:107 |
| 8 | 4 | design-deviation | low | TC-25 | Opening a board in a browser writes a log row, because useBoardDoc runs initDoc (meta.schemaVersion) on an empty doc before sync. The design's negative case says opening must create only tables. TC-25 passes because it uses a sync-only test client, not the real page. | src/client/board/useBoardDoc.ts:50 and src/shared/board-model.ts:71-75 @95d5890; tests/integration/board-store.test.ts:266 (join() client, not the app); NOTES.md 'Opening a board writes one tiny row' |
| 9 | 5 | design-deviation | low | task 1 | The test-first task's 'Done when' (suite compiles and fails only with 'not implemented' before the implementation) was not met: the implementation was written before its tests and no red run against stubs was observed. | NOTES.md story 5 'Red phase' (unit tests not observed failing against a stub; createWithRetries implemented in the same step); agent-reports/story-05.md 'Red phase: the new unit tests were not seen failing before the implementation' |
| 10 | 7 | design-deviation | low | Tasks 6, 7, 9 | The test-first tasks' 'Done when' (suites fail against 'not implemented' stubs before implementation) was not met; tests were written after the code and only mutation-checked. | NOTES.md story 7 'Red phase not observed'; agent-reports/story-07.md 'Left undone' bullet 3 |
| 11 | 9 | design-deviation | low | Tasks 1, 3 | The test-first tasks' 'Done when' (suites fail against stubs before implementation) was not met; the text model and layout tests were first run against the finished code. | NOTES.md story 9 'Red phase not observed'; agent-reports/story-09.md 'Left undone' bullet 3 |
| 12 | 10 | design-deviation | low | task 7, task 9 | The 'Done when' for the test-first tasks (suites compile and fail only with 'not implemented', committed before the implementation) was not met: tests and implementation landed together and were never run against stubs (mutation checks were substituted). | git show eb62a2d --stat (tests/unit/shape-model.test.ts, connector-model.test.ts and src/shared/objects/shape.ts, connector.ts in one commit); agent-reports/story-10.md 'Left undone: Test-first order' |
| 13 | 10 | design-deviation | low | shape.ui | The shape label is an HTML box layered over the SVG instead of the design's SVG foreignObject; wrapping and centring still work. | src/client/objects/ShapeObject.tsx:207-209 (div.shape-object__label-box / shape-label); design.md shape.ui Outputs 'centred label in a foreignObject' |
| 14 | 10 | design-deviation | low | connector.ui | ConnectorObject (and ShapeObject) take the generic registry ObjectProps and read other objects through context, instead of the design contract's props (connector, rects, doc, selected, zoom / shape, doc, selected, editing, onEndEdit). | src/client/objects/ConnectorObject.tsx:88 function ConnectorObjectImpl(props: ObjectProps); src/client/objects/ShapeObject.tsx:111 function ShapeObjectImpl(props: ObjectProps) |
| 15 | 11 | design-deviation | low | stroke.object | Each stroke carries aria-label="Drawing" twice: on the wrapper div (the one actually announced) and on the SVG path the design names, which sits inside an aria-hidden svg, so the design's labelled path is inert and every stroke matches the label selector twice. | src/client/objects/StrokeObject.tsx:47,62 (path label inside aria-hidden svg) and :111 (wrapper label); held-out story 11 tests all saw 2 elements for 1 stroke |
| 16 | 11 | design-deviation | low | task 1 | The test-first task's 'Done when' (stroke unit suite compiles and fails only with 'not implemented' before implementation) was not met: tests and implementation landed together and were only mutation-checked afterwards. | git show e96630f --stat (tests/unit/stroke.test.ts with src/shared/objects/stroke.ts and simplify.ts in one commit); agent-reports/story-11.md 'Left undone: The tests weren't seen failing before the code existed' |
| 17 | 12 | design-deviation | low | task 1, task 2 | The test-first tasks' 'Done when' (format/validation and image-model unit suites compile and fail only with 'not implemented' before implementation) was not met: tests and implementation landed together and were only mutation-checked afterwards. | git show 00cefee --stat (tests/unit/image-format.test.ts, validate-files.test.ts, image-model.test.ts with src/shared/image-format.ts and src/shared/objects/image.ts in one commit); agent-reports/story-12.md 'Test-first order was only partly followed' |

## Held-out test faults (charged to the suite, not the build)

The audits of both builds found these. They were fixed in the suite (commits `5756fe5` and `5e17e1f`) without weakening any assertion, and both builds were re-scored with the fixed suite.

| Story | Test | Verdict | Cause |
|---|---|---|---|
| None |  | test-fault | One root cause: the tests click Zoom out and then immediately click again or read the zoom label, but the story 1 design requires camera updates batched to one render per animation frame, so the label/view can still show the previous step.  |
| None |  | test-fault | createNote leaves the last note selected and PRD sel.marquee is additive, so a Shift+drag must add to {half}; the test did not clear the selection first (the golden path in the same file does). |
| None |  | test-fault | Two test defects: the zoom label was read mid-animation (TF-01 cause), and clickEmpty at (1200,750) hit the 'Reset view' button, resetting to 100% before the width was read. |
| None |  | test-fault | The CSS locator [aria-label="Drawing"] also matched the label on an SVG path inside an aria-hidden subtree, so one stroke counted twice. PRD says strokes are announced as 'Drawing'; what is announced is one element per stroke. (Opus's redun |
| None |  | test-fault | The test presses I straight after page.reload() without waiting for the board to reconnect; PRD image.offline requires the app to refuse (toast, no picker) until connected, so a correct app can time out the filechooser wait. The specific fa |
| None |  | test-fault | The spec does not fix the size buttons' accessible names. PRD 009 Constraints/Accessibility says only 'size buttons announce their size'; PRD Structure and design TC-21 name the buttons S, M, L, XL as visible labels; design text.object give |
| None |  | test-fault | Latent fault, not the cause of the current failure. The test asserts toHaveText(/^\s*red green blue\s*$/) on the whole [role=group][aria-label="Sticky note"] element while the note is still selected. The design allows the note toolbar insid |
| None |  | app-fault | The tests measure the new shape through its selection handles ([aria-label^="Resize "]), which story 7's design requires on every selected resizable object and design 010 registers shapes as resizable: true. Flash-Next renders no handles, s |

The rows are also in machine-readable form in `audit.jsonl` (every field, plus review notes and merge sources).
