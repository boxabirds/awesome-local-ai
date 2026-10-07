// TC-03: protocol message decode.

import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
} from '../../src/shared/protocol';

function encodeMessage(type: number, payload?: Uint8Array): ArrayBuffer {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  if (payload) encoding.writeUint8Array(enc, payload);
  return encoding.toUint8Array(enc).buffer.slice(
    encoding.toUint8Array(enc).byteOffset,
    encoding.toUint8Array(enc).byteOffset + encoding.toUint8Array(enc).byteLength,
  ) as ArrayBuffer;
}

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = encodeMessage(MESSAGE_SYNC, payload);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(Array.from(result.payload)).toEqual([1, 2, 3, 4, 5]);
    }
  });

  it('decodes an awareness frame', () => {
    const payload = new Uint8Array([10, 20, 30]);
    const frame = encodeMessage(MESSAGE_AWARENESS, payload);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('awareness');
    if (result.kind === 'awareness') {
      expect(Array.from(result.payload)).toEqual([10, 20, 30]);
    }
  });

  it('decodes a query-awareness frame', () => {
    const frame = encodeMessage(MESSAGE_QUERY_AWARENESS);
    const result = decodeMessage(frame);
    expect(result).toEqual({ kind: 'query-awareness' });
  });

  it('returns invalid for unknown type 9', () => {
    const frame = encodeMessage(9, new Uint8Array([1]));
    const result = decodeMessage(frame);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for truncated bytes', () => {
    // A multi-byte varint that is cut off mid-stream
    // 0x80 means "continue" in varint encoding, so [0x80, 0x80] is incomplete
    const truncated = new Uint8Array([0x80, 0x80]).buffer as ArrayBuffer;
    const result = decodeMessage(truncated);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for a string frame (text frame)', () => {
    const result = decodeMessage('hello');
    expect(result).toEqual({ kind: 'invalid', reason: 'string frame' });
  });

  it('returns invalid for empty ArrayBuffer', () => {
    const result = decodeMessage(new ArrayBuffer(0));
    expect(result.kind).toBe('invalid');
  });
});
