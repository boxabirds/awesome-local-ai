import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  encodeFrame,
} from '../../src/shared/protocol';

// TC-03 (sync.room): the room's one decoding boundary. Every malformed frame has
// to come back as `invalid` so the room can close a single socket instead of
// throwing at the runtime. Frames here are built with the same lib0 encoders the
// browser provider uses.

const bufferOf = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

/** A sync frame: type byte, then the y-protocols message inline (not length-prefixed). */
const syncFrame = (body: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, body);
  return encoding.toUint8Array(encoder);
};

/** The y-protocols body of a sync frame carrying one document update. */
const updateBody = (update: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  syncProtocol.writeUpdate(encoder, update);
  return encoding.toUint8Array(encoder);
};

const awarenessFrame = (awarenessUpdate: Uint8Array): Uint8Array => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, awarenessUpdate);
  return encoding.toUint8Array(encoder);
};

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame into the y-protocols message after the type byte', () => {
    const source = new Y.Doc();
    source.getMap('objects').set('a', 'b');
    const body = updateBody(Y.encodeStateAsUpdate(source));

    const decoded = decodeMessage(bufferOf(syncFrame(body)));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    expect(Array.from(decoded.payload)).toEqual(Array.from(body));

    // Those exact bytes are what `readSyncMessage` consumes, so a decoded sync
    // frame really is feedable: the receiver ends up with the sender's map.
    const target = new Y.Doc();
    const reply = encoding.createEncoder();
    const syncType = syncProtocol.readSyncMessage(
      decoding.createDecoder(decoded.payload),
      reply,
      target,
      'unit-test',
    );
    expect(syncType).toBe(syncProtocol.messageYjsUpdate);
    expect(target.getMap('objects').get('a')).toBe('b');
  });

  it('decodes an awareness frame into its awareness update', () => {
    const awarenessUpdate = Uint8Array.from([1, 4, 116, 45, 111]);
    const decoded = decodeMessage(bufferOf(awarenessFrame(awarenessUpdate)));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') {
      expect(Array.from(decoded.payload)).toEqual(Array.from(awarenessUpdate));
    }
  });

  it('decodes a query-awareness frame, which has no payload', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
    expect(decodeMessage(bufferOf(encoding.toUint8Array(encoder)))).toEqual({
      kind: 'query-awareness',
    });
  });

  it('reports an unknown message type as invalid', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    encoding.writeVarUint8Array(encoder, Uint8Array.from([7, 7, 7]));
    const decoded = decodeMessage(bufferOf(encoding.toUint8Array(encoder)));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') expect(decoded.reason).toContain('9');
  });

  it('reports truncated frames as invalid', () => {
    // (a) awareness: the length prefix promises more bytes than the frame holds
    const full = awarenessFrame(Uint8Array.from([9, 9, 9, 9, 9]));
    expect(decodeMessage(bufferOf(full.subarray(0, full.length - 3))).kind).toBe('invalid');

    // (b) sync: a type byte and nothing else
    expect(decodeMessage(bufferOf(Uint8Array.from([MESSAGE_SYNC]))).kind).toBe('invalid');

    // (c) nothing at all
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  it('reports a text frame as invalid', () => {
    const decoded = decodeMessage('hello');
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') expect(decoded.reason).toMatch(/text/);
  });

  it('closes malformed frames with 1003 (Unsupported Data)', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});

describe('encodeFrame', () => {
  it('round-trips awareness payloads through decodeMessage', () => {
    const payload = Uint8Array.from([3, 1, 4, 1, 5, 9, 2, 6]);
    const decoded = decodeMessage(bufferOf(encodeFrame(MESSAGE_AWARENESS, payload)));
    expect(decoded.kind === 'awareness' ? Array.from(decoded.payload) : null).toEqual(
      Array.from(payload),
    );
  });
});
