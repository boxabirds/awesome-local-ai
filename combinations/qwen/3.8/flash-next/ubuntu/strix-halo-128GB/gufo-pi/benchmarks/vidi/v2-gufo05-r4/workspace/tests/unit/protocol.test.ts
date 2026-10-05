/**
 * TC-03 — message decoding (`sync.room`).
 *
 * `decodeMessage` is the room's only parser: it must type the three frames
 * `y-websocket` sends and report every other byte sequence as invalid, because
 * the room's error contract ("close this socket, keep everybody else") hangs off
 * that result. Frames here are built with the same `lib0` encoders the client
 * provider uses.
 */

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  frameBytes
} from '../../src/shared/protocol';

/** A `y-protocols` sync frame exactly as the provider frames it: type, then payload. */
function syncFrame(doc: Y.Doc): { frame: Uint8Array; payload: Uint8Array } {
  const payloadEncoder = encoding.createEncoder();
  syncProtocol.writeSyncStep1(payloadEncoder, doc);
  const payload = encoding.toUint8Array(payloadEncoder);

  // `y-websocket` writes the type and then the sync bytes directly: a sync
  // payload is whatever follows the message type.
  const frame = encoding.createEncoder();
  encoding.writeVarUint(frame, MESSAGE_SYNC);
  encoding.writeUint8Array(frame, payload);
  return { frame: encoding.toUint8Array(frame), payload };
}

/** An awareness frame: type, then a length-prefixed awareness update. */
function awarenessFrame(update: Uint8Array): Uint8Array {
  const frame = encoding.createEncoder();
  encoding.writeVarUint(frame, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(frame, update);
  return encoding.toUint8Array(frame);
}

/** An arbitrary but well-formed awareness update payload. */
function awarenessUpdate(): Uint8Array {
  const binaryState = encoding.encode((enc) => encoding.writeAny(enc, { cursor: 3 }));
  const update = encoding.createEncoder();
  encoding.writeVarUint(update, 1); // one client
  encoding.writeVarUint(update, 42); // client id
  encoding.writeVarUint8Array(update, binaryState);
  encoding.writeVarUint(update, 7); // clock
  return encoding.toUint8Array(update);
}

/** A copy of `bytes`, so a test cannot be affected by a shared buffer. */
function bytesOf(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

describe('decodeMessage', () => {
  it('types a sync frame and hands back its payload (TC-03)', () => {
    const doc = new Y.Doc();
    const { frame, payload } = syncFrame(doc);
    const decoded = decodeMessage(bytesOf(frame));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') expect(decoded.payload).toEqual(payload);
  });

  it('types an awareness frame and hands back its payload (TC-03)', () => {
    const update = awarenessUpdate();
    const frame = awarenessFrame(update);
    const decoded = decodeMessage(bytesOf(frame));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') expect(decoded.payload).toEqual(update);
  });

  it('types a query-awareness frame (TC-03)', () => {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_QUERY_AWARENESS);
    const bytes_ = encoding.toUint8Array(frame);
    const decoded = decodeMessage(bytesOf(bytes_));
    expect(decoded).toEqual({ kind: 'query-awareness' });
  });

  it('reports an unknown message type as invalid (TC-03 error path)', () => {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, 9);
    const bytes_ = encoding.toUint8Array(frame);
    const decoded = decodeMessage(bytesOf(bytes_));
    expect(decoded.kind).toBe('invalid');
  });

  it('reports truncated bytes as invalid (TC-03 error path)', () => {
    const whole = awarenessFrame(awarenessUpdate());
    const truncated = whole.slice(0, whole.length - 3);
    const decoded = decodeMessage(bytesOf(truncated));
    expect(decoded.kind).toBe('invalid');

    // A frame that announces a payload and then stops.
    const onlyType = new Uint8Array([MESSAGE_AWARENESS]);
    expect(decodeMessage(onlyType).kind).toBe('invalid');
  });

  it('reports a text frame as invalid (TC-03 error path)', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });

  it('reports an empty frame as invalid (TC-03)', () => {
    expect(decodeMessage(new Uint8Array(0)).kind).toBe('invalid');
  });

  it('never throws, whatever it is given (TC-03)', () => {
    const invalid: (Uint8Array | string)[] = [
      // Five 0xFF bytes: a varuint that runs off the end of any sane number.
      new Uint8Array([255, 255, 255, 255, 255]),
      'x',
      String.fromCharCode(0)
    ];
    for (const data of invalid) {
      expect(() => decodeMessage(data)).not.toThrow();
      expect(decodeMessage(data).kind).toBe('invalid');
    }
  });
})
// The platform hands a binary frame over as a Blob while a test hands over an
// ArrayBuffer, and getting this wrong looks exactly like a corrupt peer.
describe('frameBytes', () => {
  it('reads the same bytes out of a Blob, an ArrayBuffer and a Uint8Array', async () => {
    const bytes = new Uint8Array([7, 1, 2, 3]);
    const fromBlob = await frameBytes(new Blob([bytes]));
    const fromBuffer = await frameBytes(bytes.slice().buffer);
    expect(Array.from(fromBlob ?? [])).toEqual([7, 1, 2, 3]);
    expect(Array.from(fromBuffer ?? [])).toEqual([7, 1, 2, 3]);
  });

  it('sees a view of a larger buffer as just that view', async () => {
    const whole = new Uint8Array([9, 9, 5, 6, 7, 9]);
    expect(Array.from((await frameBytes(new Uint8Array(whole.buffer, 2, 3))) ?? [])).toEqual([5, 6, 7]);
  });

  it('returns null for anything that is not binary', async () => {
    expect(await frameBytes('hello')).toBeNull();
    expect(await frameBytes(undefined)).toBeNull();
    expect(await frameBytes(42)).toBeNull();
  });
});
