/** TC-03: Protocol decodeMessage unit tests */

import * as encoding from 'lib0/encoding';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
} from '../../src/shared/protocol';

describe('decodeMessage', () => {
  // TC-03

  function encodeSync(payload: Uint8Array): ArrayBuffer {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint8Array(encoder, payload);
    return new Uint8Array(encoding.toUint8Array(encoder)).buffer;
  }

  function encodeAwareness(payload: Uint8Array): ArrayBuffer {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(encoder, payload);
    return new Uint8Array(encoding.toUint8Array(encoder)).buffer;
  }

  function encodeQueryAwareness(): ArrayBuffer {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
    return new Uint8Array(encoding.toUint8Array(encoder)).buffer;
  }

  it('decodes a sync message with known type', () => {
    const result = decodeMessage(encodeSync(new Uint8Array([1, 2, 3])));
    expect(result).toEqual({ kind: 'sync', payload: new Uint8Array([1, 2, 3]) });
  });

  it('decodes an awareness message', () => {
    const result = decodeMessage(encodeAwareness(new Uint8Array([5, 6])));
    expect(result).toEqual({ kind: 'awareness', payload: new Uint8Array([5, 6]) });
  });

  it('decodes a query-awareness message', () => {
    const result = decodeMessage(encodeQueryAwareness());
    expect(result).toEqual({ kind: 'query-awareness' });
  });

  it('returns invalid for unknown message type 9', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    const buf = new Uint8Array(encoding.toUint8Array(encoder)).buffer;
    const result = decodeMessage(buf);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for truncated bytes (only type byte, no length)', () => {
    // Just a varint for type 0 but no length prefix or data — decoder will fail
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    // Intentionally omit writeVarUint8Array to produce truncated data
    const raw = encoding.toUint8Array(encoder);
    // Remove the last byte so there's incomplete varint data
    const truncated = raw.slice(0, Math.max(1, raw.length - 1));
    const result = decodeMessage(new Uint8Array(truncated).buffer);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for string frames', () => {
    const result = decodeMessage('hello' as unknown as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for empty ArrayBuffer', () => {
    const result = decodeMessage(new ArrayBuffer(0));
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for null/undefined', () => {
    expect((decodeMessage(null as unknown as ArrayBuffer) as any).kind).toBe('invalid');
    expect((decodeMessage(undefined as unknown as ArrayBuffer) as any).kind).toBe('invalid');
  });
});
