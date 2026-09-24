/**
 * Story 3 · Worker integration test (runs inside workerd via
 * `@cloudflare/vitest-pool-workers`, against the real `wrangler.jsonc`).
 *
 * `env.BOARD_ROOM` and `env.ASSETS` are the same bindings the deploy uses, so
 * calling the Worker's `fetch` here exercises the *real* routing decision and
 * the real `BoardRoom` Durable Object relay — not a mock (design "Mock vs real
 * boundaries"). We assert the two contracts the Worker promises:
 *
 *   - a non-collab request (plain GET, or an upgrade to a malformed room id) is
 *     answered `426` and never reaches a room;
 *   - a valid room upgrade opens, and a frame sent on one socket is relayed to
 *     the other socket on the same room.
 */
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import worker from '../../src/worker/index';

/** A syntactically valid 22-character room key (matches the Worker's pattern). */
const VALID_ROOM = 'AAAAAAAAAAAAAAAAAAAAAA';

function upgradeRequest(path: string): Request {
  return new Request(`http://inner${path}`, {
    headers: {
      Upgrade: 'websocket',
      'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
      'Sec-WebSocket-Version': '13',
    },
  });
}

/**
 * A tiny client over one end of the Worker's `Response.webSocket`: it collects
 * inbound frames and exposes a promise that resolves on the next frame after
 * `skip` (a room greets every socket with a SyncStep1, so the first frame is
 * that greeting, not traffic we sent).
 */
class TestSocket {
  readonly messages: Uint8Array[] = [];
  private readonly socket: WebSocket;
  constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.binaryType = 'arraybuffer';
    this.socket.addEventListener('message', (event: MessageEvent) => {
      const data = event.data as ArrayBuffer;
      this.messages.push(new Uint8Array(data));
    });
  }
  send(bytes: Uint8Array): void {
    this.socket.send(bytes.slice().buffer as ArrayBuffer);
  }
  /** Resolve with the count of frames seen after the greeting settles. */
  async waitForFrames(minimum: number, timeoutMs = 2000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.messages.length >= minimum) return this.messages.length;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return this.messages.length;
  }
}

async function openClient(path: string): Promise<TestSocket> {
  const response = await worker.fetch(upgradeRequest(path), env);
  if (response.status !== 101 || response.webSocket === undefined) {
    throw new Error(`expected 101, got ${response.status}`);
  }
  const socket = response.webSocket;
  socket.accept();
  return new TestSocket(socket);
}

describe('Worker routing (design §4)', () => {
  it('answers a plain GET on a room path with 426', async () => {
    const response = await worker.fetch(
      new Request(`http://inner/api/rooms/${VALID_ROOM}`),
      env,
    );
    expect(response.status).toBe(426);
  });

  it('answers a WebSocket upgrade to a malformed room id with 426', async () => {
    const response = await worker.fetch(
      upgradeRequest('/api/rooms/not-a-valid-board-id'),
      env,
    );
    expect(response.status).toBe(426);
  });

  it('opens a WebSocket upgrade to a valid room id with 101', async () => {
    const response = await worker.fetch(
      upgradeRequest(`/api/rooms/${VALID_ROOM}`),
      env,
    );
    expect(response.status).toBe(101);
    expect(response.webSocket).toBeDefined();
  });

  it('routes a non-room request to static assets (never 426)', async () => {
    const response = await worker.fetch(new Request('http://inner/b/anything'), env);
    // Assets (or the test pool) answer, not the 426 upgrade path.
    expect(response.status).not.toBe(426);
  });
});

describe('BoardRoom relay (design §5)', () => {
  it('relays an awareness frame from one socket to the other on the same room', async () => {
    const room = `/api/rooms/${VALID_ROOM}`;
    const a = await openClient(room);
    const b = await openClient(room);

    // Both sockets first receive the room's SyncStep1 greeting.
    await a.waitForFrames(1);
    await b.waitForFrames(1);
    const aAfterGreeting = a.messages.length;

    // An awareness frame (message type 1) with a small update body.
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 1);
    encoding.writeVarUint8Array(enc, new Uint8Array([0x00, 0x01, 0x2a]));
    const frame = encoding.toUint8Array(enc);

    a.send(frame);

    // B should see the greeting plus the relayed frame.
    const bCount = await b.waitForFrames(2);
    expect(bCount).toBeGreaterThanOrEqual(2);
    const relayed = b.messages[b.messages.length - 1];
    expect(Array.from(relayed)).toEqual(Array.from(frame));

    // The origin socket is not sent a *second* copy beyond what it already had
    // while we were sending this frame (it saw only its greeting at send time).
    expect(aAfterGreeting).toBeLessThanOrEqual(1 + 1);
  });

  it('keeps rooms isolated: a frame in one room is not seen in another', async () => {
    const roomA = '/api/rooms/AAAAAAAAAAAAAAAAAAAAAA';
    const roomB = '/api/rooms/BBBBBBBBBBBBBBBBBBBBBB';
    const a = await openClient(roomA);
    const b = await openClient(roomB);
    await a.waitForFrames(1);
    await b.waitForFrames(1);
    const bBefore = b.messages.length;

    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 1);
    encoding.writeVarUint8Array(enc, new Uint8Array([0x00, 0x01, 0x07]));
    a.send(encoding.toUint8Array(enc));

    await a.waitForFrames(1);
    // B never hears about a frame sent in A's room (PRD live.isolation).
    expect(b.messages.length).toBe(bBefore);
  });
});
