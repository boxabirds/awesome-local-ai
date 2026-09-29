// BoardRoom Durable Object behaviour (spec: sync.room) against the REAL
// worker runtime. Every client here is a full y-protocol peer speaking through
// the actual `/api/rooms/:boardId` upgrade route.
//
// Test-case ids follow the spec coverage table (design.md) exactly.

import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_CONCURRENT_EDITORS,
  AWARENESS_HEARTBEAT_MS,
} from '../../src/shared/config';
import { newBoardId } from '../../src/shared/board-id';
import {
  createSticky,
  deleteObject,
  getStickyText,
  moveObject,
  setStickyColor,
} from '../../src/shared/board-model';
import {
  MESSAGE_AWARENESS,
  encodeFrameMessage,
} from '../../src/shared/protocol';
import * as encoding from 'lib0/encoding';
import {
  RoomClient,
  connectRoom,
  waitFor,
} from './helpers/ws-client';
import {
  applyOps,
  boardStatesEqual,
  generateRandomOps,
} from './helpers/random-ops';

const clients: RoomClient[] = [];
function track(client: RoomClient): RoomClient {
  clients.push(client);
  return client;
}

// Let the initial Step1/Step2 handshake settle so that subsequent local edits
// arrive as live UPDATE frames rather than as part of the join sync.
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

describe('BoardRoom sync (real worker)', () => {
  it('TC-07: a created sticky reaches the other peer as exactly one update', async () => {
    const boardId = newBoardId();
    const a = track(await connectRoom(boardId, { user: 'a' }));
    const b = track(await connectRoom(boardId, { user: 'b' }));
    await settle();

    createSticky(a.doc, { x: 10, y: 20 });

    await waitFor(() => b.noteCount() === 1, 4000, 'B sees the note');
    expect(boardStatesEqual(a.boardState(), b.boardState())).toBe(true);
    // The note arrived as exactly one UPDATE sync frame (type 2).
    expect(b.updateMessageCount).toBe(1);
  });

  it('TC-08: move / recolour / text insert / delete all reach the other peer, with no echo to the sender', async () => {
    const boardId = newBoardId();
    const a = track(await connectRoom(boardId, { user: 'a' }));
    const b = track(await connectRoom(boardId, { user: 'b' }));
    await settle();

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.noteCount() === 1, 4000, 'B sees the note');

    // move
    moveObject(a.doc, id, 111, 222);
    await waitFor(
      () => b.boardState()[0]?.x === 111 && b.boardState()[0]?.y === 222,
      4000,
      'move converges',
    );
    // recolour
    setStickyColor(a.doc, id, 'blue');
    await waitFor(() => b.boardState()[0]?.color === 'blue', 4000, 'recolour converges');
    // text insert
    getStickyText(a.doc, id)!.insert(0, 'hi');
    await waitFor(() => b.boardState()[0]?.text === 'hi', 4000, 'text converges');
    // delete
    deleteObject(a.doc, id);
    await waitFor(() => b.noteCount() === 0, 4000, 'delete converges');

    // A never received an echo of its own updates.
    expect(a.updateMessageCount).toBe(0);
  });

  it('TC-09: concurrent text inserts merge to the union on both peers', async () => {
    const boardId = newBoardId();
    const a = track(await connectRoom(boardId, { user: 'a' }));
    const b = track(await connectRoom(boardId, { user: 'b' }));
    await settle();

    const id = createSticky(a.doc, { x: 0, y: 0 });
    getStickyText(a.doc, id)!.insert(0, 'green');
    await waitFor(
      () => getStickyText(b.doc, id)?.toString() === 'green',
      4000,
      'both have the base text',
    );

    // Concurrent inserts on both sides before the updates are exchanged.
    getStickyText(a.doc, id)!.insert(0, 'red ');
    getStickyText(b.doc, id)!.insert('green'.length, ' blue');

    await waitFor(
      () =>
        getStickyText(a.doc, id)?.toString() === 'red green blue' &&
        getStickyText(b.doc, id)?.toString() === 'red green blue',
      4000,
      'both converge to the merged text',
    );
  });

  it('TC-10: concurrent moves of the same note converge to one position', async () => {
    const boardId = newBoardId();
    const a = track(await connectRoom(boardId, { user: 'a' }));
    const b = track(await connectRoom(boardId, { user: 'b' }));
    await settle();

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.noteCount() === 1, 4000, 'B sees the note');

    // Both move the same note to different x concurrently.
    moveObject(a.doc, id, 100, 0);
    moveObject(b.doc, id, 300, 0);

    await waitFor(
      () => a.boardState()[0]?.x === b.boardState()[0]?.x,
      4000,
      'both converge to the same x',
    );
    // Last-writer-wins: the settled x is one of the two contenders.
    expect([100, 300]).toContain(a.boardState()[0]?.x);
  });

  it('TC-11: a delete wins over a concurrent text insert; the note vanishes everywhere', async () => {
    const boardId = newBoardId();
    const a = track(await connectRoom(boardId, { user: 'a' }));
    const b = track(await connectRoom(boardId, { user: 'b' }));
    await settle();

    const id = createSticky(a.doc, { x: 0, y: 0 });
    await waitFor(() => b.noteCount() === 1, 4000, 'B sees the note');

    // A deletes while B concurrently inserts text into the note.
    deleteObject(a.doc, id);
    getStickyText(b.doc, id)?.insert(0, 'zombie');

    await waitFor(
      () => a.noteCount() === 0 && b.noteCount() === 0,
      4000,
      'note absent on both peers',
    );
    // B's text did not resurrect the note anywhere.
    expect(b.boardState()).toHaveLength(0);
    expect(a.boardState()).toHaveLength(0);
  });

  it('TC-12: two writers performing 200 seeded random ops each converge on identical snapshots', async () => {
    const boardId = newBoardId();
    const a = track(await connectRoom(boardId, { user: 'a' }));
    const b = track(await connectRoom(boardId, { user: 'b' }));
    await settle();

    applyOps(a.doc, generateRandomOps(42, 200));
    applyOps(b.doc, generateRandomOps(7, 200));

    await waitFor(
      () => boardStatesEqual(a.boardState(), b.boardState()),
      8000,
      'snapshots identical',
    );
    // Every note A created is present on B (and vice versa) unless deleted.
    expect(boardStatesEqual(b.boardState(), a.boardState())).toBe(true);
  }, 30000);

  it('TC-13: MAX_CONCURRENT_EDITORS + 1 peers are all accepted and stay in sync', async () => {
    const boardId = newBoardId();
    const count = MAX_CONCURRENT_EDITORS + 1;
    const peers: RoomClient[] = [];
    for (let i = 0; i < count; i++) {
      peers.push(track(await connectRoom(boardId, { user: `p${i}` })));
    }
    await settle();

    const id = createSticky(peers[0].doc, { x: 11, y: 12 });
    getStickyText(peers[0].doc, id)!.insert(0, 'everyone');

    for (const peer of peers) {
      await waitFor(() => peer.noteCount() === 1, 4000, 'peer sees the note');
    }
    for (const peer of peers) {
      expect(peer.boardState()[0]?.text).toBe('everyone');
    }
  }, 30000);

  it('TC-14: a late joiner catches up to the existing board via initial sync', async () => {
    const boardId = newBoardId();
    const a = track(await connectRoom(boardId, { user: 'a' }));
    const b = track(await connectRoom(boardId, { user: 'b' }));
    await settle();

    // A and B together create 20 notes.
    for (let i = 0; i < 10; i++) {
      createSticky(a.doc, { x: i * 10, y: 0 });
      createSticky(b.doc, { x: i * 10 + 5, y: 100 });
    }
    await waitFor(
      () => a.noteCount() === 20 && b.noteCount() === 20,
      4000,
      'A and B have all 20 notes',
    );

    const c = track(await connectRoom(boardId, { user: 'c' }));
    await waitFor(
      () => boardStatesEqual(a.boardState(), c.boardState()),
      4000,
      'C equals A after initial sync',
    );
  });

  it('TC-15: malformed traffic closes only the offending socket; the room stays healthy', async () => {
    const cases: { name: string; send: (ws: WebSocket) => void }[] = [
      { name: 'text frame', send: (ws) => ws.send('hello') },
      // SYNC frame whose UPDATE payload is truncated (decodable type, bad body).
      { name: 'truncated bytes', send: (ws) => ws.send(new Uint8Array([0, 2])) },
      { name: 'unknown type', send: (ws) => ws.send(new Uint8Array([9, 1, 2, 3])) },
      {
        name: 'invalid Yjs update',
        send: (ws) => {
          const enc = encoding.createEncoder();
          encoding.writeVarUint(enc, 0); // MESSAGE_SYNC
          encoding.writeVarUint(enc, 2); // UPDATE
          encoding.writeVarUint8Array(enc, new Uint8Array([255, 255, 255, 255]));
          ws.send(encoding.toUint8Array(enc));
        },
      },
    ];

    for (const c of cases) {
      const boardId = newBoardId();
      const b = track(await connectRoom(boardId, { user: 'b' }));
      const bad = track(await connectRoom(boardId, { user: 'bad' }));
      await new Promise((resolve) => setTimeout(resolve, 50));

      c.send(bad.ws);

      // The server closes the offending socket (CLOSE_UNSUPPORTED_DATA = 1003).
      // workerd does not surface the remote close code to the client, so we
      // assert the socket left the OPEN state (i.e. the server initiated it).
      await waitFor(
        () => bad.ws.readyState >= WebSocket.CLOSING,
        4000,
        `${c.name}: bad socket closed by the room`,
      );

      // The room is still healthy: a new writer's note still reaches B.
      const good = track(await connectRoom(boardId, { user: 'good' }));
      createSticky(good.doc, { x: 1, y: 1 });
      await waitFor(() => b.noteCount() === 1, 4000, `${c.name}: B still receives`);
    }
  }, 30000);

  it('TC-16: an awareness frame is relayed verbatim to every peer including the sender', async () => {
    const boardId = newBoardId();
    const a = track(await connectRoom(boardId, { user: 'a' }));
    const b = track(await connectRoom(boardId, { user: 'b' }));
    await settle();

    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    a.ws.send(encodeFrameMessage(MESSAGE_AWARENESS, bytes));

    const same = (arr: Uint8Array[]) =>
      arr.some((p) => p.length === bytes.length && p.every((v, i) => v === bytes[i]));
    await waitFor(
      () => same(a.receivedAwareness) && same(b.receivedAwareness),
      4000,
      'A and B both receive identical awareness bytes',
    );
  });

  it('TC-17: updates never cross board boundaries', async () => {
    const boardA = newBoardId();
    const boardB = newBoardId();
    const a = track(await connectRoom(boardA, { user: 'a' }));
    const b = track(await connectRoom(boardB, { user: 'b' }));
    await settle();

    createSticky(a.doc, { x: 1, y: 1 });
    await waitFor(() => a.noteCount() === 1, 4000, 'A has its note');
    // Give the relay a chance to (wrongly) leak into B's board.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(b.noteCount()).toBe(0);
  });

  it('TC-18: a restarted room is repopulated from a reconnecting client, and a joiner converges', async () => {
    // Original room: A creates content, then the room "restarts" (fresh object
    // id => a brand-new, empty room).
    const board1 = newBoardId();
    const a = track(await connectRoom(board1, { user: 'a' }));
    createSticky(a.doc, { x: 1, y: 2 });
    createSticky(a.doc, { x: 3, y: 4 });
    getStickyText(a.doc, a.boardState()[0].id)!.insert(0, 'hello');
    await waitFor(() => a.noteCount() === 2, 4000, 'A has 2 notes');
    a.close();
    clients.pop();

    // Fresh room (new object id). A reconnects first, carrying its doc state.
    const board2 = newBoardId();
    const a2 = track(
      await connectRoom(board2, { user: 'a', doc: a.doc }),
    );
    // B joins the fresh room and must converge to A's content.
    const b = track(await connectRoom(board2, { user: 'b' }));

    await waitFor(
      () => boardStatesEqual(a2.boardState(), b.boardState()) && b.noteCount() === 2,
      4000,
      'fresh room repopulated and B converged',
    );
    expect(b.boardState().some((n) => n.text === 'hello')).toBe(true);
  });

  it('TC-31: an idle connection is kept alive by awareness traffic', async () => {
    const boardId = newBoardId();
    const a = track(await connectRoom(boardId, { user: 'a' }));
    const b = track(await connectRoom(boardId, { user: 'b' }));
    await settle();

    // No sync traffic at all: the only frames flowing are awareness relays.
    // B's periodic awareness heartbeat keeps the room (and A) receiving
    // traffic while idle.
    await new Promise((resolve) =>
      setTimeout(resolve, AWARENESS_HEARTBEAT_MS + 1000),
    );
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    expect(b.ws.readyState).toBe(WebSocket.OPEN);

    // The room is still fully functional after the idle period.
    const id = createSticky(a.doc, { x: 9, y: 9 });
    getStickyText(a.doc, id)!.insert(0, 'after idle');
    await waitFor(() => b.noteCount() === 1, 4000, 'B sees the post-idle note');
    // The text is a second update frame right after the note: wait for it to
    // converge rather than racing the relay.
    await waitFor(() => b.boardState()[0]?.text === 'after idle', 4000, 'text converges');
  }, 30000);
});
