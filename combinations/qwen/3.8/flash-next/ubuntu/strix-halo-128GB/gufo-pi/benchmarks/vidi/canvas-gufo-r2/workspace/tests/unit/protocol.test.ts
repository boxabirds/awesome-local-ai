/**
 * TC-03: decodeMessage tests for sync, awareness, query-awareness, unknown type,
 * truncated bytes, and string frame.
 */
import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
} from '../../src/shared/protocol';

/**
 * Encode a sync frame: [varUint type=0][raw sync protocol bytes]
 */
function encodeSyncFrame(syncContent: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  // Write raw sync bytes directly (no length prefix)
  for (let i = 0; i < syncContent.length; i++) {
    encoding.writeUint8(encoder, syncContent[i]);
  }
  const u8 = encoding.toUint8Array(encoder);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

/**
 * Encode an awareness frame: [varUint type=1][varUint8Array(payload)]
 */
function encodeAwarenessFrame(payload: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, payload);
  const u8 = encoding.toUint8Array(encoder);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

/**
 * Encode a query-awareness frame: [varUint type=3]
 */
function encodeQueryAwarenessFrame(): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  const u8 = encoding.toUint8Array(encoder);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

describe('decodeMessage', () => {
  // sync frame → typed result
  it('decodes a sync message', () => {
    const syncContent = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeSyncFrame(syncContent);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.payload).toEqual(syncContent);
    }
  });

  // awareness frame → typed result
  it('decodes an awareness message', () => {
    const payload = new Uint8Array([10, 20, 30]);
    const frame = encodeAwarenessFrame(payload);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('awareness');
    if (result.kind === 'awareness') {
      expect(result.payload).toEqual(payload);
    }
  });

  // query-awareness frame → typed result
  it('decodes a query-awareness message', () => {
    const frame = encodeQueryAwarenessFrame();
    const result = decodeMessage(frame);
    expect(result.kind).toBe('query-awareness');
  });

  // unknown type 9 → invalid
  it('returns invalid for unknown message type 9', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    encoding.writeUint8(encoder, 0);
    const u8 = encoding.toUint8Array(encoder);
    const frame = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('9');
    }
  });

  // truncated bytes → invalid (awareness declares more bytes than present)
  it('returns invalid for truncated awareness bytes', () => {
    // Write varUint type=1 then declare a varUint8Array of 100 bytes but only provide 2
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint(encoder, 100); // claims 100 bytes follow
    encoding.writeUint8(encoder, 0x42);  // only 1 byte actually present
    const u8 = encoding.toUint8Array(encoder);
    const frame = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('invalid');
  });

  // string frame → invalid
  it('returns invalid for a text (string) frame', () => {
    const result = decodeMessage('hello world');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('text frame');
    }
  });

  // empty buffer → invalid
  it('returns invalid for empty buffer', () => {
    const result = decodeMessage(new ArrayBuffer(0));
    expect(result.kind).toBe('invalid');
  });
});
