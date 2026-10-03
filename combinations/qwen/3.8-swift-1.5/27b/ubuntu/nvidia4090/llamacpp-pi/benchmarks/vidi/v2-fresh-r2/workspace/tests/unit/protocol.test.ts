/**
 * TC-03: decodeMessage for y-websocket framing (sync.room).
 * Frames are built with the same lib0 encoders the provider uses.
 */
import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
} from '../../src/shared/protocol';

/**
 * Build a wire frame the way the y-websocket provider does:
 * sync frames carry the raw submessage bytes after the type varuint, while
 * awareness frames carry a length-prefixed varuint8Array blob.
 */
function syncFrame(submessage: Uint8Array): ArrayBuffer {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  encoding.writeUint8Array(enc, submessage);
  return encoding.toUint8Array(enc).buffer as ArrayBuffer;
}

function awarenessFrame(bytes: Uint8Array): ArrayBuffer {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(enc, bytes);
  return encoding.toUint8Array(enc).buffer as ArrayBuffer;
}

function plainFrame(type: number): ArrayBuffer {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  return encoding.toUint8Array(enc).buffer as ArrayBuffer;
}

describe('TC-03: decodeMessage', () => {
  it('decodes a sync frame (type 0) with its submessage payload', () => {
    const stateVector = new Uint8Array([1, 2, 3, 4]);
    const sub = encoding.createEncoder();
    encoding.writeVarUint(sub, 0); // SyncStep1 submessage
    encoding.writeVarUint8Array(sub, stateVector);
    const subBytes = encoding.toUint8Array(sub);
    const data = syncFrame(subBytes);

    const decoded = decodeMessage(data);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') {
      // payload is the frame minus the leading message-type varuint
      expect(Array.from(decoded.payload)).toEqual(Array.from(subBytes));
      // and the submessage is a well-formed SyncStep1
      const dec = decoding.createDecoder(decoded.payload);
      expect(decoding.readVarUint(dec)).toBe(0);
      expect(Array.from(decoding.readVarUint8Array(dec))).toEqual(Array.from(stateVector));
    }
  });

  it('decodes an awareness frame (type 1) with its bytes payload', () => {
    const awarenessBytes = new Uint8Array([9, 8, 7, 6]);
    const data = awarenessFrame(awarenessBytes);

    const decoded = decodeMessage(data);
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') {
      expect(Array.from(decoded.payload)).toEqual(Array.from(awarenessBytes));
    }
  });

  it('decodes a query-awareness frame (type 3)', () => {
    const data = plainFrame(MESSAGE_QUERY_AWARENESS);
    expect(decodeMessage(data)).toEqual({ kind: 'query-awareness' });
  });

  it('returns invalid for an unknown message type 9', () => {
    const decoded = decodeMessage(plainFrame(9));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') {
      expect(decoded.reason).toBeTruthy();
    }
  });

  it('returns invalid for truncated bytes (sync type with no submessage)', () => {
    const truncated = new Uint8Array([MESSAGE_SYNC]); // just the type varuint
    const decoded = decodeMessage(truncated.buffer as ArrayBuffer);
    expect(decoded.kind).toBe('invalid');
  });

  it('returns invalid for a string frame', () => {
    const decoded = decodeMessage('this is not a binary frame');
    expect(decoded.kind).toBe('invalid');
  });
});
