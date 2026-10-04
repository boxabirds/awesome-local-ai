import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  frameData,
  type Decoded,
} from '../../src/shared/protocol';

/**
 * TC-03 (`sync.room`): the room's one piece of pure logic is turning a received frame into
 * a typed message. The frames below are built with the same `lib0` encoders the browser
 * provider and the Durable Object use, so this is the real framing.
 */

/** A sync frame: type, then a y-protocols sync message (here step 1 with a state vector). */
function syncFrame(stateVector: number[]): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, 0); // messageYjsSyncStep1
  encoding.writeVarUint8Array(encoder, new Uint8Array(stateVector));
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

/** An awareness frame: type, then the awareness update bytes. */
function awarenessFrame(update: number[]): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, new Uint8Array(update));
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

/** A frame with an arbitrary type number and payload. */
function frame(type: number, payload: number[]): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  for (const byte of payload) {
    encoding.writeUint8(encoder, byte);
  }
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

describe('decodeMessage (TC-03)', () => {
  it('types a sync frame and hands back its payload', () => {
    const decoded = decodeMessage(syncFrame([1, 2, 3]));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') {
      // The payload is the sync message itself: step 1 plus its state vector.
      expect(Array.from(decoded.payload)).toEqual([0, 3, 1, 2, 3]);
    }
  });

  it('types an awareness frame and hands back its payload', () => {
    const decoded = decodeMessage(awarenessFrame([7, 8]));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') {
      expect(Array.from(decoded.payload)).toEqual([2, 7, 8]);
    }
  });

  it('types an awareness query', () => {
    expect(decodeMessage(frame(MESSAGE_QUERY_AWARENESS, []))).toEqual({
      kind: 'query-awareness',
    });
  });

  it('reports an unknown message type as invalid (error path)', () => {
    const decoded: Decoded = decodeMessage(frame(9, [1, 2, 3]));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') {
      expect(decoded.reason.length).toBeGreaterThan(0);
    }
  });

  it('reports truncated frames as invalid (error path)', () => {
    // empty, a sync type with no message, an awareness type with no update, and a varUint
    // that runs off the end of the frame. (A sync message whose *body* is cut short decodes
    // fine and is rejected by the room when yjs refuses to apply it.)
    const cases: number[][] = [[], [MESSAGE_SYNC], [MESSAGE_AWARENESS], [128, 200, 128]];
    for (const raw of cases) {
      const decoded = decodeMessage(new Uint8Array(raw).buffer as ArrayBuffer);
      expect(decoded.kind).toBe('invalid');
      if (decoded.kind === 'invalid') {
        expect(decoded.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it('reports a text frame as invalid (error path)', () => {
    const decoded = decodeMessage('hello');
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') {
      expect(decoded.reason).toMatch(/binary|text/i);
    }
  });

  it('exposes the y-websocket framing constants', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});

/**
 * What a received frame is made of before it is decoded.
 *
 * A frame sent by a socket inside the same runtime arrives as an `ArrayBuffer`; a frame that
 * comes in through a proxy in front of the runtime - which is how a browser reaches a room -
 * arrives as a `Blob` holding the same bytes. Reading the second shape wrongly is not subtle:
 * the bytes of a `Blob` read as an `ArrayBuffer` are no bytes, so the first thing a browser
 * ever sends looks like an empty frame and the room hangs up on it.
 */
describe('frameData', () => {
  it('reads the bytes out of a Blob frame', async () => {
    const frame = syncFrame([1, 2, 3]);
    const fromBlob = await frameData(new Blob([new Uint8Array(frame)]));

    expect(fromBlob).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(fromBlob as ArrayBuffer))).toEqual(
      Array.from(new Uint8Array(frame)),
    );
    // ...and it is the frame the room expects, not something that merely has the same length.
    const decoded = decodeMessage(fromBlob);
    expect(decoded.kind).toBe('sync');
  });

  it('leaves a frame that already holds its bytes alone', async () => {
    const frame = syncFrame([4, 5]);
    expect(await frameData(frame)).toBe(frame);
  });

  it('leaves a text frame as text, so the room still gets to refuse it', async () => {
    expect(await frameData('hello')).toBe('hello');
  });
});
