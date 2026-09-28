import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
} from '../../src/shared/protocol';

function encodeSyncFrame(payload: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

function encodeAwarenessFrame(payload: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

function encodeQueryAwarenessFrame(): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeSyncFrame(payload);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.payload).toEqual(payload);
    }
  });

  it('decodes an awareness frame', () => {
    const payload = new Uint8Array([10, 20, 30]);
    const frame = encodeAwarenessFrame(payload);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('awareness');
    if (result.kind === 'awareness') {
      expect(result.payload).toEqual(payload);
    }
  });

  it('decodes a query-awareness frame', () => {
    const frame = encodeQueryAwarenessFrame();
    const result = decodeMessage(frame);
    expect(result.kind).toBe('query-awareness');
  });

  it('returns invalid for unknown type 9', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    encoding.writeVarUint(encoder, 0); // some payload so length > 1
    const frame = encoding.toUint8Array(encoder).buffer as ArrayBuffer;
    const result = decodeMessage(frame);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for truncated bytes (single byte sync type, no payload)', () => {
    const frame = new Uint8Array([MESSAGE_SYNC]).buffer as ArrayBuffer;
    const result = decodeMessage(frame);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for a string frame', () => {
    const result = decodeMessage('hello');
    expect(result.kind).toBe('invalid');
  });

  it('CLOSE_UNSUPPORTED_DATA is 1003', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
