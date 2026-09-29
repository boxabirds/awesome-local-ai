// Story 4 — persistence integration (Task 3): real Y.Doc clients over real
// WebSockets against a real workerd BoardRoom with its REAL SQLite storage,
// inspected through the test-only /__test/rooms/:id/* hooks. Design table
// TC-12, TC-14, TC-15, TC-16, TC-17, TC-18.
//
// Run with `npm run test:integration` (boots `wrangler dev --var
// TEST_HOOKS:1`; without that flag every hook answers 404/SPA, which is what
// the production build ships).

import { describe, expect, it } from 'vitest';
import { createSticky, snapshot } from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED, CLOSE_UNSUPPORTED_DATA, MESSAGE_SYNC } from '../../src/shared/protocol';
import { hooks, until } from './helpers/hooks';
import { rawClient, createRoom, syncFrame, yClient } from './helpers/ws-client';

/** Sync-update frames a client RECEIVED (channel 0, type 2). */
/** Inbound sync-update frames of a raw client (frames are bare byte arrays). */
function inboundUpdates(client: { frames: ReadonlyArray<Uint8Array> }) {
  return client.frames.filter(
    (bytes) => bytes.length > 3 && bytes[0] === MESSAGE_SYNC && bytes[1] === 2,
  );
}

describe('board persistence (persist.room)', () => {
  it('TC-12: an edit is written to SQLite before it is broadcast', async () => {
    const boardId = await createRoom();
    const author = yClient(boardId);
    expect(await until(() => author.provider.synced, 10_000)).toBe(true);
    expect(await hooks.logCount(boardId)).toBe(0); // empty board: nothing stored yet

    // One note in one transaction = one update = one journal row.
    createSticky(author.doc, { x: 10, y: 20 });
    expect(await until(async () => (await hooks.logCount(boardId)) === 1, 8_000)).toBe(true);

    // Persist-then-broadcast: the moment the update is durable, a newcomer is
    // handed exactly what is in the journal — never less, never more.
    const state = await hooks.state(boardId);
    expect(state.state).toBe('ready');
    expect(state.storeStats === null).toBe(false);
    const watcher = yClient(boardId);
    expect(await until(() => snapshot(watcher.doc).length === 1, 10_000)).toBe(true);
    expect(snapshot(watcher.doc)[0].type).toBe('sticky');
    watcher.destroy();
    author.destroy();
  }, 40_000);

  it('TC-18: an idle board keeps no memory-resident state, and later traffic re-reads it', async () => {
    const boardId = await createRoom();
    const first = yClient(boardId);
    expect(await until(() => first.provider.wsconnected, 10_000)).toBe(true);
    createSticky(first.doc, { x: 5, y: 5 });
    expect(await until(async () => (await hooks.logCount(boardId)) === 1, 8_000)).toBe(true);

    // The only connection goes away: nothing stays resident, and the next
    // visitor has to rebuild the board from storage.
    first.destroy();
    expect(await until(async () => (await hooks.state(boardId)).hibernating, 10_000)).toBe(true);

    const second = yClient(boardId);
    expect(await until(() => second.provider.synced, 10_000)).toBe(true);
    expect(await until(() => snapshot(second.doc).length === 1, 8_000)).toBe(true);
    const state = await hooks.state(boardId);
    expect(state.state).toBe('ready');
    expect(state.storeStats === null).toBe(false);
    second.destroy();
  }, 40_000);

  it('TC-14: a room that cannot trust its storage shows nothing and stores nothing', async () => {
    const boardId = await createRoom();
    const author = yClient(boardId);
    expect(await until(() => author.provider.synced, 10_000)).toBe(true);
    for (let i = 0; i < 2; i++) createSticky(author.doc, { x: i * 20, y: 0 });
    expect(await until(async () => (await hooks.logCount(boardId)) === 2, 8_000)).toBe(true);
    await hooks.compact(boardId);
    author.destroy();

    // Take the snapshot away: it is the only copy of those two notes now, and
    // it is unreadable.
    await hooks.corruptSnapshot(boardId);
    const state = await hooks.state(boardId);
    expect(state.state).toBe('load-failed');
    expect(state.serving).toBe(false);

    const victim = await rawClient(boardId);
    expect(await victim.closed).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(inboundUpdates(victim).length).toBe(0); // never handed an empty board

    // And what a refused client sends is not stored either: a room that
    // cannot vouch for the state it already has refuses to grow an unbacked
    // second state on top of it.
    victim.ws.send(new Uint8Array([0, 2, 5, 1, 2, 3, 4, 5]));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const after = await hooks.state(boardId);
    expect(after.state).toBe('load-failed');
    expect(after.log).toBeNull();
    victim.close();
  }, 60_000);

  it('TC-15: a board whose snapshot cannot be decoded is refused, not emptied', async () => {
    const boardId = await createRoom();
    const author = yClient(boardId);
    expect(await until(() => author.provider.synced, 10_000)).toBe(true);
    for (let i = 0; i < 3; i++) createSticky(author.doc, { x: i * 20, y: 0 });
    expect(await until(async () => (await hooks.logCount(boardId)) !== null && (await hooks.logCount(boardId))! >= 3, 8_000)).toBe(
      true,
    );

    // Journal -> snapshot, then damage it: the room reloads and cannot decode.
    const compacted = await hooks.compact(boardId);
    expect(compacted.chunkCount).toBe(1);
    expect(compacted.storeStats === null ? null : compacted.storeStats.logCount).toBe(0);
    author.destroy(); // drop the resident copy: the next load comes off disk

    await hooks.corruptSnapshot(boardId);
    const state = await hooks.state(boardId);
    expect(state.state).toBe('load-failed');
    expect(state.serving).toBe(false);

    const client = await rawClient(boardId);
    expect(await client.closed).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(inboundUpdates(client).length).toBe(0);
    client.close();
  }, 60_000);

  it('TC-16: a refused board retries only after the load interval', async () => {
    const boardId = await createRoom();
    const author = yClient(boardId);
    expect(await until(() => author.provider.synced, 10_000)).toBe(true);
    for (let i = 0; i < 2; i++) createSticky(author.doc, { x: i * 20, y: 0 });
    expect(await until(async () => (await hooks.logCount(boardId)) !== null && (await hooks.logCount(boardId))! >= 2, 8_000)).toBe(
      true,
    );
    await hooks.compact(boardId);
    author.destroy();
    await hooks.corruptSnapshot(boardId);

    const before = await hooks.state(boardId);
    expect(before.state).toBe('load-failed');

    // Two attempts inside the retry window: both are answered from the state
    // machine alone — no empty document, no stored bytes, close 4500.
    const [first, second] = await Promise.all([rawClient(boardId), rawClient(boardId)]);
    const [firstCode, secondCode] = await Promise.all([first.closed, second.closed]);
    expect(firstCode).toBe(CLOSE_BOARD_LOAD_FAILED);
    expect(secondCode).toBe(CLOSE_BOARD_LOAD_FAILED);

    const throttled = await hooks.state(boardId);
    expect(throttled.state).toBe('load-failed');
    expect(throttled.log).toBeNull(); // nothing stored while refusing
    first.close();
    second.close();
    author.destroy();
  }, 60_000);

  it('TC-17: rejected input is never written to the journal', async () => {
    const boardId = await createRoom();
    const author = yClient(boardId);
    expect(await until(() => author.provider.synced, 10_000)).toBe(true);
    createSticky(author.doc, { x: 0, y: 0 });
    expect(await until(async () => (await hooks.logCount(boardId)) === 1, 8_000)).toBe(true);

    const junk = await rawClient(boardId);
    expect(await until(() => junk.ws.readyState === WebSocket.OPEN, 5_000)).toBe(true);
    junk.ws.send(syncFrame(2, Uint8Array.from([0xff, 0xfe, 0xfd, 0x00])));
    expect(await junk.closed).toBe(CLOSE_UNSUPPORTED_DATA);

    // The board is untouched: same single journal row, and the author's
    // socket was not disturbed by the junk.
    expect(await hooks.logCount(boardId)).toBe(1);
    expect(author.provider.wsconnected).toBe(true);

    // A second junk socket, text this time, changes nothing either.
    const junk2 = await rawClient(boardId);
    junk2.ws.send('ping');
    expect(await junk2.closed).toBe(CLOSE_UNSUPPORTED_DATA);
    expect(await hooks.logCount(boardId)).toBe(1);

    // And the board keeps working for a client that speaks the protocol.
    createSticky(author.doc, { x: 30, y: 0 });
    expect(await until(async () => (await hooks.logCount(boardId)) === 2, 8_000)).toBe(true);
    junk.close();
    junk2.close();
    author.destroy();
  }, 60_000);
});
