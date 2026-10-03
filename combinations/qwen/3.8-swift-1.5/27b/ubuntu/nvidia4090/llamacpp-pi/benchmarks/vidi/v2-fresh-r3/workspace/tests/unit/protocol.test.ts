import { describe, it, expect } from 'vitest';
import { decodeMessage, MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS } from '../../src/shared/protocol';

/**
 * Helper: builds a y-websocket binary frame from a type byte and payload.
 */
function makeFrame(type: number, payload: Uint8Array = new Uint8Array(0)): Uint8Array {
  const frame = new Uint8Array(1 + payload.length);
  frame[0] = type;
  frame.set(payload, 1);
  return frame;
}

describe('TC-03: decodeMessage', () => {
  it('decodes a sync frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const frame = makeFrame(MESSAGE_SYNC, payload);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'sync', payload });
  });

  it('decodes an awareness frame', () => {
    const payload = new Uint8Array([5, 6, 7]);
    const frame = makeFrame(MESSAGE_AWARENESS, payload);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'awareness', payload });
  });

  it('decodes a query-awareness frame (no payload)', () => {
    const frame = makeFrame(MESSAGE_QUERY_AWARENESS);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'query-awareness' });
  });

  it('returns invalid for unknown type 9', () => {
    const frame = makeFrame(9, new Uint8Array([1, 2]));
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'invalid', reason: 'unknown type 9' });
  });

  it('returns invalid for truncated bytes (empty buffer)', () => {
    const result = decodeMessage(new ArrayBuffer(0));
    expect(result).toEqual({ kind: 'invalid', reason: 'truncated: empty' });
  });

  it('returns invalid for string frame', () => {
    const result = decodeMessage('hello');
    expect(result).toEqual({ kind: 'invalid', reason: 'string frame' });
  });
});
