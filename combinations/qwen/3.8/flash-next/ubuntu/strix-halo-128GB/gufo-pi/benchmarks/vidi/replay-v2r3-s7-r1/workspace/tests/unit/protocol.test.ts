import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import {
  decodeMessage,
  encodeSyncMessage,
  encodeAwarenessMessage,
  encodeQueryAwarenessMessage,
} from '../../src/shared/protocol';

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const frame = encodeSyncMessage(payload);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.payload).toEqual(payload);
    }
  });

  it('decodes an awareness frame', () => {
    const payload = new Uint8Array([10, 20, 30]);
    const frame = encodeAwarenessMessage(payload);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('awareness');
    if (result.kind === 'awareness') {
      expect(result.payload).toEqual(payload);
    }
  });

  it('decodes a query-awareness frame', () => {
    const frame = encodeQueryAwarenessMessage();
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('query-awareness');
  });

  it('returns invalid for unknown type 9', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 9);
    encoding.writeUint8Array(enc, new Uint8Array([0]));
    const frame = encoding.toUint8Array(enc);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('unknown message type');
    }
  });

  it('returns invalid for truncated bytes (varuint extends beyond buffer)', () => {
    // 0x80 has the continuation bit set but there is no next byte
    const raw = new Uint8Array([0x80]);
    const result = decodeMessage(raw.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('truncated');
    }
  });

  it('returns invalid for empty buffer', () => {
    const raw = new Uint8Array([]);
    const result = decodeMessage(raw.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for a string frame', () => {
    const result = decodeMessage('hello world');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('text frame');
    }
  });
});
