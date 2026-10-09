import { describe, expect, it } from 'vitest';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';

/**
 * TC-03 of story 3 (`sync.room`): the room's one decoder for every frame it may
 * receive. Known types come back typed; everything the wire could still carry comes
 * back `invalid`, which is what makes the room close the sending socket and nothing
 * else (`live.status` must not be affected by one misbehaving client).
 */

/** The frames arrive from the WebSocket as `ArrayBuffer`s; tests match that shape. */
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** A `MESSAGE_SYNC` frame: the y-protocols sync message follows the type unchanged. */
function syncFrame(payload: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, payload);
  return asArrayBuffer(encoding.toUint8Array(encoder));
}

/** A `MESSAGE_AWARENESS` frame: y-websocket length-prefixes the awareness update. */
function awarenessFrame(payload: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, payload);
  return asArrayBuffer(encoding.toUint8Array(encoder));
}

function queryAwarenessFrame(): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return asArrayBuffer(encoding.toUint8Array(encoder));
}

/** A real SyncStep1, so the payload is a real y-protocols message, not filler bytes. */
function realSyncStep1(): Uint8Array {
  const doc = new Y.Doc();
  const encoder = encoding.createEncoder();
  syncProtocol.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder);
}

/** A real awareness update for one client. */
function realAwarenessUpdate(): Uint8Array {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalStateField('story', 3);
  return awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);
}

function bytesOf(payload: Uint8Array): Uint8Array {
  return payload;
}

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame into the sync message bytes it carries', () => {
    const payload = realSyncStep1();
    const decoded = decodeMessage(syncFrame(payload));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    expect(Array.from(decoded.payload)).toStrictEqual(Array.from(bytesOf(payload)));
  });

  it('decodes an awareness frame into the awareness update bytes it carries', () => {
    const payload = realAwarenessUpdate();
    const decoded = decodeMessage(awarenessFrame(payload));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') return;
    expect(Array.from(decoded.payload)).toStrictEqual(Array.from(bytesOf(payload)));
  });

  it('decodes a query-awareness frame, which has no payload', () => {
    expect(decodeMessage(queryAwarenessFrame())).toStrictEqual({ kind: 'query-awareness' });
  });

  // Error paths: each of these makes the room close *that* socket with 1003.
  it('reports an unknown message type as invalid', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    encoding.writeUint8Array(encoder, new Uint8Array([1, 2, 3]));
    const decoded = decodeMessage(asArrayBuffer(encoding.toUint8Array(encoder)));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind !== 'invalid') return;
    expect(decoded.reason).toMatch(/type|message/i);
  });

  it('reports bytes that run out as invalid', () => {
    // Announces a 64 byte awareness update and then carries three bytes.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint(encoder, 64);
    encoding.writeUint8Array(encoder, new Uint8Array([1, 2, 3]));
    const decoded = decodeMessage(asArrayBuffer(encoding.toUint8Array(encoder)));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind !== 'invalid') return;
    expect(decoded.reason.length).toBeGreaterThan(0);
  });

  it('reports a text frame as invalid', () => {
    for (const text of ['hello', '', '{"kind":"sync"}']) {
      const decoded = decodeMessage(text);
      expect(decoded.kind).toBe('invalid');
      if (decoded.kind !== 'invalid') continue;
      expect(decoded.reason).toMatch(/binary|text|frame/i);
    }
  });

  it('reports an empty frame as invalid', () => {
    const decoded = decodeMessage(new ArrayBuffer(0));
    expect(decoded.kind).toBe('invalid');
  });

  it('hands over the payload of a frame exactly, with nothing extra at either end', () => {
    // The sync message is read from a decoder built over the payload, so the payload
    // has to be neither truncated nor padded by the frame around it.
    const payload = new Uint8Array([0, 3, 1, 4, 5]);
    const decoded = decodeMessage(syncFrame(payload));
    if (decoded.kind !== 'sync') {
      throw new Error(`expected a sync frame, got ${JSON.stringify(decoded)}`);
    }
    const decoder = decoding.createDecoder(decoded.payload);
    for (const byte of payload) expect(decoding.readVarUint(decoder)).toBe(byte);
    expect(decoder.pos).toBe(decoded.payload.length);
  });

  it('uses the RFC 6455 code the design names for every invalid frame', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
  });
});
