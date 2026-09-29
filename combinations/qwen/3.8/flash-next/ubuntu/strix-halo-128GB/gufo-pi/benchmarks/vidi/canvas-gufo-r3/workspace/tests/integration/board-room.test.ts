import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { MAX_CONCURRENT_EDITORS } from '@shared/config';
import {
  createSticky,
  moveObject,
  setStickyColor,
  deleteObject,
  getStickyText,
} from '@shared/board-model';
import { MESSAGE_SYNC, CLOSE_UNSUPPORTED_DATA } from '@shared/protocol';
import { newBoardId } from '@shared/board-id';
import { openRoomClient, waitFor, snapshotsMatch, snapKey, YTestClient } from './helpers/ws-client';
import { runRandomOps, mulberry32 } from './helpers/random-ops';

async function synced(...clients: YTestClient[]) {
  await waitFor(
    () => clients.every((c) => snapshotsMatch(c.snapshot(), clients[0].snapshot())),
    4000,
    'clients never synced',
  );
}

async function settle(ms = 200) {
  await new Promise((r) => setTimeout(r, ms));
}

describe('sync.room — Y.Doc relay: merge, broadcast, error handling', () => {
  it('TC-07: A creates a sticky — B equals A and received exactly one update message', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await synced(a, b);

    b.updateCount = 0;
    createSticky(a.doc, { x: 40, y: 60 });
    await waitFor(() => b.snapshot().length === 1, 4000, 'note did not reach B');
    await settle();
    expect(b.updateCount).toBe(1);
    expect(snapshotsMatch(a.snapshot(), b.snapshot())).toBe(true);
    a.close();
    b.close();
  });

  it('TC-08 (move): a move propagates and is not echoed to the mover', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await synced(a, b);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1);
    a.updateCount = 0;
    b.updateCount = 0;

    moveObject(a.doc, id, 321, 654);
    await waitFor(() => {
      const n = b.snapshot().find((o) => o.id === id);
      return !!n && n.x === 321 && n.y === 654;
    }, 4000, 'move not propagated');
    await settle();
    expect(a.updateCount).toBe(0);
    a.close();
    b.close();
  });

  it('TC-08 (recolour): a colour change propagates and is not echoed', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await synced(a, b);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1);
    a.updateCount = 0;

    setStickyColor(a.doc, id, 'pink');
    await waitFor(() => b.snapshot().find((n) => n.id === id)?.color === 'pink', 4000, 'colour not propagated');
    await settle();
    expect(a.updateCount).toBe(0);
    a.close();
    b.close();
  });

  it('TC-08 (text insert): a text edit propagates and is not echoed', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await synced(a, b);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1);
    a.updateCount = 0;

    const ytext = getStickyText(a.doc, id)!;
    a.doc.transact(() => ytext.insert(0, 'hello world'));
    await waitFor(() => b.snapshot().find((n) => n.id === id)?.text === 'hello world', 4000, 'text not propagated');
    await settle();
    expect(a.updateCount).toBe(0);
    a.close();
    b.close();
  });

  it('TC-08 (delete): a deletion propagates and is not echoed', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await synced(a, b);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1);
    a.updateCount = 0;

    deleteObject(a.doc, id);
    await waitFor(() => b.snapshot().length === 0, 4000, 'delete not propagated');
    await settle();
    expect(a.updateCount).toBe(0);
    a.close();
    b.close();
  });

  it('TC-09: concurrent text inserts merge to the same string on both', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await synced(a, b);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    const seed = getStickyText(a.doc, id)!;
    a.doc.transact(() => seed.insert(0, 'green'));
    await waitFor(() => b.snapshot().find((n) => n.id === id)?.text === 'green', 4000);

    // Concurrent edits applied before either receives the other's.
    const at = getStickyText(a.doc, id)!;
    const bt = getStickyText(b.doc, id)!;
    a.doc.transact(() => at.insert(0, 'red '));
    b.doc.transact(() => bt.insert(bt.length, ' blue'));

    await waitFor(
      () =>
        a.snapshot().find((n) => n.id === id)?.text === 'red green blue' &&
        b.snapshot().find((n) => n.id === id)?.text === 'red green blue',
      4000,
      'concurrent inserts did not converge',
    );
    a.close();
    b.close();
  });

  it('TC-10: concurrent moves to x=100 vs x=300 leave identical x on both', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await synced(a, b);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1);

    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);

    await waitFor(() => {
      const na = a.snapshot().find((n) => n.id === id);
      const nb = b.snapshot().find((n) => n.id === id);
      return !!na && !!nb && na.x === nb.x;
    }, 4000, 'concurrent moves did not converge to identical x');
    const finalX = a.snapshot().find((n) => n.id === id)!.x;
    expect([100, 300]).toContain(finalX);
    a.close();
    b.close();
  });

  it('TC-11: A deletes a note while B types in it — the note is gone everywhere, no resurrection, no throw', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await synced(a, b);
    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.snapshot().length === 1);

    const bt = getStickyText(b.doc, id)!;
    deleteObject(a.doc, id);
    b.doc.transact(() => bt.insert(0, 'typical concurrent typing'));

    await waitFor(() => a.snapshot().length === 0 && b.snapshot().length === 0, 4000, 'delete did not win on both');
    // B's typed text is nowhere: no note carries it.
    expect(b.snapshot().some((n) => n.text.includes('typical'))).toBe(false);
    a.close();
    b.close();
  });

  it('TC-12: MAX_CONCURRENT_EDITORS clients × 200 seeded random ops converge to identical snapshots', async () => {
    const seed = 1234567;
    console.log(`[TC-12] random-ops seed = ${seed}`);
    const board = newBoardId();
    const clients = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS }, () => openRoomClient(board)),
    );
    await synced(...clients);

    // Each client applies 200 ops against its own view with its own seeded stream.
    clients.forEach((c, i) => {
      const rng = mulberry32(seed + i);
      runRandomOps(c.doc, 200, rng);
    });

    await waitFor(
      () => clients.every((c) => snapshotsMatch(c.snapshot(), clients[0].snapshot())),
      8000,
      'capacity clients did not converge',
    );
    const keys = new Set(clients.map((c) => c.snapshot().map(snapKey).join('|')));
    expect(keys.size).toBe(1);
    clients.forEach((c) => c.close());
  });

  it('TC-14: A and B create 20 notes; a late joiner C’s snapshot equals A after sync', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await synced(a, b);
    for (let i = 0; i < 10; i++) createSticky(a.doc, { x: i, y: i });
    for (let i = 0; i < 10; i++) createSticky(b.doc, { x: 100 + i, y: 100 + i });
    await waitFor(() => a.snapshot().length === 20 && b.snapshot().length === 20, 4000);

    const c = await openRoomClient(board);
    await waitFor(() => snapshotsMatch(c.snapshot(), a.snapshot()), 4000, 'late joiner did not catch up');
    expect(c.snapshot().length).toBe(20);
    a.close();
    b.close();
    c.close();
  });

  it('TC-15: malformed traffic from A closes only A (1003); B stays open, room doc unchanged (4 variants)', async () => {
    const badSenders = [
      (c: YTestClient) => c.sendTextFrame('this is a text frame, not sync'),
      (c: YTestClient) => c.rawSend(new Uint8Array([0x80])), // truncated varUint header
      (c: YTestClient) => {
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 9); // unknown message type
        c.rawSend(encoding.toUint8Array(enc));
      },
      (c: YTestClient) => {
        // Correctly framed MESSAGE_SYNC + Update whose payload cannot be applied as
        // a Yjs update: this exercises the room's rethrowing readSyncMessage path.
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MESSAGE_SYNC);
        syncProtocol.writeUpdate(enc, new Uint8Array([0xff, 0xff, 0xff, 0xff, 0x7f, 1, 2, 3]));
        c.rawSend(encoding.toUint8Array(enc));
      },
    ];

    for (let i = 0; i < badSenders.length; i++) {
      const board = newBoardId();
      const a = await openRoomClient(board);
      const b = await openRoomClient(board);
      await synced(a, b);

      badSenders[i](a);
      await waitFor(() => a.closed !== null, 3000, `variant ${i}: A not closed`);
      expect(a.closed!.code).toBe(CLOSE_UNSUPPORTED_DATA);
      // The bad frame changed nothing.
      expect(b.snapshot().length).toBe(0);

      // B is still open and still relays: a new note from a fresh client reaches B.
      const fresh = await openRoomClient(board);
      await new Promise((r) => setTimeout(r, 100));
      createSticky(fresh.doc, { x: i, y: i });
      await waitFor(() => b.snapshot().length === 1, 4000, `variant ${i}: B stopped relaying`);
      expect(b.closed).toBe(null);
      a.close();
      b.close();
      fresh.close();
    }
  });

  it('TC-16: awareness bytes from A are relayed identically to A and B', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await synced(a, b);
    a.awarenessCount = 0;
    b.awarenessCount = 0;

    a.sendAwareness(new Uint8Array([1, 2, 3, 4, 5]));
    await waitFor(() => a.awarenessCount >= 1 && b.awarenessCount >= 1, 4000, 'awareness not relayed to both');
    const aBytes = a.received.filter((m) => m.outer === 1).map((m) => m.bytes.join(','));
    const bBytes = b.received.filter((m) => m.outer === 1).map((m) => m.bytes.join(','));
    expect(aBytes.length).toBeGreaterThan(0);
    expect(aBytes).toEqual(bBytes); // verbatim, identical frames
    a.close();
    b.close();
  });

  it('TC-18: after every socket closes, a reconnecting client repopulates the room and a new client converges', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    await waitFor(() => a.received.length >= 1);
    createSticky(a.doc, { x: 5, y: 5 });
    createSticky(a.doc, { x: 6, y: 6 });
    await waitFor(() => a.snapshot().length === 2);

    // All sockets drop; then A reconnects (the room re-announces SyncStep1 and A
    // answers with SyncStep2, so the room's doc equals A). B then joins off A.
    a.close();
    await settle(300);
    const a2 = await openRoomClient(board);
    await waitFor(() => a2.snapshot().length === 2, 4000, 'reconnect did not restore A’s state');
    const b = await openRoomClient(board);
    await waitFor(() => snapshotsMatch(b.snapshot(), a2.snapshot()), 4000, 'B did not converge with A');
    a2.close();
    b.close();
  });

  it('TC-31: a dead socket mid-broadcast does not throw or stop later relays', async () => {
    const board = newBoardId();
    const a = await openRoomClient(board);
    const b = await openRoomClient(board);
    await synced(a, b);

    // B drops; A mutates immediately, so the room tries to relay to a dying socket.
    b.destroy();
    createSticky(a.doc, { x: 1, y: 1 });

    // The room keeps serving: a fresh client receives A's note and A keeps editing.
    const fresh = await openRoomClient(board);
    await waitFor(() => fresh.snapshot().length === 1, 4000, 'room stopped relaying after dead socket');
    createSticky(a.doc, { x: 2, y: 2 });
    await waitFor(() => fresh.snapshot().length === 2, 4000, 'A stopped propagating after dead socket');
    a.close();
    fresh.close();
  });
});
