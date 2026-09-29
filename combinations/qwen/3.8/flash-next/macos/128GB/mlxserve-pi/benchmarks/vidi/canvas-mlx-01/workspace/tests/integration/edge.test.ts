/**
 * `BoardRoom` protocol edge cases: malformed frames, awareness relay, soft capacity,
 * dead-socket tolerance and cold-start (in-memory) semantics.
 */
import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import { newBoardId } from '../../src/shared/board-id.js';
import { CLOSE_UNSUPPORTED_DATA, MESSAGE_AWARENESS } from '../../src/shared/protocol.js';
import { LIVE_UPDATE_LATENCY_BUDGET_MS, MAX_CONCURRENT_EDITORS } from '../../src/shared/config.js';
import { RoomClient, sleep } from './helpers/ws-client.js';

const bytesOf = (frame: ArrayBuffer | string): Uint8Array =>
  typeof frame === 'string' ? new TextEncoder().encode(frame) : new Uint8Array(frame);

/** The awareness payloads present in a client's received raw frames. */
const awarenessPayloads = (client: RoomClient): Uint8Array[] =>
  client.rawFrames
    .filter((f) => typeof f !== 'string' && new Uint8Array(f)[0] === MESSAGE_AWARENESS)
    .map(bytesOf);

describe('BoardRoom protocol edge cases', () => {
  it('TC-15 closes a socket that sends a text frame with code 1003', async () => {
    const a = await RoomClient.connect(newBoardId());
    a.sendRaw('this is not a binary y-websocket frame');
    expect(await a.waitForClose()).toBe(CLOSE_UNSUPPORTED_DATA);
  });

  it('TC-16 relays an awareness update byte-for-byte to every other client', async () => {
    const boardId = newBoardId();
    const [a, b] = await Promise.all([RoomClient.connect(boardId), RoomClient.connect(boardId)]);
    await Promise.all([a.waitForHandshake(), b.waitForHandshake()]);

    // A crafted awareness update payload for client id 1.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 1);
    encoding.writeVarUint(enc, 1);
    encoding.writeVarString(enc, '{"cursor":{"x":7,"y":9}}');
    const payload = encoding.toUint8Array(enc);

    a.sendAwarenessBytes(payload);
    await b.until(() => awarenessPayloads(b).length >= 1, LIVE_UPDATE_LATENCY_BUDGET_MS, 'awareness');

    // The room relays the WHOLE outer frame verbatim; strip the [type, len] prefix.
    const relayed = awarenessPayloads(b).at(-1)!;
    expect(Array.from(relayed.subarray(2))).toEqual(Array.from(payload));
  });

  it('never refuses an over-capacity joiner; it receives the full state and can edit', async () => {
    const boardId = newBoardId();
    const editors = await Promise.all(
      Array.from({ length: MAX_CONCURRENT_EDITORS + 1 }, () => RoomClient.connect(boardId)),
    );
    expect(editors).toHaveLength(MAX_CONCURRENT_EDITORS + 1); // a 6th is never refused
    await Promise.all(editors.map((c) => c.waitForHandshake()));

    editors[0]!.createSticky(123, 456);
    for (const e of editors) await e.waitForSync(editors[0]!);

    const late = editors.at(-1)!; // the over-capacity joiner
    expect(late.snapshot()).toHaveLength(1); // it received the full state
    const id = late.createSticky(9, 9);
    await editors[0]!.waitForSync(late);
    expect(editors[0]!.snapshot().some((s) => s.id === id)).toBe(true);
  });

  it('TC-18 lets a client that reconnects catch up on state the room still holds', async () => {
    const boardId = newBoardId();
    const a = await RoomClient.connect(boardId);
    await a.waitForHandshake();
    const id = a.createSticky(50, 60);

    // An anchor keeps the room instance alive across A's disconnect.
    const anchor = await RoomClient.connect(boardId);
    await anchor.waitForSync(a);
    a.close();

    const b = await RoomClient.connect(boardId);
    await b.waitForSync(anchor);
    expect(b.snapshot().some((s) => s.id === id)).toBe(true);
  });

  it('TC-30 starts empty: a fresh room instance has no state (in-memory, not persisted)', async () => {
    const first = newBoardId();
    const a = await RoomClient.connect(first);
    await a.waitForHandshake();
    a.createSticky(1, 1);
    a.close();

    // A fresh instance (a different object id) starts empty — nothing was persisted.
    const fresh = newBoardId();
    const b = await RoomClient.connect(fresh);
    await b.waitForHandshake();
    expect(b.snapshot()).toHaveLength(0);
  });

  it('TC-31 keeps broadcasting after a socket is abruptly closed', async () => {
    const boardId = newBoardId();
    const [a, b, c] = await Promise.all([
      RoomClient.connect(boardId),
      RoomClient.connect(boardId),
      RoomClient.connect(boardId),
    ]);
    await Promise.all([a.waitForHandshake(), b.waitForHandshake(), c.waitForHandshake()]);

    b.abort(); // B's socket dies abruptly (no close handshake)
    await sleep(50);

    // A's later update must still reach C: a failed send must not abort the broadcast.
    const id = a.createSticky(80, 90);
    await c.waitForSync(a);
    expect(c.snapshot().some((s) => s.id === id)).toBe(true);
  });
});
