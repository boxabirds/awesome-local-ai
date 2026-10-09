import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
  type StickySnapshot,
} from '../../src/shared/board-model';
import { encodeFrame, MESSAGE_SYNC } from '../../src/shared/protocol';
import { boardUrl, RoomClient, sameNotes, waitUntil } from './ws-client';

async function twoClients(): Promise<{ A: RoomClient; B: RoomClient }> {
  const board = newBoardId();
  const A = await RoomClient.connect(boardUrl(board));
  const B = await RoomClient.connect(boardUrl(board));
  await A.waitForSync();
  await B.waitForSync();
  return { A, B };
}

describe('BoardRoom (workerd, real worker + real Durable Object)', () => {
  it('TC-07: room is created on first connect; a fresh client sees an empty board', async () => {
    const A = await RoomClient.connect(boardUrl(newBoardId()));
    await A.waitForSync();
    expect(A.notes()).toHaveLength(0);
    A.close();
  });

  it('TC-08: one client creates a sticky; the other receives it unchanged', async () => {
    const { A, B } = await twoClients();
    const id = createSticky(A.doc, { x: 100, y: 200 }, 'green');
    expect(id).toBeTruthy();
    await B.waitForUpdates(1);
    await waitUntil(() => B.notes().length === 1);
    expect(B.notes()).toHaveLength(1);
    expect(B.notes()[0]).toMatchObject({
      id,
      type: 'sticky',
      x: 100,
      y: 200,
      color: 'green',
      text: '',
    });
    A.close();
    B.close();
  });

  it('TC-09: concurrent text edits before exchange merge on both', async () => {
    const { A, B } = await twoClients();
    const id = createSticky(A.doc, { x: 0, y: 0 });
    await waitUntil(() => B.notes().some((n) => n.id === id));
    // seed the shared text "green"
    getStickyText(A.doc, id)!.insert(0, 'green');
    await waitUntil(() => B.notes().find((n) => n.id === id)?.text === 'green');

    // diverge locally, holding the wire
    A.hold = true;
    B.hold = true;
    getStickyText(A.doc, id)!.insert(0, 'red ');
    getStickyText(B.doc, id)!.insert(5, ' blue');
    // flush both; order on the wire is arbitrary
    A.release();
    B.release();

    await waitUntil(
      () =>
        A.notes().find((n) => n.id === id)?.text === 'red green blue' &&
        B.notes().find((n) => n.id === id)?.text === 'red green blue',
    );
    A.close();
    B.close();
  });

  it('TC-10: concurrent moves converge to one position', async () => {
    const { A, B } = await twoClients();
    const id = createSticky(A.doc, { x: 0, y: 0 });
    await waitUntil(() => B.notes().some((n) => n.id === id));

    A.hold = true;
    B.hold = true;
    expect(moveObject(A.doc, id, 100, 0)).toBe(true);
    expect(moveObject(B.doc, id, 300, 0)).toBe(true);
    A.release();
    B.release();

    await waitUntil(() => {
      const na = A.notes().find((n) => n.id === id);
      const nb = B.notes().find((n) => n.id === id);
      return na !== undefined && nb !== undefined && na.x === nb.x && na.y === nb.y;
    });
    const na = A.notes().find((n) => n.id === id)!;
    const nb = B.notes().find((n) => n.id === id)!;
    expect(na.x).toBe(nb.x);
    expect([100, 300]).toContain(na.x);
    A.close();
    B.close();
  });

  it('TC-11: delete vs concurrent text insert: the note is gone everywhere', async () => {
    const { A, B } = await twoClients();
    const id = createSticky(A.doc, { x: 0, y: 0 });
    await waitUntil(() => B.notes().some((n) => n.id === id));

    A.hold = true;
    B.hold = true;
    getStickyText(B.doc, id)!.insert(0, 'concurrent');
    expect(deleteObject(A.doc, id)).toBe(true);
    A.release();
    B.release();

    await waitUntil(() => A.notes().length === 0 && B.notes().length === 0);
    A.close();
    B.close();
  });

  it('TC-13: the 6th editor (MAX_CONCURRENT_EDITORS + 1) can join and be heard', async () => {
    const board = newBoardId();
    const clients: RoomClient[] = [];
    for (let i = 0; i < 6; i++) {
      const c = await RoomClient.connect(boardUrl(board));
      await c.waitForSync();
      clients.push(c);
    }
    // the last joiner creates; everyone else must receive it
    const id = createSticky(clients[5].doc, { x: 42, y: 42 }, 'blue');
    await Promise.all(
      clients.slice(0, 5).map(async (c) => {
        await waitUntil(() => c.notes().some((n) => n.id === id));
      }),
    );
    for (const c of clients) c.close();
  });
});
