import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol.js';

const toArrayBuffer = (encoder: encoding.Encoder): ArrayBuffer => {
  const bytes = encoding.toUint8Array(encoder);
  // Copy into a standalone ArrayBuffer so `new Uint8Array(data)` sees exactly these bytes.
  return bytes.slice().buffer as ArrayBuffer;
};

const syncStep1Frame = (doc: Y.Doc): ArrayBuffer => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return toArrayBuffer(encoder);
};

const awarenessFrame = (payload: Uint8Array): ArrayBuffer => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, payload);
  return toArrayBuffer(encoder);
};

const queryAwarenessFrame = (): ArrayBuffer => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return toArrayBuffer(encoder);
};

describe('protocol decodeMessage (sync.room)', () => {
  it('TC-03 decodes a sync frame into a typed sync payload', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('x', 1);
    const decoded = decodeMessage(syncStep1Frame(doc));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    // The payload is the sync sub-message: it begins with the SyncStep1 type and the
    // room can feed it straight into y-protocols.
    const sub = decoding.createDecoder(decoded.payload);
    expect(decoding.readVarUint(sub)).toBe(syncProtocol.messageYjsSyncStep1);
  });

  it('TC-03 decodes an awareness frame into a typed awareness payload (verbatim bytes)', () => {
    const awarenessBytes = new Uint8Array([1, 2, 3, 4, 200]);
    const decoded = decodeMessage(awarenessFrame(awarenessBytes));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') return;
    expect(Array.from(decoded.payload)).toEqual(Array.from(awarenessBytes));
  });

  it('TC-03 decodes a query-awareness frame', () => {
    expect(decodeMessage(queryAwarenessFrame()).kind).toBe('query-awareness');
  });

  it('TC-03 reports an unknown message type (9) as invalid', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    const decoded = decodeMessage(toArrayBuffer(encoder));
    expect(decoded.kind).toBe('invalid');
  });

  it('TC-03 reports truncated awareness bytes as invalid', () => {
    // Announce a 10-byte awareness update but only supply 3 bytes.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint(encoder, 10);
    encoding.writeUint8(encoder, 7);
    encoding.writeUint8(encoder, 7);
    encoding.writeUint8(encoder, 7);
    expect(decodeMessage(toArrayBuffer(encoder)).kind).toBe('invalid');
  });

  it('TC-03 reports an empty frame as invalid', () => {
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  it('TC-03 reports a text frame as invalid', () => {
    const decoded = decodeMessage('not a binary frame');
    expect(decoded.kind).toBe('invalid');
  });

  it('exposes the documented close code', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
