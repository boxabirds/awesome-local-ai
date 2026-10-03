// TC-03 — y-websocket message decoding (sync.room).
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';

/** Turn an encoder into the ArrayBuffer a WebSocket `message` event carries. */
function bufferOf(encoder: encoding.Encoder): ArrayBuffer {
  const bytes = encoding.toUint8Array(encoder);
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function syncFrame(doc: Y.Doc): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return bufferOf(encoder);
}

function updateFrame(update: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return bufferOf(encoder);
}

function awarenessFrame(update: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return bufferOf(encoder);
}

describe('decodeMessage (TC-03)', () => {
  it('exposes the y-websocket message type constants', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });

  it('types a SyncStep1 frame and keeps its body intact', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 1);
    const decoded = decodeMessage(syncFrame(doc));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    // The body is exactly what y-protocols/sync reads back.
    const decoder = decoding.createDecoder(decoded.payload);
    expect(syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), doc, null))
      .toBe(syncProtocol.messageYjsSyncStep1);
  });

  it('types a document-update frame', () => {
    const doc = new Y.Doc();
    const update = Y.encodeStateAsUpdate(doc);
    const decoded = decodeMessage(updateFrame(update));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    const decoder = decoding.createDecoder(decoded.payload);
    expect(syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), doc, null))
      .toBe(syncProtocol.messageYjsUpdate);
  });

  it('types an awareness frame and returns the awareness update', () => {
    const update = new Uint8Array([1, 2, 3, 4]);
    const decoded = decodeMessage(awarenessFrame(update));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') return;
    expect(Array.from(decoded.payload)).toEqual(Array.from(update));
  });

  it('types a query-awareness frame with no payload', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
    const decoded = decodeMessage(bufferOf(encoder));
    expect(decoded).toEqual({ kind: 'query-awareness' });
  });

  it('reports an unknown message type as invalid', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    encoding.writeVarUint(encoder, 0);
    const decoded = decodeMessage(bufferOf(encoder));
    expect(decoded.kind).toBe('invalid');
  });

  it('reports truncated bytes as invalid', () => {
    // Awareness header promising 10 bytes, only 2 delivered.
    expect(decodeMessage(new Uint8Array([MESSAGE_AWARENESS, 10, 1, 2]).buffer))
      .toMatchObject({ kind: 'invalid' });
    // A frame that promises a body and delivers none.
    expect(decodeMessage(new Uint8Array([MESSAGE_AWARENESS, 5]).buffer))
      .toMatchObject({ kind: 'invalid' });
    // An empty frame carries no message type at all.
    expect(decodeMessage(new ArrayBuffer(0))).toMatchObject({ kind: 'invalid' });
    // A sync frame with a type but no body.
    expect(decodeMessage(new Uint8Array([MESSAGE_SYNC]).buffer))
      .toMatchObject({ kind: 'invalid' });
  });

  it('reports a text frame as invalid', () => {
    expect(decodeMessage('hello')).toMatchObject({ kind: 'invalid' });
    expect(decodeMessage('')).toMatchObject({ kind: 'invalid' });
  });

  it('never throws for any malformed input', () => {
    for (const input of ['x', '', new ArrayBuffer(0), new Uint8Array([255]).buffer]) {
      expect(() => decodeMessage(input as ArrayBuffer | string)).not.toThrow();
    }
  });
});
