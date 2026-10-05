/**
 * Unit tests for the wire format of a board connection (sync.room).
 *
 * The room's first job is deciding what a received frame even is, and getting that
 * wrong in the interesting direction — calling bad data good — means garbage reaches
 * other people's screens. So the decoder is tested here, against frames built the way
 * the browser's provider builds them, with the same lib0 encoders and the same
 * y-protocols sync steps.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';

import { initDoc } from '../../src/shared/board-model';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';

/** A frame is binary on the wire; a socket hands the room an ArrayBuffer. */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** A frame in the shape the browser's provider sends it: type byte, then payload. */
function frame(type: number, payload?: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  if (payload !== undefined) encoding.writeVarUint8Array(encoder, payload);
  return bufferOf(encoding.toUint8Array(encoder));
}

/** A frame whose payload is written by hand, for the ones that are broken. */
function raw(types: number[]): ArrayBuffer {
  const encoder = encoding.createEncoder();
  for (const type of types) encoding.writeVarUint(encoder, type);
  return bufferOf(encoding.toUint8Array(encoder));
}

describe('decodeMessage (TC-03)', () => {
  it('reads the sync step a connecting client sends', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, doc);

    const decoded = decodeMessage(bufferOf(encoding.toUint8Array(encoder)));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    // The payload is the sync step itself: the type byte stripped, nothing else
    // touched, so Yjs can read it as if the client had sent it directly.
    const decoder = decoding.createDecoder(decoded.payload);
    expect(decoding.readVarUint(decoder)).toBe(0); // syncStep1
  });

  it('reads a document update, which is what a change on a board arrives as', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const update = Y.encodeStateAsUpdateV2(doc);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);

    const decoded = decodeMessage(bufferOf(encoding.toUint8Array(encoder)));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    // The room hands the payload to Yjs unread; inside it is a sync "update" message
    // holding the document update, which is what a second document can be given.
    const decoder = decoding.createDecoder(decoded.payload);
    expect(decoding.readVarUint(decoder)).toBe(2); // messageUpdate
    expect(() => Y.applyUpdateV2(new Y.Doc(), decoding.readVarUint8Array(decoder))).not.toThrow();
  });

  it('reads an awareness frame and keeps the bytes it arrived as', () => {
    const payload = new Uint8Array([7, 1, 2, 3]);
    const decoded = decodeMessage(frame(MESSAGE_AWARENESS, payload));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') return;
    expect([...decoded.payload]).toEqual([...payload]);
  });

  it('recognises a query-awareness frame, which this build does not answer', () => {
    expect(decodeMessage(frame(MESSAGE_QUERY_AWARENESS)).kind).toBe('query-awareness');
  });

  it('refuses a message type nobody defined', () => {
    expect(decodeMessage(frame(9)).kind).toBe('invalid');
  });

  it('refuses an awareness frame that stops in the middle', () => {
    // Announces ten bytes and delivers three: reading it would run off the end.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint(encoder, 10);
    encoding.writeUint8(encoder, 1);
    encoding.writeUint8(encoder, 2);
    encoding.writeUint8(encoder, 3);
    expect(decodeMessage(bufferOf(encoding.toUint8Array(encoder))).kind).toBe('invalid');
  });

  it('refuses a sync frame with no step in it', () => {
    expect(decodeMessage(raw([MESSAGE_SYNC])).kind).toBe('invalid');
  });

  it('refuses a text frame, because the board protocol is binary', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });

  it('refuses an empty frame', () => {
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  it('names the close code that means unsupported data', () => {
    // The room closes the one connection that sent the bad frame with this code;
    // 1003 is the RFC 6455 code for exactly that.
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
  });
});
