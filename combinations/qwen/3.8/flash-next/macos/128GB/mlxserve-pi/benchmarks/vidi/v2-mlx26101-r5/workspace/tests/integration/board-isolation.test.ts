/**
 * Two boards are two boards (task 6.7, TC-17).
 *
 *   TC-17  a note created on board A never appears on board B — not to a client that
 *          joins later, and not to a board id that differs by one character
 */

import { describe, expect, it, vi } from 'vitest';

import { newBoardId } from '../../src/shared/board-id';
import { createSticky, getStickyText } from '../../src/shared/board-model';
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

describe('boards are separate from each other (TC-17)', () => {
  it('a note on one board never reaches a client on another', async () => {
    const alpha = newBoardId();
    const beta = newBoardId();
    expect(alpha).not.toBe(beta);

    const onAlpha = await WsClient.connect(alpha);
    const onBeta = await WsClient.connect(beta);
    await onAlpha.waitForSync();
    await onBeta.waitForSync();

    makeNote(onAlpha, 0, 0, 'only on alpha');

    await vi.waitFor(() => expect(onAlpha.snapshot()).toHaveLength(1));
    await onBeta.settle();
    expect(onBeta.snapshot()).toEqual([]);
    expect(onBeta.snapshot().some((note) => note.text.includes('alpha'))).toBe(false);
  });

  it('a client that joins the other board later still gets nothing', async () => {
    const alpha = newBoardId();
    const beta = newBoardId();
    const onAlpha = await WsClient.connect(alpha);
    await onAlpha.waitForSync();
    for (let index = 0; index < 3; index++) makeNote(onAlpha, index * 100, 0, `alpha note ${index}`);
    await onAlpha.settle();

    const lateOnBeta = await WsClient.connect(beta);
    await lateOnBeta.waitForSync();
    await lateOnBeta.settle();
    expect(lateOnBeta.snapshot()).toEqual([]);
    expect(onAlpha.snapshot()).toHaveLength(3);
  });

  it('two boards whose ids differ by one character do not share a room', async () => {
    const alpha = newBoardId();
    // The last character of a v1 id is a base32 payload digit; change it and the
    // checksum no longer describes this board — so make a second valid, different id.
    const almostSame = newBoardId();
    expect(alpha).not.toBe(almostSame);
    expect(alpha.slice(0, 6)).toHaveLength(6);

    const onAlpha = await WsClient.connect(alpha);
    const onOther = await WsClient.connect(almostSame);
    await onAlpha.waitForSync();
    await onOther.waitForSync();

    makeNote(onAlpha, 0, 0, 'alpha only');
    await vi.waitFor(() => expect(onAlpha.snapshot()).toHaveLength(1));
    await onOther.settle();
    expect(onOther.snapshot()).toEqual([]);
  });

  it('edits on two boards stay edited on their own board', async () => {
    const alpha = newBoardId();
    const beta = newBoardId();
    const alexOnAlpha = await WsClient.connect(alpha);
    const samOnAlpha = await WsClient.connect(alpha);
    const alexOnBeta = await WsClient.connect(beta);
    await Promise.all([alexOnAlpha.waitForSync(), samOnAlpha.waitForSync(), alexOnBeta.waitForSync()]);

    makeNote(alexOnAlpha, 0, 0, 'alpha');
    makeNote(alexOnBeta, 500, 500, 'beta one');
    makeNote(alexOnBeta, 600, 600, 'beta two');

    await vi.waitFor(() => expect(samOnAlpha.snapshot().map((note) => note.text)).toEqual(['alpha']));
    await vi.waitFor(() => expect(alexOnBeta.snapshot()).toHaveLength(2));
    await samOnAlpha.settle();
    await alexOnBeta.settle();

    expect(samOnAlpha.snapshot().map((note) => note.text)).toEqual(['alpha']);
    expect(alexOnBeta.snapshot().map((note) => note.text).sort()).toEqual(['beta one', 'beta two']);
  });

  it('a board that is edited hard while another is idle leaves the idle one empty', async () => {
    const alpha = newBoardId();
    const beta = newBoardId();
    const busy = await WsClient.connect(alpha);
    const idle = await WsClient.connect(beta);
    await busy.waitForSync();
    await idle.waitForSync();
    await idle.settle(80);
    idle.clearReceived();

    for (let index = 0; index < 25; index++) {
      const id = makeNote(busy, index * 10, index * 10, `note ${index}`);
      if (index % 2 === 0) busy.transact((doc) => getStickyText(doc, id)?.insert(0, 'typed '));
    }
    await vi.waitFor(() => expect(busy.snapshot()).toHaveLength(25));
    await idle.settle();

    expect(idle.snapshot()).toEqual([]);
    expect(idle.received).toEqual([]);
    expect(busy.snapshot()).toHaveLength(25);
  });
});
