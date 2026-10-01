// tests/unit/protocol.test.ts
import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import { decodeMessage, encodeMessage, MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS } from '../../src/shared/protocol';

describe('sync.room: decodeMessage (TC-03)', () => {
  it('decodes a sync message frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const buffer = encodeMessage(MESSAGE_SYNC, payload);
    const result = decodeMessage(buffer);
    expect(result).toEqual({ kind: 'sync', payload });
  });

  it('decodes an awareness message frame', () => {
    const payload = new Uint8Array([10, 20, 30]);
    const buffer = encodeMessage(MESSAGE_AWARENESS, payload);
    const result = decodeMessage(buffer);
    expect(result).toEqual({ kind: 'awareness', payload });
  });

  it('decodes a query-awareness message frame', () => {
    const buffer = encodeMessage(MESSAGE_QUERY_AWARENESS, new Uint8Array(0));
    const result = decodeMessage(buffer);
    expect(result).toEqual({ kind: 'query-awareness' });
  });

  it('returns invalid for unknown type 9', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    encoding.writeVarUint(encoder, 0);
    const buffer = encoding.toUint8Array(encoder).buffer as ArrayBuffer;
    const result = decodeMessage(buffer);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for truncated bytes', () => {
    // Create a valid frame then truncate it
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const fullBuffer = encodeMessage(MESSAGE_SYNC, payload);
    const truncated = new Uint8Array(fullBuffer.slice(0, 3)).buffer as ArrayBuffer;
    const result = decodeMessage(truncated);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for string frame', () => {
    const result = decodeMessage('hello');
    expect(result).toEqual({ kind: 'invalid', reason: 'string frame' });
  });
});
