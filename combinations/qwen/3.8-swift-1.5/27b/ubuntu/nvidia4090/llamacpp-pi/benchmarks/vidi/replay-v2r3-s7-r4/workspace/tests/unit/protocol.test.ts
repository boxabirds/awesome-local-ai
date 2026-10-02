import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import { decodeMessage, MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS } from '../../src/shared/protocol';

function makeSyncFrame(payload: Uint8Array): ArrayBuffer {
  // y-websocket 3.x framing: [0, <sync message>] — no inner length prefix.
  const out = new Uint8Array(1 + payload.length);
  out[0] = MESSAGE_SYNC;
  out.set(payload, 1);
  return out.buffer as ArrayBuffer;
}

function makeAwarenessFrame(payload: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarInt(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

function makeQueryAwarenessFrame(): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarInt(encoder, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

describe('TC-03: decodeMessage', () => {
  it('decodes a sync frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = makeSyncFrame(payload);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.payload).toEqual(payload);
    }
  });

  it('decodes an awareness frame', () => {
    const payload = new Uint8Array([10, 20, 30]);
    const frame = makeAwarenessFrame(payload);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('awareness');
    if (result.kind === 'awareness') {
      expect(result.payload).toEqual(payload);
    }
  });

  it('decodes a query-awareness frame', () => {
    const frame = makeQueryAwarenessFrame();
    const result = decodeMessage(frame);
    expect(result.kind).toBe('query-awareness');
  });

  it('returns invalid for unknown type 9', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarInt(encoder, 9);
    encoding.writeVarUint8Array(encoder, new Uint8Array([1, 2]));
    const frame = encoding.toUint8Array(encoder).buffer as ArrayBuffer;
    const result = decodeMessage(frame);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for truncated bytes (empty)', () => {
    const frame = new ArrayBuffer(0);
    const result = decodeMessage(frame);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for a string frame', () => {
    const result = decodeMessage('hello');
    expect(result.kind).toBe('invalid');
  });
});
