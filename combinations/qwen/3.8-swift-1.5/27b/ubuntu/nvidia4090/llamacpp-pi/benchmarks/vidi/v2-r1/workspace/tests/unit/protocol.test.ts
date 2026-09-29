import { describe, it, expect } from 'vitest';
import * as encoder from 'lib0/encoding';
import {
  decodeMessage,
  encodeSyncFrame,
  encodeAwarenessFrame,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
} from '@shared/protocol';

describe('decodeMessage (y-websocket framing)', () => {
  it('decodes a sync frame and returns the raw sync bytes after the outer type', () => {
    // varuint(0) + raw SyncStep1 (varuint(0) + varuint8array([1,2,3]))
    const rawSync = new Uint8Array([0, 3, 1, 2, 3]);
    const frame = encodeSyncFrame(rawSync);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'sync', rest: rawSync });
  });

  it('decodes an awareness frame into its update bytes', () => {
    const awarenessBytes = new Uint8Array([10, 20, 30]);
    const frame = encodeAwarenessFrame(awarenessBytes);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'awareness', awarenessBytes });
  });

  it('decodes a query-awareness frame', () => {
    const frame = encoder.createEncoder();
    encoder.writeVarInt(frame, MESSAGE_QUERY_AWARENESS);
    const result = decodeMessage(encoder.toUint8Array(frame).buffer as ArrayBuffer);
    expect(result).toEqual({ kind: 'query-awareness' });
  });

  it('returns invalid for unknown outer type 9', () => {
    const frame = encoder.createEncoder();
    encoder.writeVarInt(frame, 9);
    const result = decodeMessage(encoder.toUint8Array(frame).buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for an empty frame', () => {
    const result = decodeMessage(new Uint8Array([]).buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for a truncated awareness frame', () => {
    // varuint(1) then a length prefix that runs past the end
    const frame = new Uint8Array([MESSAGE_AWARENESS, 5, 1, 2]);
    const result = decodeMessage(frame.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for a string frame', () => {
    const result = decodeMessage('hello');
    expect(result).toEqual({ kind: 'invalid', reason: 'string frame' });
  });
});

describe('frame encoders', () => {
  it('encodeSyncFrame prepends the messageSync type without a length prefix', () => {
    const rawSync = new Uint8Array([2, 4, 0xff, 0xff, 0xff, 0xff]);
    expect(Array.from(encodeSyncFrame(rawSync))).toEqual([MESSAGE_SYNC, ...Array.from(rawSync)]);
  });

  it('encodeAwarenessFrame is varuint(1) + varuint8Array(bytes)', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const frame = encoder.createEncoder();
    encoder.writeVarInt(frame, MESSAGE_AWARENESS);
    encoder.writeVarUint8Array(frame, bytes);
    expect(Array.from(encodeAwarenessFrame(bytes))).toEqual(Array.from(encoder.toUint8Array(frame)));
  });
});
