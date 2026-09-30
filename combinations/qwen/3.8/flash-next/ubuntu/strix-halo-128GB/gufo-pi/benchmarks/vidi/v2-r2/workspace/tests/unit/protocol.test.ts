import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
} from '@shared/protocol';

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    encoding.writeVarUint8Array(enc, new Uint8Array([1, 2, 3]));
    const bytes = encoding.toUint8Array(enc);
    const result = decodeMessage(bytes.buffer as ArrayBuffer);
    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.payload.length).toBeGreaterThan(0);
    }
  });

  it('decodes an awareness frame', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, new Uint8Array([4, 5, 6]));
    const bytes = encoding.toUint8Array(enc);
    const result = decodeMessage(bytes.buffer as ArrayBuffer);
    expect(result.kind).toBe('awareness');
    if (result.kind === 'awareness') {
      expect(result.payload.length).toBeGreaterThan(0);
    }
  });

  it('decodes a query-awareness frame', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
    const bytes = encoding.toUint8Array(enc);
    const result = decodeMessage(bytes.buffer as ArrayBuffer);
    expect(result.kind).toBe('query-awareness');
  });

  it('returns invalid for unknown type 9', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 9);
    encoding.writeVarUint8Array(enc, new Uint8Array([0]));
    const bytes = encoding.toUint8Array(enc);
    const result = decodeMessage(bytes.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for truncated awareness bytes', () => {
    // An awareness frame declares a large varUint8Array but doesn't have enough data
    const bytes = new Uint8Array([MESSAGE_AWARENESS, 255, 255]);
    const result = decodeMessage(bytes.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for string (text) frame', () => {
    const result = decodeMessage('hello');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toContain('text');
    }
  });
});
