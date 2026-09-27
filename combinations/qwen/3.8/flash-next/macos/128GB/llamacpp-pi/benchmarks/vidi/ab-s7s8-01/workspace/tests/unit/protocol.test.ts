import { describe, expect, test } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
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

function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeUint8(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** Build a full step2 wire frame: [sync][step2][len][update]. */
function encodeSyncStep2(update: Uint8Array): Uint8Array {
  const out = encoding.createEncoder();
  encoding.writeUint8(out, MESSAGE_SYNC);
  encoding.writeVarUint(out, SYNC_STEP2);
  encoding.writeVarUint8Array(out, update);
  return encoding.toUint8Array(out);
}

function encodeUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeUint8(encoder, MESSAGE_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
}

function encodeAwareness(bytes: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeUint8(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, bytes);
  return encoding.toUint8Array(encoder);
}

/** Strip the trailing byte to build truncated variants. */
function truncate(frame: Uint8Array, n = 1): Uint8Array {
  return frame.slice(0, frame.length - n);
}

describe('decodeMessage — valid frames', () => {
  test('a sync step1 frame decodes to kind "sync" with the sync payload intact', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 'b');
    const frame = encodeSyncStep1(doc);
    const decoded = decodeMessage(frame);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    // The payload starts with the sync sub-type and round-trips through
    // readSyncMessage (i.e. the room can consume it verbatim).
    expect(decoded.payload[0]).toBe(SYNC_STEP1);
    const doc2 = new Y.Doc();
    const reply = encoding.createEncoder();
    expect(() =>
      syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), reply, doc2, null),
    ).not.toThrow();
  });

  test('a sync step2 frame decodes to kind "sync" and applies', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 'b');
    const frame = encodeSyncStep2(Y.encodeStateAsUpdate(doc));
    const decoded = decodeMessage(frame);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    expect(decoded.payload[0]).toBe(SYNC_STEP2);
    // A doc update inside step2 is applied.
    const doc2 = new Y.Doc();
    const reply = encoding.createEncoder();
    expect(() =>
      syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), reply, doc2, null),
    ).not.toThrow();
    expect(doc2.getMap('objects').get('a')).toBe('b');
  });

  test('an update frame decodes to kind "sync" and applies', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 'b');
    const update = Y.encodeStateAsUpdate(doc);
    const frame = encodeUpdate(update);
    const decoded = decodeMessage(frame);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    expect(decoded.payload[0]).toBe(SYNC_UPDATE);
    const doc2 = new Y.Doc();
    const reply = encoding.createEncoder();
    expect(() =>
      syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), reply, doc2, null),
    ).not.toThrow();
    expect(doc2.getMap('objects').get('a')).toBe('b');
  });

  test('an awareness frame decodes to kind "awareness" with the payload intact', () => {
    const payload = new Uint8Array([2, 1, 97, 108, 105, 99, 101]); // tiny awareness update
    const frame = encodeAwareness(payload);
    const decoded = decodeMessage(frame);
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') return;
    // The payload keeps the lib0 length prefix (the room relays it verbatim,
    // so it must stay byte-identical to what a client expects).
    expect(Array.from(decoded.payload)).toEqual(Array.from(frame.slice(1)));
  });

  test('a query-awareness frame (single byte 3) decodes to kind "query-awareness"', () => {
    const decoded = decodeMessage(new Uint8Array([MESSAGE_QUERY_AWARENESS]).buffer);
    expect(decoded.kind).toBe('query-awareness');
  });

  test('an empty-content step2 frame is still valid (fresh-room sync)', () => {
    // [sync, step2, length=0]
    const decoded = decodeMessage(new Uint8Array([MESSAGE_SYNC, SYNC_STEP2, 0]).buffer);
    expect(decoded.kind).toBe('sync');
  });
});

describe('decodeMessage — invalid frames (error paths)', () => {
  test('unknown channel type 9', () => {
    const decoded = decodeMessage(new Uint8Array([9, 0, 0]).buffer);
    expect(decoded.kind).toBe('invalid');
  });

  test('unknown sync sub-type', () => {
    const frame = encodeUpdate(new Uint8Array([1, 2, 3]));
    frame[1] = 7; // not step1/step2/update
    expect(decodeMessage(frame).kind).toBe('invalid');
  });

  test('a truncated sync frame fails the length check', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 'b');
    const frame = encodeUpdate(Y.encodeStateAsUpdate(doc));
    // Truncating the content (keeping the length prefix) must be rejected.
    expect(frame.length).toBeGreaterThan(4);
    const cut = truncate(frame, 3);
    expect(decodeMessage(cut).kind).toBe('invalid');
  });

  test('a truncated awareness frame is rejected', () => {
    const frame = encodeAwareness(new Uint8Array([2, 1, 116, 101, 115, 116]));
    expect(decodeMessage(truncate(frame, 2)).kind).toBe('invalid');
  });

  test('a text frame is invalid', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });

  test('an empty frame is invalid', () => {
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  test('query-awareness with trailing bytes is invalid', () => {
    expect(decodeMessage(new Uint8Array([MESSAGE_QUERY_AWARENESS, 1]).buffer).kind).toBe('invalid');
  });

  test('the close code constant matches the contract', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});