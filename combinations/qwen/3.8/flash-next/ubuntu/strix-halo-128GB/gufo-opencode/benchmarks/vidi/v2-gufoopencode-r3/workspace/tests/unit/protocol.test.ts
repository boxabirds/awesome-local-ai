import { describe, expect, it } from 'vitest';
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array
} from 'lib0/encoding';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage
} from '../../src/shared/protocol';

function buf(...values: number[]): ArrayBuffer {
  return Uint8Array.from(values).slice().buffer as ArrayBuffer;
}

// A complete awareness frame exactly as the y-websocket client sends it:
// type byte + varuint8array-encoded awareness update.
function awarenessFrame(update: number[]): ArrayBuffer {
  const encoder = createEncoder();
  writeVarUint(encoder, MESSAGE_AWARENESS);
  writeVarUint8Array(encoder, Uint8Array.from(update));
  return toUint8Array(encoder).slice().buffer as ArrayBuffer;
}

// TC-03: decodeMessage types known frames and reports invalid ones.
describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame to its payload after the type byte', () => {
    // sync step-1 (type 0) with a two-entry state vector body
    const decoded = decodeMessage(buf(MESSAGE_SYNC, 0, 2, 1, 9));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') {
      expect(Array.from(decoded.payload)).toEqual([0, 2, 1, 9]);
    }
  });

  it('decodes an awareness frame to the complete frame bytes (relayed verbatim)', () => {
    const raw = awarenessFrame([5, 9, 7]);
    const decoded = decodeMessage(raw);
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') {
      expect(Array.from(decoded.payload)).toEqual(Array.from(new Uint8Array(raw)));
    }
  });

  it('decodes a query-awareness frame', () => {
    expect(decodeMessage(buf(MESSAGE_QUERY_AWARENESS))).toEqual({
      kind: 'query-awareness'
    });
  });

  it('reports unknown message type 9 as invalid', () => {
    const decoded = decodeMessage(buf(9, 1, 2, 3));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') expect(decoded.reason).toContain('9');
  });

  it('reports truncated bytes as invalid', () => {
    // Declares a varuint8array of 72 bytes (varuint 0xC8 0x00) but carries
    // no payload.
    expect(decodeMessage(buf(MESSAGE_AWARENESS, 200, 0)).kind).toBe('invalid');
    // An empty frame cannot even carry a type byte.
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  it('reports a string frame as invalid', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });

  it('uses the y-websocket close code for unsupported data', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
  });
});
