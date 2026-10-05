/**
 * What happens when a connection goes away and comes back (task 6.10).
 *
 *   TC-28  a client that was offline catches the room up on what it changed while it
 *          was away, and catches itself up on what the room changed, both directions
 *          in one reconnect
 *
 * TC-18 (a room that starts empty is rebuilt from the first client back) and TC-31 (a
 * socket that dies mid-board) are in `board-room.test.ts`, next to the room behaviour
 * they describe.
 */

import { describe, expect, it, vi } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import { createSticky, getStickyText, moveObject } from '../../src/shared/board-model';
import { WsClient } from './helpers/ws-client';

function makeNote(client: WsClient, x: number, y: number, text: string): string {
  let id = '';
  client.transact((doc) => {
    const created = createSticky(doc, { x, y }, 'yellow');
    if (created === false) throw new Error('createSticky rejected the point');
    id = created;
    getStickyText(doc, id)?.insert(0, text);
  });
  return id;
}

describe('a client that was away (TC-28)', () => {
  it('brings its own changes and picks up everybody else\'s in one reconnect', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();

    // Alex closes the tab.
    alex.disconnect();
    await vi.waitFor(() => expect(alex.online).toBe(false));

    // Sam keeps working while Alex is gone.
    makeNote(sam, 300, 300, 'while you were out');
    await vi.waitFor(() => expect(sam.snapshot()).toHaveLength(1));

    // Alex types in the closed tab. Yjs keeps it: the document is not the connection.
    makeNote(alex, 0, 0, 'typed while offline');
    expect(alex.snapshot()).toHaveLength(1);
    // Nothing reached the room while the socket was closed.
    await sam.settle();
    expect(sam.snapshot().map((note) => note.text)).toEqual(['while you were out']);

    // The tab comes back.
    await alex.reconnect();
    await alex.waitForSync();

    // Both directions arrived in one go.
    await vi.waitFor(() => {
      expect(sam.snapshot().map((note) => note.text).sort()).toEqual([
        'typed while offline',
        'while you were out',
      ]);
    });
    await vi.waitFor(() => expect(alex.snapshot()).toEqual(sam.snapshot()));
    expect(alex.online).toBe(true);
  });

  it('three local edits made while offline all arrive, in any order', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();

    alex.disconnect();
    await vi.waitFor(() => expect(alex.online).toBe(false));
    for (let index = 0; index < 3; index++) makeNote(alex, index * 100, 0, `offline note ${index}`);
    expect(alex.snapshot()).toHaveLength(3);

    await alex.reconnect();
    await alex.waitForSync();

    await vi.waitFor(() => expect(sam.snapshot()).toHaveLength(3));
    expect(sam.snapshot().map((note) => note.text).sort()).toEqual([
      'offline note 0',
      'offline note 1',
      'offline note 2',
    ]);
    expect(alex.snapshot()).toEqual(sam.snapshot());
  });

  it('a reconnecting client learns what it missed and keeps its own edit', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    const id = makeNote(alex, 0, 0, 'shared');
    await sam.waitForSync();

    alex.disconnect();
    await vi.waitFor(() => expect(alex.online).toBe(false));
    // Sam moves the note and writes in it while Alex is away; Alex moves the same note.
    sam.transact((doc) => {
      moveObject(doc, id, 888, 888);
      getStickyText(doc, id)?.insert(0, 'sam was here ');
    });
    alex.transact((doc) => getStickyText(doc, id)?.insert(0, 'alex too '));
    await vi.waitFor(() => expect(sam.snapshot()[0]?.text).toBe('sam was here shared'));

    await alex.reconnect();
    await alex.waitForSync();

    await vi.waitFor(() => {
      expect(alex.snapshot()[0]?.text).toBe(sam.snapshot()[0]?.text);
    });
    const text = alex.snapshot()[0]?.text ?? '';
    expect(text).toContain('sam was here');
    expect(text).toContain('alex too');
    expect(alex.snapshot()[0]?.x).toBe(sam.snapshot()[0]?.x);
  });

  it('a client that reconnects twice still sees one board, not two', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    await alex.waitForSync();
    makeNote(alex, 0, 0, 'once');

    await alex.reconnect();
    await alex.waitForSync();
    await alex.reconnect();
    await alex.waitForSync();

    expect(alex.snapshot()).toHaveLength(1);
    const late = await WsClient.connect(boardId);
    await late.waitForSync();
    expect(late.snapshot()).toEqual(alex.snapshot());
  });

  it('an offline client that is not connected cannot disrupt the room', async () => {
    const boardId = newBoardId();
    const alex = await WsClient.connect(boardId);
    const sam = await WsClient.connect(boardId);
    await alex.waitForSync();
    await sam.waitForSync();
    alex.disconnect();
    await vi.waitFor(() => expect(alex.online).toBe(false));

    // Edits made offline send nothing: they sit in the document until the socket is back.
    alex.clearReceived();
    makeNote(alex, 0, 0, 'quietly');
    await sam.settle();
    expect(sam.snapshot()).toEqual([]);
    expect(alex.received).toEqual([]);

    makeNote(sam, 10, 10, 'room still alive');
    await vi.waitFor(() => expect(sam.snapshot()).toHaveLength(1));
    await alex.reconnect();
    await alex.waitForSync();
    await vi.waitFor(() => expect(alex.snapshot()).toHaveLength(2));
  });
});
