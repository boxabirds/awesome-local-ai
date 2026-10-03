// TC-03: y-websocket frame decoding (sync.room, pure).
// Frames are built with the same lib0 encoders the real clients use.

import { describe, expect, it } from 'vitest';
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from 'lib0/encoding';
import {
  decodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';

/** Build a framed message: [type : varUint, payload : varUint8Array]. */
function frame(type: number, payload: Uint8Array = new Uint8Array()): Uint8Array {
  const enc = createEncoder();
  writeVarUint(enc, type);
  writeVarUint8Array(enc, payload);
  return toUint8Array(enc);
}

function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = bytes.buffer as ArrayBuffer;
  return buf.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe('TC-03 decodeMessage', () => {
  it('decodes a sync frame (full frame as payload)', () => {
    // SyncStep1 with a 4-byte state vector: [0, [0, [04 01 02 03]]]
    const syncMessage = new Uint8Array([0, 4, 1, 2, 3]);
    const f = frame(MESSAGE_SYNC, syncMessage);
    const decoded = decodeMessage(toBuffer(f));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') {
      expect(Array.from(decoded.payload)).toEqual(Array.from(f));
    }
  });

  it('decodes an awareness frame', () => {
    const f = frame(MESSAGE_AWARENESS, new Uint8Array([9, 8, 7]));
    const decoded = decodeMessage(toBuffer(f));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') {
      expect(Array.from(decoded.payload)).toEqual(Array.from(f));
    }
  });

  it('decodes a query-awareness frame', () => {
    const f = frame(MESSAGE_QUERY_AWARENESS);
    expect(decodeMessage(toBuffer(f))).toEqual({ kind: 'query-awareness' });
  });

  it('rejects an unknown message type (9)', () => {
    const f = frame(9, new Uint8Array([1, 2, 3]));
    const decoded = decodeMessage(toBuffer(f));
    expect(decoded.kind).toBe('invalid');
  });

  it('rejects truncated bytes (varUint continuation with no following byte)', () => {
    const decoded = decodeMessage(toBuffer(new Uint8Array([0x80])));
    expect(decoded.kind).toBe('invalid');
  });

  it('rejects an empty frame', () => {
    const decoded = decodeMessage(toBuffer(new Uint8Array()));
    expect(decoded.kind).toBe('invalid');
  });

  it('rejects a string frame', () => {
    const decoded = decodeMessage('not binary');
    expect(decoded.kind).toBe('invalid');
  });
});
