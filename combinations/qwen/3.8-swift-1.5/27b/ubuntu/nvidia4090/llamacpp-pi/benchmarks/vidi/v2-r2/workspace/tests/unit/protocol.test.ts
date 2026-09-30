import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import { decodeMessage, MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS } from '../../src/shared/protocol';

/**
 * y-websocket framing: [message_type: varuint][payload].
 * The sync payload is RAW (not length-prefixed); the awareness payload is a
 * varuint8array.
 */
function encodeSyncFrame(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

function encodeAwarenessFrame(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

describe('TC-03: decodeMessage', () => {
  it('decodes a sync message (raw payload, no length prefix)', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = encodeSyncFrame(payload);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'sync', payload });
  });

  it('decodes an awareness message (varuint8array payload)', () => {
    const payload = new Uint8Array([10, 20, 30]);
    const frame = encodeAwarenessFrame(payload);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'awareness', payload });
  });

  it('decodes a query-awareness message', () => {
    // Query awareness has no payload beyond the type byte
    const frame = new Uint8Array([MESSAGE_QUERY_AWARENESS]);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'query-awareness' });
  });

  it('returns unknown for unknown type 9', () => {
    const frame = new Uint8Array([9, 1, 2, 3]);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('unknown');
    if (result.kind === 'unknown') {
      // unknown types are ignored for forward compatibility
    }
  });

  it('returns invalid for a truncated varuint type', () => {
    // 0x80 starts a multi-byte varuint with a continuation bit but no follow-up byte
    const frame = new Uint8Array([0x80]);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('decode error');
    }
  });

  it('returns invalid for a truncated awareness payload', () => {
    // Awareness type with a varuint8array that claims 10 bytes but has 2
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint(encoder, 10);
    encoding.writeUint8Array(encoder, new Uint8Array([1, 2]));
    const frame = encoding.toUint8Array(encoder);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for a string frame', () => {
    const result = decodeMessage('hello');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toBe('string frame');
    }
  });

  it('returns invalid for empty frame', () => {
    const frame = new Uint8Array(0);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });
});
