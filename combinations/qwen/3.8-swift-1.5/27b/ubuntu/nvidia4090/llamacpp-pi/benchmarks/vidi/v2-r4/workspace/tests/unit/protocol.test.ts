import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import { decodeMessage, MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS } from '../../src/shared/protocol';

function encodeMessage(type: number, payload?: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarInt(encoder, type);
  if (payload) {
    encoding.writeVarUint8Array(encoder, payload);
  }
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

describe('TC-03: decodeMessage', () => {
  it('decodes a sync message', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const data = encodeMessage(MESSAGE_SYNC, payload);
    const result = decodeMessage(data);
    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.payload).toBeInstanceOf(Uint8Array);
    }
  });

  it('decodes an awareness message', () => {
    const payload = new Uint8Array([5, 6, 7, 8]);
    const data = encodeMessage(MESSAGE_AWARENESS, payload);
    const result = decodeMessage(data);
    expect(result.kind).toBe('awareness');
    if (result.kind === 'awareness') {
      expect(result.payload).toBeInstanceOf(Uint8Array);
    }
  });

  it('decodes a query-awareness message', () => {
    const data = encodeMessage(MESSAGE_QUERY_AWARENESS);
    const result = decodeMessage(data);
    expect(result.kind).toBe('query-awareness');
  });

  it('returns invalid for unknown type 9', () => {
    const data = encodeMessage(9, new Uint8Array([1]));
    const result = decodeMessage(data);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for truncated bytes', () => {
    // A varint that claims more bytes than available
    const truncated = new Uint8Array([0x80]); // varint continuation bit set, no follow-up
    const result = decodeMessage(truncated.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for string frame', () => {
    const result = decodeMessage('hello');
    expect(result.kind).toBe('invalid');
  });
});
