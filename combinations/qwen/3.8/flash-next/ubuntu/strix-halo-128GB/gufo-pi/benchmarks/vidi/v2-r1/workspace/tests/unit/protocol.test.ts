import { describe, expect, it } from 'vitest';

import {
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';

describe('decodeMessage', () => {
  // TC-03: sync frame → typed sync result
  it('decodes a sync message', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const frame = new Uint8Array(1 + payload.length);
    frame[0] = MESSAGE_SYNC;
    frame.set(payload, 1);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'sync', payload });
  });

  // TC-03: awareness frame → typed awareness result
  it('decodes an awareness message', () => {
    const payload = new Uint8Array([10, 20, 30]);
    const frame = new Uint8Array(1 + payload.length);
    frame[0] = MESSAGE_AWARENESS;
    frame.set(payload, 1);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'awareness', payload });
  });

  // TC-03: query-awareness frame → typed result
  it('decodes a query-awareness message', () => {
    const frame = new Uint8Array([MESSAGE_QUERY_AWARENESS]);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'query-awareness' });
  });

  // TC-03: unknown type 9 → invalid
  it('returns invalid for unknown message type 9', () => {
    const frame = new Uint8Array([9, 1, 2, 3]);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  // TC-03: truncated bytes (empty) → invalid
  it('returns invalid for empty ArrayBuffer', () => {
    const result = decodeMessage(new ArrayBuffer(0));
    expect(result.kind).toBe('invalid');
  });

  // TC-03: sync with no payload → invalid
  it('returns invalid for sync message with no payload', () => {
    const frame = new Uint8Array([MESSAGE_SYNC]);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  // TC-03: awareness with no payload → invalid
  it('returns invalid for awareness message with no payload', () => {
    const frame = new Uint8Array([MESSAGE_AWARENESS]);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  // TC-03: string frame → invalid
  it('returns invalid for a string frame', () => {
    const result = decodeMessage('hello world');
    expect(result.kind).toBe('invalid');
  });

  // TC-03: truncated sync (header only with type byte known but rest missing)
  it('returns invalid for truncated message data', () => {
    // Just the type byte with no remaining data
    const frame = new Uint8Array([MESSAGE_SYNC]);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });
});

describe('protocol constants', () => {
  it('MESSAGE_SYNC is 0', () => {
    expect(MESSAGE_SYNC).toBe(0);
  });

  it('MESSAGE_AWARENESS is 1', () => {
    expect(MESSAGE_AWARENESS).toBe(1);
  });

  it('MESSAGE_QUERY_AWARENESS is 3', () => {
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
  });

  it('CLOSE_UNSUPPORTED_DATA is 1003', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
