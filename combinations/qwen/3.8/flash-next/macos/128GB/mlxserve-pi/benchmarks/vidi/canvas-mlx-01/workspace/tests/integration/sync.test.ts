/**
 * `BoardRoom` Y.Doc merge, broadcast, and echo suppression (`sync.merge_*`,
 * `sync.broadcast_*`). Two-to-five real clients, driven over real sockets.
 */
import { describe, expect, it } from 'vitest';
import { newBoardId } from '../../src/shared/board-id.js';
import { RoomClient, sameSnapshot } from './helpers/ws-client.js';

/** Bring every client fully through the initial handshake before any edits. */
const syncAll = async (clients: RoomClient[]): Promise<void> => {
  await Promise.all(clients.map((c) => c.waitForHandshake()));
};

describe('BoardRoom merge and broadcast (sync.merge / sync.broadcast)', () => {
  it('TC-07 broadcasts a new sticky to every other editor (exactly one update)', async () => {
    const boardId = newBoardId();
    const [a, b] = await Promise.all([RoomClient.connect(boardId), RoomClient.connect(boardId)]);
    await syncAll([a, b]);

    const base = b.updatesReceived;
    const id = a.createSticky(100, 200);
    await b.waitForSync(a);

    const noteA = a.snapshot().find((s) => s.id === id)!;
    const noteB = b.snapshot().find((s) => s.id === id);
    expect(noteB).toBeDefined();
    expect(noteB).toEqual(noteA);
    expect(b.updatesReceived - base).toBe(1);
  });

  it('TC-08 does not echo an update back to its sender', async () => {
    const boardId = newBoardId();
    const [a, b] = await Promise.all([RoomClient.connect(boardId), RoomClient.connect(boardId)]);
    await syncAll([a, b]);

    const aBase = a.updatesReceived;
    a.createSticky(10, 20);
    await b.waitForSync(a);
    // The sender received nothing back for its own change.
    expect(a.updatesReceived).toBe(aBase);
  });

  it('TC-09 propagates a move to the final position', async () => {
    const boardId = newBoardId();
    const [a, b] = await Promise.all([RoomClient.connect(boardId), RoomClient.connect(boardId)]);
    await syncAll([a, b]);
    const id = a.createSticky(0, 0);
    await b.waitForSync(a);
    a.move(id, 300, 400);
    await b.waitForSync(a);
    const note = b.snapshot().find((s) => s.id === id);
    expect(note).toMatchObject({ x: 300, y: 400 });
  });

  it('TC-10 converges concurrent colours to a single value on both editors', async () => {
    const boardId = newBoardId();
    const [a, b] = await Promise.all([RoomClient.connect(boardId), RoomClient.connect(boardId)]);
    await syncAll([a, b]);
    const id = a.createSticky(0, 0);
    await b.waitForSync(a);

    a.setColor(id, 'green');
    b.setColor(id, 'pink');
    // Let both changes propagate both ways.
    await a.waitForSync(b);
    await b.waitForSync(a);

    const colorA = a.snapshot().find((s) => s.id === id)!.color;
    const colorB = b.snapshot().find((s) => s.id === id)!.color;
    expect(colorA).toBe(colorB); // one value, agreed
    expect(['green', 'pink']).toContain(colorA);
  });

  it('TC-11 merges concurrent text on both sides', async () => {
    const boardId = newBoardId();
    const [a, b] = await Promise.all([RoomClient.connect(boardId), RoomClient.connect(boardId)]);
    await syncAll([a, b]);
    const id = a.createSticky(0, 0);
    await b.waitForSync(a);

    a.insertText(id, 0, 'Hel');
    b.insertText(id, 0, 'lo');
    await a.waitForSync(b);
    await b.waitForSync(a);

    const textA = a.snapshot().find((s) => s.id === id)!.text;
    const textB = b.snapshot().find((s) => s.id === id)!.text;
    expect(textA).toBe(textB);
    expect(textA).toContain('Hel');
    expect(textA).toContain('lo');
  });

  it('TC-12 keeps concurrently created notes with different ids', async () => {
    const boardId = newBoardId();
    const [a, b] = await Promise.all([RoomClient.connect(boardId), RoomClient.connect(boardId)]);
    await syncAll([a, b]);
    const idA = a.createSticky(0, 0);
    const idB = b.createSticky(50, 50);
    await a.waitForSync(b);

    const snapA = a.snapshot().map((s) => s.id);
    const snapB = b.snapshot().map((s) => s.id);
    expect(snapA).toEqual(expect.arrayContaining([idA, idB]));
    expect(snapB).toEqual(expect.arrayContaining([idA, idB]));
    expect(a.snapshot()).toHaveLength(2);
  });

  it('TC-13 propagates a delete and still accepts a new note afterwards', async () => {
    const boardId = newBoardId();
    const [a, b] = await Promise.all([RoomClient.connect(boardId), RoomClient.connect(boardId)]);
    await syncAll([a, b]);
    const id = a.createSticky(1, 1);
    await b.waitForSync(a);
    expect(b.snapshot()).toHaveLength(1);

    a.delete(id);
    await b.waitForSync(a);
    expect(b.snapshot()).toHaveLength(0);

    const second = b.createSticky(2, 2);
    await a.waitForSync(b);
    expect(a.snapshot().some((s) => s.id === second)).toBe(true);
  });

  it('TC-14 converges five editors each adding a note', async () => {
    const boardId = newBoardId();
    const editors = await Promise.all(
      Array.from({ length: 5 }, () => RoomClient.connect(boardId)),
    );
    await syncAll(editors);
    for (const e of editors) e.createSticky(Math.random() * 500, Math.random() * 500);
    // Every editor must converge to the same five-note snapshot.
    for (const e of editors) await e.waitForSync(editors[0]!);
    for (const e of editors) expect(e.snapshot()).toHaveLength(5);
    for (let i = 1; i < editors.length; i++) {
      expect(sameSnapshot(editors[0]!.snapshot(), editors[i]!.snapshot())).toBe(true);
    }
  });
});
