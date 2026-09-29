// Story 3, task 1: protocol frame decode unit tests (TC-03).
//
// Frames are built exactly the way the y-websocket client builds them
// (lib0 varUint message type + payload), so the decode results are what a
// real client would produce on the wire.

import { createDecoder, readVarUint8Array } from 'lib0/decoding';
import {
  createEncoder,
  toUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import {
  decodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  SYNC_STEP1,
  SYNC_STEP2,
  SYNC_UPDATE,
} from '../../src/shared/protocol';

function syncFrame(sub: number, bytes: Uint8Array): ArrayBuffer {
  const enc = createEncoder();
  writeVarUint(enc, MESSAGE_SYNC);
  writeVarUint(enc, sub);
  writeVarUint8Array(enc, bytes);
  return toUint8Array(enc).buffer as ArrayBuffer;
}

function awarenessFrame(update: Uint8Array): ArrayBuffer {
  const enc = createEncoder();
  writeVarUint(enc, MESSAGE_AWARENESS);
  writeVarUint8Array(enc, update);
  return toUint8Array(enc).buffer as ArrayBuffer;
}

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync step1 frame', () => {
    const sv = new Uint8Array([0, 5, 1, 42]);
    const decoded = decodeMessage(syncFrame(SYNC_STEP1, sv));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    // Payload is the frame after the message-type byte: sub-type + byte array.
    expect(decoded.payload[0]).toBe(SYNC_STEP1);
  });

  it('decodes a sync step2 (update) frame', () => {
    const update = new Uint8Array([1, 2, 3, 4, 5]);
    const decoded = decodeMessage(syncFrame(SYNC_STEP2, update));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    expect(decoded.payload[0]).toBe(SYNC_STEP2);
  });

  it('decodes a sync update frame', () => {
    const update = new Uint8Array([9, 9]);
    const decoded = decodeMessage(syncFrame(SYNC_UPDATE, update));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    expect(decoded.payload[0]).toBe(SYNC_UPDATE);
  });

  it('decodes an awareness frame and exposes the raw payload', () => {
    const update = new Uint8Array([10, 20, 30]);
    const decoded = decodeMessage(awarenessFrame(update));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') return;
    // The payload starts at the varUint8Array length prefix; re-decoding it
    // must yield the exact bytes that were sent.
    const dec = createDecoder(decoded.payload);
    expect(Array.from(readVarUint8Array(dec))).toEqual(Array.from(update));
  });

  it('decodes a query-awareness frame', () => {
    const enc = createEncoder();
    writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
    expect(decodeMessage(toUint8Array(enc).buffer as ArrayBuffer)).toEqual({
      kind: 'query-awareness',
    });
  });

  it('rejects unknown message type 9', () => {
    const enc = createEncoder();
    writeVarUint(enc, 9);
    const decoded = decodeMessage(toUint8Array(enc).buffer as ArrayBuffer);
    expect(decoded.kind).toBe('invalid');
  });

  it('rejects a truncated sync frame (byte array cut short)', () => {
    // [sync][update][len=10] followed by only 3 bytes.
    const bytes = new Uint8Array([MESSAGE_SYNC, SYNC_UPDATE, 10, 1, 2, 3]);
    const decoded = decodeMessage(bytes.buffer as ArrayBuffer);
    expect(decoded.kind).toBe('invalid');
  });

  it('rejects a truncated awareness frame', () => {
    const bytes = new Uint8Array([MESSAGE_AWARENESS, 5, 1, 2]);
    const decoded = decodeMessage(bytes.buffer as ArrayBuffer);
    expect(decoded.kind).toBe('invalid');
  });

  it('rejects an empty frame', () => {
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  it('rejects a string frame', () => {
    expect(decodeMessage('not binary').kind).toBe('invalid');
  });
});
