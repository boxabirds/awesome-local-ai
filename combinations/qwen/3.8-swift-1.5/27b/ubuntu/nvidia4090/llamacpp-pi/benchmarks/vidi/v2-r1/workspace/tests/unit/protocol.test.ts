import { describe, it, expect } from 'vitest';
import * as encoder from 'lib0/encoding';
import { decodeMessage, MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS } from '@shared/protocol';

function encodeSyncFrame(payload: Uint8Array): ArrayBuffer {
  const frames = encoder.createEncoder();
  encoder.writeVarInt(frames, MESSAGE_SYNC);
  encoder.writeVarUint8Array(frames, payload);
  return encoder.toUint8Array(frames).buffer as ArrayBuffer;
}

function encodeAwarenessFrame(payload: Uint8Array): ArrayBuffer {
  const frames = encoder.createEncoder();
  encoder.writeVarInt(frames, MESSAGE_AWARENESS);
  encoder.writeVarUint8Array(frames, payload);
  return encoder.toUint8Array(frames).buffer as ArrayBuffer;
}

function encodeQueryAwarenessFrame(): ArrayBuffer {
  const frames = encoder.createEncoder();
  encoder.writeVarInt(frames, MESSAGE_QUERY_AWARENESS);
  return encoder.toUint8Array(frames).buffer as ArrayBuffer;
}

describe('TC-03: decodeMessage', () => {
  it('decodes a sync frame', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const frame = encodeSyncFrame(payload);
    const result = decodeMessage(frame);
    expect(result).toEqual({ kind: 'sync', payload });
  });

  it('decodes an awareness frame', () => {
    const payload = new Uint8Array([10, 20, 30]);
    const frame = encodeAwarenessFrame(payload);
    const result = decodeMessage(frame);
    expect(result).toEqual({ kind: 'awareness', payload });
  });

  it('decodes a query-awareness frame', () => {
    const frame = encodeQueryAwarenessFrame();
    const result = decodeMessage(frame);
    expect(result).toEqual({ kind: 'query-awareness' });
  });

  it('returns invalid for unknown type 9', () => {
    const frames = encoder.createEncoder();
    encoder.writeVarInt(frames, 9);
    encoder.writeVarUint8Array(frames, new Uint8Array([1, 2, 3]));
    const frame = encoder.toUint8Array(frames).buffer as ArrayBuffer;
    const result = decodeMessage(frame);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for truncated bytes', () => {
    // Create a valid frame then truncate it
    const payload = new Uint8Array([1, 2, 3, 4, 5]);
    const full = encodeSyncFrame(payload);
    const truncated = full.slice(0, 3);
    const result = decodeMessage(truncated);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for string frame', () => {
    const result = decodeMessage('hello');
    expect(result).toEqual({ kind: 'invalid', reason: 'string frame' });
  });
});
