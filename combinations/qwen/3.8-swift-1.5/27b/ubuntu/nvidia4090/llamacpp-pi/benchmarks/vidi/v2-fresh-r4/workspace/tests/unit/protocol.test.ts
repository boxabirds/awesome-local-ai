import { describe, it, expect } from 'vitest';
import { createEncoder, toUint8Array, writeUint8, writeUint8Array } from 'lib0/encoding';
import { decodeMessage, MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS } from '../../src/shared/protocol';

/**
 * Build a y-websocket framed message: [type: varUint8, ...payload]
 */
function frame(type: number, payload: Uint8Array): ArrayBuffer {
  const encoder = createEncoder();
  writeUint8(encoder, type);
  if (payload.length > 0) {
    writeUint8Array(encoder, payload);
  }
  const bytes = toUint8Array(encoder);
  return bytes.buffer as ArrayBuffer;
}

describe('TC-03: decodeMessage', () => {
  it('decodes a sync message', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const buf = frame(MESSAGE_SYNC, payload);
    const result = decodeMessage(buf);
    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.payload).toEqual(payload);
    }
  });

  it('decodes an awareness message', () => {
    const payload = new Uint8Array([5, 6, 7]);
    const buf = frame(MESSAGE_AWARENESS, payload);
    const result = decodeMessage(buf);
    expect(result.kind).toBe('awareness');
    if (result.kind === 'awareness') {
      expect(result.payload).toEqual(payload);
    }
  });

  it('decodes a query-awareness message', () => {
    const buf = frame(MESSAGE_QUERY_AWARENESS, new Uint8Array(0));
    const result = decodeMessage(buf);
    expect(result.kind).toBe('query-awareness');
  });

  it('returns invalid for unknown type 9', () => {
    const buf = frame(9, new Uint8Array([1]));
    const result = decodeMessage(buf);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('unknown type 9');
    }
  });

  it('returns invalid for truncated bytes (empty buffer)', () => {
    const buf = new ArrayBuffer(0);
    const result = decodeMessage(buf);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for string frame', () => {
    const result = decodeMessage('hello');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toBe('string frame');
    }
  });
});
