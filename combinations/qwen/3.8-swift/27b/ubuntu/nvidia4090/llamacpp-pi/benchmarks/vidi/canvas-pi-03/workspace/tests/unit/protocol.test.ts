import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  decodeMessage,
  encodeSyncFrame,
  encodeAwarenessFrame,
} from 'src/shared/protocol';

function toFrame(type: number, extra?: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  if (extra) encoding.writeVarUint8Array(enc, extra);
  return encoding.toUint8Array(enc);
}

/**
 * TC-03 — decodeMessage: known types produce typed results; unknown type,
 * truncated bytes and string frames are invalid (error paths).
 */
describe('protocol.decodeMessage', () => {
  it('decodes a sync frame into {kind:sync, payload}', () => {
    const syncMessage = new Uint8Array([0, 2, 1, 2, 3, 4]);
    const frame = encodeSyncFrame(syncMessage);
    const decoded = decodeMessage(frame.buffer as ArrayBuffer);
    expect(decoded).toEqual({ kind: 'sync', payload: syncMessage });
  });

  it('decodes an awareness frame into {kind:awareness, payload}', () => {
    const awarenessBytes = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = encodeAwarenessFrame(awarenessBytes);
    const decoded = decodeMessage(frame.buffer as ArrayBuffer);
    expect(decoded).toEqual({ kind: 'awareness', payload: awarenessBytes });
  });

  it('decodes a query-awareness frame into {kind:query-awareness}', () => {
    const frame = toFrame(MESSAGE_QUERY_AWARENESS);
    const decoded = decodeMessage(frame.buffer as ArrayBuffer);
    expect(decoded).toEqual({ kind: 'query-awareness' });
  });

  it('returns invalid for an unknown type (9)', () => {
    const frame = toFrame(9);
    const decoded = decodeMessage(frame.buffer as ArrayBuffer);
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') {
      expect(decoded.reason).toContain('unknown type 9');
    }
  });

  it('returns invalid for truncated bytes', () => {
    const full = encodeAwarenessFrame(new Uint8Array([1, 2, 3, 4, 5]));
    const truncated = full.slice(0, full.length - 2);
    const decoded = decodeMessage(truncated.buffer as ArrayBuffer);
    expect(decoded.kind).toBe('invalid');
  });

  it('returns invalid for a string (text) frame', () => {
    const decoded = decodeMessage('not binary');
    expect(decoded).toEqual({ kind: 'invalid', reason: 'string frame' });
  });

  it('returns invalid for an empty frame', () => {
    const decoded = decodeMessage(new ArrayBuffer(0));
    expect(decoded.kind).toBe('invalid');
  });

  it('exposes the expected message-type constants', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
  });
});
