import { describe, expect, it } from 'vitest';
import { createEncoder, toUint8Array, writeUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  SYNC_STEP1,
  SYNC_STEP2,
  SYNC_UPDATE,
  decodeMessage,
} from '../../src/shared/protocol';

/** Frame a y-protocols sync message as the y-websocket client would: [0][raw sync message bytes]. */
function syncFrame(inner: Uint8Array): Uint8Array {
  const encoder = createEncoder();
  writeVarUint(encoder, MESSAGE_SYNC);
  // `inner` already starts with its own sync message type byte and carries
  // its own varuint8array framing; it is appended raw.
  writeUint8Array(encoder, inner);
  return toUint8Array(encoder);
}

function syncStep1Frame(doc: Y.Doc): Uint8Array {
  const inner = createEncoder();
  syncProtocol.writeSyncStep1(inner, doc);
  return syncFrame(toUint8Array(inner));
}

function syncStep2Frame(update: Uint8Array): Uint8Array {
  const encoder = createEncoder();
  writeVarUint(encoder, SYNC_STEP2);
  writeVarUint8Array(encoder, update);
  return syncFrame(toUint8Array(encoder));
}

function updateFrame(update: Uint8Array): Uint8Array {
  const encoder = createEncoder();
  writeVarUint(encoder, SYNC_UPDATE);
  writeVarUint8Array(encoder, update);
  return syncFrame(toUint8Array(encoder));
}

function awarenessFrame(update: Uint8Array): Uint8Array {
  const encoder = createEncoder();
  writeVarUint(encoder, MESSAGE_AWARENESS);
  writeVarUint8Array(encoder, update);
  return toUint8Array(encoder);
}

/** A well-formed (non-empty) Yjs update to frame. */
function someUpdate(): Uint8Array {
  const other = new Y.Doc();
  const doc = new Y.Doc();
  doc.getMap('objects').set('a', new Y.Map());
  // Encode everything of `doc` as seen from a doc that knows nothing of it.
  return Y.encodeStateAsUpdate(doc, Y.encodeStateVector(other));
}

describe('sync.room: frame decoding', () => {
  // TC-03: well-formed frames are classified.
  it('TC-03 decodes a sync frame to its sync payload', () => {
    const doc = new Y.Doc();
    const decoded = decodeMessage(syncStep1Frame(doc).buffer.slice(0));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') throw new Error('unreachable');
    // The payload starts with the sync message type byte.
    expect(decoded.payload[0]).toBe(SYNC_STEP1);

    const update = someUpdate();
    expect(decodeMessage(syncStep2Frame(update).buffer.slice(0)).kind).toBe('sync');
    expect(decodeMessage(updateFrame(update).buffer.slice(0)).kind).toBe('sync');
  });

  it('TC-03 decodes an awareness frame to its payload', () => {
    const awarenessUpdate = Uint8Array.from([0, 1, 2, 3]);
    const decoded = decodeMessage(awarenessFrame(awarenessUpdate).buffer.slice(0));
    expect(decoded).toEqual({ kind: 'awareness', payload: awarenessUpdate });
  });

  it('TC-03 decodes a query-awareness frame (no payload)', () => {
    const frame = createEncoder();
    writeVarUint(frame, MESSAGE_QUERY_AWARENESS);
    const decoded = decodeMessage(toUint8Array(frame).buffer.slice(0));
    expect(decoded).toEqual({ kind: 'query-awareness' });
  });

  // TC-03 (error paths): malformed frames are classified invalid.
  it('TC-03 rejects a string frame', () => {
    const decoded = decodeMessage('not binary');
    expect(decoded).toEqual({ kind: 'invalid', reason: expect.any(String) });
  });

  it('TC-03 rejects an unknown message type (9)', () => {
    const frame = createEncoder();
    writeVarUint(frame, 9);
    writeVarUint(frame, 1);
    const decoded = decodeMessage(toUint8Array(frame).buffer.slice(0));
    expect(decoded).toEqual({ kind: 'invalid', reason: expect.any(String) });
  });

  it('TC-03 rejects truncated frames', () => {
    // sync frame whose varuint8array length prefix promises bytes that are missing
    const truncated = Uint8Array.from([MESSAGE_SYNC, SYNC_STEP1, 0x90, 0x01]);
    expect(decodeMessage(truncated.buffer.slice(0))).toEqual({
      kind: 'invalid',
      reason: expect.any(String),
    });
    // awareness frame with a truncated length prefix
    const truncatedAwareness = Uint8Array.from([MESSAGE_AWARENESS, 0x80]);
    expect(decodeMessage(truncatedAwareness.buffer.slice(0))).toEqual({
      kind: 'invalid',
      reason: expect.any(String),
    });
    // sync frame with no payload at all
    const noPayload = Uint8Array.from([MESSAGE_SYNC]);
    expect(decodeMessage(noPayload.buffer.slice(0))).toEqual({
      kind: 'invalid',
      reason: expect.any(String),
    });
  });

  it('exposes the close code used for malformed traffic', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
