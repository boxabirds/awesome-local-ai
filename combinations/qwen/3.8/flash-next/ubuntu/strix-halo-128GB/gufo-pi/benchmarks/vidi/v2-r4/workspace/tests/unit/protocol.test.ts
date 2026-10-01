import { describe, it, expect } from 'vitest';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
} from '../../src/shared/protocol';
import * as encoding from 'lib0/encoding';

function encodeFrame(type: number, payload?: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  if (payload) {
    encoding.writeUint8Array(encoder, payload);
  }
  const bytes = encoding.toUint8Array(encoder);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe('decodeMessage', () => {
  it('decodes a sync frame', () => {
    const syncPayload = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeFrame(MESSAGE_SYNC, syncPayload);
    const result = decodeMessage(frame);
    expect(result).toEqual({ kind: 'sync', payload: syncPayload });
  });

  it('decodes an awareness frame', () => {
    const awarenessPayload = new Uint8Array([10, 20, 30]);
    const frame = encodeFrame(MESSAGE_AWARENESS, awarenessPayload);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('awareness');
    if (result.kind === 'awareness') {
      expect(result.payload).toEqual(awarenessPayload);
    }
  });

  it('decodes a query-awareness frame', () => {
    const frame = encodeFrame(MESSAGE_QUERY_AWARENESS);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('query-awareness');
  });

  it('returns invalid for unknown type 9', () => {
    const frame = encodeFrame(9, new Uint8Array([1]));
    const result = decodeMessage(frame);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('unknown');
    }
  });

  it('returns invalid for truncated bytes (sync type with no payload)', () => {
    // Just the type byte, no payload
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    const bytes = encoding.toUint8Array(encoder);
    const frame = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for a string frame', () => {
    const result = decodeMessage('hello');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('text');
    }
  });

  it('returns invalid for empty buffer', () => {
    const result = decodeMessage(new ArrayBuffer(0));
    expect(result.kind).toBe('invalid');
  });
});
