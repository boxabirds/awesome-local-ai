/**
 * BoardRoom behaviour tests (design TC-07 to TC-12, TC-14 to TC-16, TC-18,
 * TC-31).
 *
 * Real Worker + real Durable Object in workerd, real Y.Doc clients, real
 * protocol frames — no mocks anywhere in this file.
 *
 * TC-18 note: workerd cannot kill a live Durable Object instance mid-test,
 * so "restart" is simulated with a fresh room id (identical to a restarted
 * room: an empty in-memory doc) plus a client that reconnects carrying its
 * previous state — the exact repopulation path a restart exercises.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import * as Y from 'yjs';
import { newBoardId } from '../../src/shared/board-id';
import { WsClient, sameNotes } from './fixtures/ws-client';
import { applyRandomOps } from './fixtures/random-ops';

const clients: WsClient[] = [];

function track(client: WsClient): WsClient {
  clients.push(client);
  return client;
}

afterEach(() => {
  for (const client of clients.splice(0)) {
    client.close();
  }
});

describe('BoardRoom sync', () => {
  it('TC-07: two clients in the same room sync both ways', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    const b = track(await WsClient.connect(board));
    await a.waitForSync();
    await b.waitForSync();

    const aIdA = a.addNote('hello from a');
    const bIdB = b.addNote('hello from b');

    await a.waitForObjects((o) => o.some((n) => n.text === 'hello from b'));
    await b.waitForObjects((o) => o.some((n) => n.text === 'hello from a'));
    // Sticky ids are shared Yjs type ids: after sync both clients refer to
    // the same note with the same id (the creator's client id).
    expect(a.noteIdByText('hello from a')).toBe(aIdA);
    expect(b.noteIdByText('hello from a')).toBe(aIdA);
    expect(a.noteIdByText('hello from b')).toBe(bIdB);
    expect(b.noteIdByText('hello from b')).toBe(bIdB);
  });

  it('TC-08: boards are isolated — a note on board X never reaches board Y', async () => {
    const boardX = newBoardId();
    const boardY = newBoardId();
    const a = track(await WsClient.connect(boardX));
    const b = track(await WsClient.connect(boardY));
    await a.waitForSync();
    await b.waitForSync();

    a.addNote('only on X');
    // give the room plenty of time to (not) deliver
    await new Promise((r) => setTimeout(r, 500));
    expect(b.objects()).toHaveLength(0);
    expect(b.updateCount).toBe(0);
  });

  it('TC-09: simultaneous adds from two clients — no lost create', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    const b = track(await WsClient.connect(board));
    await a.waitForSync();
    await b.waitForSync();

    a.suspendSend();
    b.suspendSend();
    const idA = a.addNote('simultaneous A');
    const idB = b.addNote('simultaneous B');
    a.resumeSend();
    b.resumeSend();

    await a.waitForConvergence(b);
    expect(idA).not.toBe(idB);
    expect(a.objects()).toHaveLength(2);
    expect(a.objects().map((o) => o.text).sort()).toEqual(['simultaneous A', 'simultaneous B']);
    expect(sameNotes(a.objects(), b.objects())).toBe(true);
  });

  it('TC-10: simultaneous edits of the same note converge on identical text', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    const b = track(await WsClient.connect(board));
    await a.waitForSync();
    await b.waitForSync();

    const id = a.addNote('base');
    await b.waitForObjects((o) => o.some((n) => n.id === id));

    // both append to the same note without seeing the other's change
    a.suspendSend();
    b.suspendSend();
    a.setText(id, 'base red');
    b.setText(id, 'base blue');
    a.resumeSend();
    b.resumeSend();

    await a.waitForConvergence(b);
    const textA = a.objects().find((o) => o.id === id)?.text;
    const textB = b.objects().find((o) => o.id === id)?.text;
    expect(textA).toBe(textB);
    expect(textA).toContain('red');
    expect(textA).toContain('blue');
  });

  it('TC-11: concurrent create + delete of different objects converges', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    const b = track(await WsClient.connect(board));
    await a.waitForSync();
    await b.waitForSync();

    // deterministic concurrent mix, plus the seeded random-op generator from
    // the design (applied to both sides with different seeds)
    a.suspendSend();
    b.suspendSend();
    const temp = a.addNote('temp on a');
    a.deleteNote(temp);
    const keep = b.addNote('keep on b');
    applyRandomOps(a.doc, 42, 8);
    applyRandomOps(b.doc, 7, 8);
    a.resumeSend();
    b.resumeSend();

    await a.waitForConvergence(b, 10_000);
    const kept = a.objects().find((o) => o.id === keep);
    expect(kept?.text).toBe('keep on b');
    expect(a.objects().some((o) => o.id === temp)).toBe(false);
  });

  it('TC-12: delete beats a concurrent edit of the same note; no errors, both converge', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    const b = track(await WsClient.connect(board));
    await a.waitForSync();
    await b.waitForSync();

    const id = a.addNote('doomed');
    await b.waitForObjects((o) => o.some((n) => n.id === id));

    a.suspendSend();
    b.suspendSend();
    a.deleteNote(id);
    b.setText(id, 'doomed edited');
    a.resumeSend();
    b.resumeSend();

    await a.waitForConvergence(b);
    expect(a.objects().some((o) => o.id === id)).toBe(false);
    expect(b.objects().some((o) => o.id === id)).toBe(false);
    // both clients still functional
    a.addNote('still alive');
    await b.waitForObjects((o) => o.some((n) => n.text === 'still alive'));
  });

  it('TC-31: six participants, no connection cap or 503', async () => {
    const board = newBoardId();
    const everyone: WsClient[] = [];
    for (let i = 0; i < 6; i++) {
      const c = track(await WsClient.connect(board));
      await c.waitForSync();
      everyone.push(c);
    }
    for (let i = 0; i < 6; i++) {
      everyone[i].addNote(`note ${i}`);
    }
    for (const c of everyone) {
      await c.waitForObjects((o) => o.length === 6, 10_000);
      expect(c.objects().map((o) => o.text).sort()).toEqual(
        [0, 1, 2, 3, 4, 5].map((i) => `note ${i}`).sort(),
      );
    }
  });
});

describe('BoardRoom malformed input', () => {
  it('TC-14: an undecodable frame closes that socket with 1003; others keep working', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    const b = track(await WsClient.connect(board));
    await a.waitForSync();
    await b.waitForSync();

    // unknown message type byte
    b.sendRaw(new Uint8Array([255, 1, 2]));
    await b.waitForClose();
    expect(b.closedWithUnsupported).toBe(true);

    // the room and the other socket are unaffected
    a.addNote('after the close');
    await new Promise((r) => setTimeout(r, 200));
    expect(a.objects().some((o) => o.text === 'after the close')).toBe(true);
  });

  it('TC-15: a frame that decodes but is not a valid Yjs update is closed with 1003', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    const b = track(await WsClient.connect(board));
    await a.waitForSync();
    await b.waitForSync();

    // valid outer envelope (MESSAGE_SYNC) wrapping garbage that is not a
    // decodable Update (unknown sync type 9 + junk bytes)
    const inner = new Uint8Array([9, 0xff, 0xfe, 0xfd]);
    const frame = new Uint8Array([0, inner.byteLength, ...inner]);
    b.sendRaw(frame);
    await b.waitForClose();
    expect(b.closedWithUnsupported).toBe(true);

    // room doc is intact and the other client still syncs
    a.addNote('room intact');
    await new Promise((r) => setTimeout(r, 200));
    expect(a.objects().some((o) => o.text === 'room intact')).toBe(true);
  });

  it('TC-16: an invalid board id is rejected at the route; an in-room client is unaffected', async () => {
    const board = newBoardId();
    const a = track(await WsClient.connect(board));
    await a.waitForSync();

    const res = await SELF.fetch('http://localhost/api/rooms/%2e%2e%2fetc', {
      headers: { Upgrade: 'websocket', Connection: 'Upgrade' },
    });
    expect(res.status).toBe(400);

    const b = track(await WsClient.connect(board));
    await b.waitForSync();
    a.addNote('unaffected');
    await b.waitForObjects((o) => o.some((n) => n.text === 'unaffected'));
  });
});

describe('BoardRoom restart (simulated)', () => {
  it('TC-18: after a restart the first reconnecting client repopulates the room', async () => {
    // "before the restart": client a works on a board and holds its state
    const boardBefore = newBoardId();
    const a = track(await WsClient.connect(boardBefore));
    await a.waitForSync();
    a.addNote('survives the restart');
    const savedState = Y.encodeStateAsUpdate(a.doc);
    a.close();
    await new Promise((r) => setTimeout(r, 100));

    // "the restart": a fresh room id is byte-for-byte what a restarted DO
    // is (an empty in-memory doc); a reconnects carrying its state
    const boardAfter = newBoardId();
    const a2 = track(
      await WsClient.connect(boardAfter, { initialState: savedState }),
    );
    await a2.waitForSync();

    // a late joiner receives the repopulated content
    const b = track(await WsClient.connect(boardAfter));
    await b.waitForSync();
    await b.waitForObjects((o) => o.some((n) => n.text === 'survives the restart'));
  });
});
