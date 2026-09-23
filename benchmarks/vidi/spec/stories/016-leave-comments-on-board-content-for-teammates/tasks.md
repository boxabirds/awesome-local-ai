# Tasks

| # | Title | Status | Type | Implements |
|---|-------|--------|------|------------|
| 1 | Write comments model unit tests first on a real Y.Doc (TC-01 to TC-14) | proposed | test:unit | comments.model |
| 2 | Implement comments model: anchors, threads, replies, resolve, edit/delete rules | proposed | implementation | comments.model |
| 3 | Implement Comment tool, screen-space markers and thread popover | proposed | implementation | comments.board_ui |
| 4 | Component tests for Comment tool, markers and popover (TC-23 to TC-30) | proposed | test:ui-component | comments.board_ui |
| 5 | E2E comment discussion and persistence (TC-35, TC-36) | proposed | test:e2e | comments.board_ui |
| 6 | Ensure comments map in initDoc for sync and persistence | proposed | implementation | comments.sync_persist |
| 7 | Integration tests: comments converge and persist through BoardRoom (TC-18 to TC-22) | proposed | test:integration | comments.sync_persist |
| 8 | Write comment undo guard unit tests first (TC-15 to TC-17) | proposed | test:unit | comments.undo |
| 9 | Extend undo to comments with foreign-reply guard | proposed | implementation | comments.undo |
| 10 | Implement comments panel with Open/Resolved tabs and navigation | proposed | implementation | comments.panel_ui |
| 11 | Component tests for comments panel and undo shortcut (TC-31 to TC-34) | proposed | test:ui-component | comments.panel_ui, comments.undo |
| 12 | E2E zoomed navigation from comments panel (TC-37) | proposed | test:e2e | comments.panel_ui |

## Details

### 1. Write comments model unit tests first on a real Y.Doc (TC-01 to TC-14)

## Goal
Test-first suite for comments.model against its contract (`anchorForClick`, `createThread`, `addReply`, `setResolved`, `editMessage`, `deleteMessage`, `resolveAnchorPosition`, `listThreads`, `openCount`) using a real Y.Doc. Stub exports throw "not implemented". Add COMMENT_BODY_MAX_CHARS, COMMENT_MARKER_SIZE_PX, COMMENT_PANEL_WIDTH_PX, COMMENT_TESTED_THREADS, COMMENT_TESTED_MESSAGES, COMMENT_NOTICE_MS, COMMENT_PREVIEW_CHARS to `config.ts`; add `tests/fixtures/comments.ts` (guest "Curious Otter", signed-in "Mira", realistic threads).

## Cases (each mutation asserts update-event count: 1 on success, 0 on rejection)
- TC-01 click at 75%/25% of a 200x200 sticky → object anchor relX 0.75 relY 0.25, fallback = click point, 1 message with authorName snapshot.
- TC-02 point anchor (−300, 40) stored exactly.
- TC-03 blank bodies '', '   ', '\n\t' → null (negative).
- TC-04 body lengths 1, COMMENT_BODY_MAX_CHARS, +1 → stored 1, 2000, truncated 2000 (boundary).
- TC-05 object anchor to missing object → null (error path).
- TC-06 addReply appends in order; missing thread → false; blank → false.
- TC-07 resolveAnchorPosition corners (0,0) and (1,1) after object moved +500 and doubled.
- TC-08 object deleted → fallback + detached; restored same id → attached.
- TC-09 setResolved true (resolvedBy set), true again (no update), false (cleared), missing thread (false).
- TC-10 editMessage by author sets body+editedAt; by other id false; blank false.
- TC-11 delete reply removed; root without replies → thread removed; root with replies → deleted true, body '', replies kept.
- TC-12 deleteMessage by other author → false (negative).
- TC-13 listThreads filter + newest latest-message first; openCount.
- TC-14 rename after posting: first message keeps old authorName, reply uses new name.

## Done when
Suite compiles and fails only with "not implemented"; committed.

### 2. Implement comments model: anchors, threads, replies, resolve, edit/delete rules

## Goal
Implement `src/shared/comments.ts` per the comments.model contract so TC-01..TC-14 pass.

## Approach
- Schema: `comments` Y.Map of thread Y.Maps {anchor (plain JSON, never mutated), createdAt, resolved, resolvedBy, messages: Y.Array<Y.Map {id, authorId, authorName, body, createdAt, editedAt, deleted}>}.
- `anchorForClick(obj, world)`: object → relX/relY = clamp((world − obj.xy)/size, 0, 1) plus fallback = world; null obj → point anchor.
- Validation before any transaction: trimmed-blank body → null/false; missing thread/message → false; `actorId !== authorId` → false; object anchor whose object is absent → null; setResolved to the current value → false. Truncate body to COMMENT_BODY_MAX_CHARS.
- Delete rules: reply → remove; first message without replies → delete thread key; first message with replies → `deleted: true`, body ''.
- `resolveAnchorPosition`: object present → `x + relX*width, y + relY*height`, detached false; absent → fallback, detached true; point → point.
- `listThreads(filter)` sorted by latest message createdAt desc; `openCount`.
- One `doc.transact(fn, LOCAL_ORIGIN)` per successful mutation; framework-free module.

## Done when
All comments.model unit tests pass; typecheck passes.

### 3. Implement Comment tool, screen-space markers and thread popover

## Goal
Implement comments.board_ui per contract (`CommentLayer`, `ThreadPopover`).

## Approach
- Toolbar Comment tool (C, tooltip "Comment (C)"); disabled when story 4 `canEdit` is false; Escape with no popover returns to Select.
- `useThreads`: `useSyncExternalStore` over `comments.observeDeep` and `objects.observeDeep`.
- `CommentLayer`: in tool mode, click → story 7 registry hit test for topmost object → `anchorForClick` → open draft popover. Markers: `button` in a screen-space layer, size COMMENT_MARKER_SIZE_PX at every zoom, positioned `worldToScreen(resolveAnchorPosition)`, hidden when resolved, initial of first author, count badge when > 1, `aria-label "Comment thread by <name>, <n> messages"`.
- `ThreadPopover` states Closed/Drafting/Viewing/EditingMessage: messages with authorName snapshot, relative time, "(edited)", "This comment was deleted" placeholder; textarea `maxLength` COMMENT_BODY_MAX_CHARS; Post disabled when blank; Enter newline; Ctrl/Cmd+Enter posts; after first post tool returns to Select; Resolve/Reopen with "Resolved by <name>"; ⋯ Edit/Delete only when `authorId === identity.id`; detached notice "The item this comment was attached to was deleted."; remote thread deletion closes the popover with a COMMENT_NOTICE_MS notice; Escape/outside click closes and discards drafts (no doc write).

## Done when
Tasks 16.4 and 16.5 pass.

### 4. Component tests for Comment tool, markers and popover (TC-23 to TC-30)

## Goal
jsdom tests of the comments.board_ui contract with a real Y.Doc, fixture identities and fake timers.

## Cases
- TC-23 Comment tool click on a sticky → draft anchor with object fractions; click on empty board → point anchor.
- TC-24 Post disabled when blank (negative), enabled with text; Enter inserts newline; Ctrl/Cmd+Enter calls createThread.
- TC-25 paste 2,100 chars → textarea value length COMMENT_BODY_MAX_CHARS (boundary).
- TC-26 marker at zoom ZOOM_MIN and ZOOM_MAX → width/height COMMENT_MARKER_SIZE_PX; badge "3"; accessible label text.
- TC-27 resolved thread renders no marker; detached thread shows notice text.
- TC-28 own message has Edit/Delete, other's has none (negative); edited shows "(edited)"; deleted root with replies shows placeholder.
- TC-29 remote delete while open → popover closes with notice; remote resolve while open → "Resolved by Mira" and Reopen.
- TC-30 Escape with draft → no doc update; Escape in tool with no popover → Select tool; `canEdit` false → tool disabled (negative).

## Done when
All pass in `npm run test:component`.

### 5. E2E comment discussion and persistence (TC-35, TC-36)

## Goal
Prove comments.board_ui live behaviour through real browsers and the real `wrangler dev` path.

## Workflows
- TC-35 "Discussion on a note" (two contexts, fixture identities): Lee selects the Comment tool (C), clicks a sticky, posts "Is this in scope for Q3?" → Mira sees the screen-space marker within LIVE_UPDATE_LATENCY_BUDGET_MS, opens the ThreadPopover, replies → marker badge "2" on both; Lee moves and resizes the note → marker stays at the same relative spot (±1 px from expected); Mira resolves → marker hidden on both; Lee reopens from the Resolved tab → marker returns.
- TC-36 "Come back tomorrow": Lee edits own message, Mira resolves another thread; close all contexts; reopen board → threads, "(edited)", resolved state and authorName snapshots identical.

## Done when
Both pass in chromium.

### 6. Ensure comments map in initDoc for sync and persistence

## Goal
Implement comments.sync_persist per contract: `initDoc` also ensures `doc.getMap('comments')` exists and emits no update when meta and comments already exist, so comment observers attach before remote content arrives.

## Approach
- `initDoc`: access the `comments` root type (root types create no update); keep `meta.schemaVersion` write only when absent.
- `useBoardDoc` exposes the comments map alongside objects.
- No BoardRoom/BoardStore changes: story 3 relays and story 4 appends whole-doc updates regardless of root type, so comment create/reply/resolve/edit converge within LIVE_UPDATE_LATENCY_BUDGET_MS and persist. Document concurrent semantics: thread-key delete wins over a nested concurrent reply.

## Done when
Integration task TC-18..TC-22 passes.

### 7. Integration tests: comments converge and persist through BoardRoom (TC-18 to TC-22)

## Goal
Verify comments.sync_persist with the real Worker, BoardRoom and SQLite (vitest-pool-workers), using story 3's `ws-client` helper and story 4's reload path.

## Cases
- TC-18 A createThread, B addReply → both docs' comments identical.
- TC-19 concurrent: A setResolved(true) while B replies → converge with resolved true and the reply present.
- TC-20 concurrent: A deletes sole first message (thread removed) while B replies → both converge with thread absent; no exception (documented delete-wins).
- TC-21 create, edit and resolve threads; all clients leave; room reloads from storage → threads, editedAt and resolved state identical.
- TC-22 `initDoc` on a doc that already has meta and comments → zero update events (negative: opening a board never writes).

## Done when
All pass in `npm run test:integration`.

### 8. Write comment undo guard unit tests first (TC-15 to TC-17)

## Goal
Test-first coverage of comments.undo: UndoManager scope `[objects, comments]` with `trackedOrigins {LOCAL_ORIGIN}`, `recordCreatedThreads` storing `meta.threadIds`, and `canUndoTop` guard. Uses two real Y.Docs synced by applying updates directly.

## Cases
- TC-15 A posts a thread, undo → thread removed; redo → restored identical.
- TC-16 A posts, B (other doc, other identity) replies, A calls undo through the guard → `canUndoTop` returns `{ok:false, reason:'foreign-replies'}`, stack item dropped, thread and B's reply intact, notice emitted (negative: never undo others' work).
- TC-17 A resolves; B edits its own message; A undo → thread reopened, B's edit untouched (remote changes never tracked).
- Empty stack → `{ok:false, reason:'empty'}`.

## Done when
Suite compiles against stubs and fails with "not implemented"; committed.

### 9. Extend undo to comments with foreign-reply guard

## Goal
Implement comments.undo per contract as a modification of story 8's `useUndo`.

## Approach
- UndoManager scope becomes `[doc.getMap('objects'), doc.getMap('comments')]`, `trackedOrigins = new Set([LOCAL_ORIGIN])`.
- `recordCreatedThreads`: on `stack-item-added`, collect `comments` keys inserted by the transaction and store them in `stackItem.meta.threadIds` (confirm exact event/meta API against the pinned Yjs version).
- `canUndoTop(um, doc, actorId)`: empty → `{ok:false,'empty'}`; any recorded thread containing a message whose authorId ≠ actorId → `{ok:false,'foreign-replies'}`.
- Ctrl/Cmd+Z handler: if guard fails with foreign-replies, remove that stack item and show "Can't undo: others have replied" for COMMENT_NOTICE_MS; else `undo()`. Shift+Ctrl/Cmd+Z redo unchanged.
- Covers post, reply, edit, delete, resolve and reopen because all are LOCAL_ORIGIN transactions from comments.model.

## Done when
TC-15..TC-17 and TC-31 pass.

### 10. Implement comments panel with Open/Resolved tabs and navigation

## Goal
Implement comments.panel_ui per contract (`CommentsPanel`, `centreCameraOn`).

## Approach
- Top-right Comments button with `openCount` badge toggles a right panel COMMENT_PANEL_WIDTH_PX wide.
- Tabs Open / Resolved using `listThreads(filter)`; rows: first line of first message truncated to COMMENT_PREVIEW_CHARS (or "This comment was deleted"), author name snapshot, reply count, relative time of latest activity. Empty states: "No open comments. Use the Comment tool (C) to start a discussion." / "No resolved comments."
- Row click: `resolveAnchorPosition` (fallback for detached) → `centreCameraOn(camera, viewport, point)` keeping zoom → open ThreadPopover (resolved threads open without a marker; Reopen available). If the thread vanished between render and click, show a notice and refresh.
- Keyboard: tabs and rows focusable, Enter activates.

## Done when
TC-32..TC-34 and TC-37 pass.

### 11. Component tests for comments panel and undo shortcut (TC-31 to TC-34)

## Goal
jsdom tests for the comments.panel_ui contract and the comments.undo keyboard path.

## Cases
- TC-31 (comments.undo) in App: resolve a thread, press Ctrl/Cmd+Z → thread open again via UndoManager; with a foreign-reply guard failure → "Can't undo: others have replied" notice shown and nothing changes.
- TC-32 (panel) empty Open and Resolved tabs show the exact empty-state texts.
- TC-33 (panel) 3 threads (open, open with deleted root, resolved): order newest activity first; preview truncated to COMMENT_PREVIEW_CHARS; author, reply count; Comments button badge equals openCount.
- TC-34 (panel) clicking open, resolved and detached rows → `centreCameraOn` result with zoom unchanged; popover opens; resolved has no marker; detached uses fallback point.

## Done when
All pass in `npm run test:component`.

### 12. E2E zoomed navigation from comments panel (TC-37)

## Goal
Real-browser verification of comments.panel_ui navigation and marker sizing.

## Workflow "Zoomed navigation" (TC-37)
1. Seed a board with a thread 5,000 units from the origin and one near it.
2. At zoom ZOOM_MIN and at ZOOM_MAX, measure marker bounding boxes → both COMMENT_MARKER_SIZE_PX ±1 px.
3. Open the Comments panel, click the far thread row → board zoom label unchanged, marker centred in the viewport ±1 px, ThreadPopover open.
4. Resolve it, switch to Resolved tab, click it → popover opens at its location with no marker on the board.

## Done when
Passes in chromium and webkit.

