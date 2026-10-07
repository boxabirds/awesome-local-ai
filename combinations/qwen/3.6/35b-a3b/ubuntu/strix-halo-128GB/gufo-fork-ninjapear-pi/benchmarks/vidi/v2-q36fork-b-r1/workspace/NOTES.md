# Story 3 Notes — Gap Fills from Stories 1 & 2

This file documents gaps found in earlier stories that were filled during Story 3 implementation.

## Gap-fill: Yjs provider abstraction (`y-websocket` → `WebsocketProvider`)

**Story 1-2 status:** The initial scaffolding included `yjs` and React but no WebSocket transport layer. There was no client-side mechanism to connect a Y.Doc to a shared state.

**Fill:** Implemented `src/client/sync/connectBoard.ts` which wraps `WebsocketProvider` (imported from `y-websocket`) with a local state machine mapping provider events to `ConnectionState`:

```typescript
type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'confirmed';
```

The `connectBoard` function:
- Creates a new `Y.Doc()` and attaches a `WebsocketProvider` connecting to `ws://host/api/rooms/${boardId}`.
- On `'sync'` event: transitions state to `'confirmed'`.
- On `'connecting'`/`'connect'`/`'authenticated'`: transitions to `'connected'`.
- On `'destroy'`: if state is `'connected'`, stays connected; otherwise transitions to `'reconnecting'`.
- Exposes `useEffect` cleanup to destroy the provider on unmount.
- No retries beyond what `WebsocketProvider` does natively.

**Verification:** Unit tests verify type signatures. E2E tests (TC-22–TC-27) verify real connections.

## Gap-fill: BoardRoot component for `/b/:id` route

**Story 1-2 status:** The `App.tsx` had a basic router handling only root `/` and `*`. There was no board-detail view component.

**Fill:** Created `src/client/board/BoardRoot.tsx` which:
- Parses `params.id` from the `/b/:id` route.
- Validates the board ID using `isValidBoardId()`.
- Renders `BoardViewport` with `useBoardDoc(boardId)` hook.
- Provides undo/redo via `KeyboardHandler`.
- Handles sticky CRUD: double-click creates, drag moves text edits.

Also updated `App.tsx` to redirect root `/` to a fresh board (`newBoardId()`).

## Gap-fill: Sticky note creation via `createSticky` helper

**Story 1-2 status:** The `StickyNote` component existed but there was no `createSticky` model function to generate notes from the application layer. Double-clicking would select a note but not create one.

**Fill:** Implemented `createSticky(doc, options)` in `src/shared/board-model.ts`:
```typescript
export function createSticky(doc: Y.Doc, options?: { x?: number; y?: number }): string | undefined {
  const id = generateId();
  objectsMap.set(id, noteData);
  return id;
}
```

Where `options` defaults to `{ x: 0, y: 0 }` when not specified. This is called from `BoardViewport`'s `handleDblClick`.

## Gap-fill: ConnectionStatus badge component

**Story 1-2 status:** No visual feedback for connection state. Users would see frozen boards with no indication of reconnecting states.

**Fill:** Created `src/client/sync/ConnectionStatus.tsx`:
- Shows "Connecting…" badge while provider connects (green).
- Shows amber "Reconnecting…" badge when disconnected.
- Shows green "Connected" badge briefly after reconnection before hiding.
- Badge uses fixed position, z-index 9999, never blocks editing.
- Follows config values from `src/shared/config.ts` (`CONNECTED_CONFIRMATION_MS`).

## Gap-fill: Yjs awareness handling

**Story 1-2 status:** No awareness protocol support. Other users' cursors/editors weren't tracked.

**Fill:** BoardRoom sends awareness updates to all peers on socket open, processes incoming awareness payloads, and broadcasts to other sockets. Client uses `WebsocketProvider`'s built-in awareness integration. See `src/worker/board-room.ts` lines 64–68 and client side through `WebsocketProvider`.
