import { describe, expect, it } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';

/**
 * TC-03 — message decoding (sync.room).
 *
 * The room's error handling depends on being able to tell "usable frame" from
 * "close this socket", so every shape of frame it must distinguish is asserted
 * here as pure logic, with real y-protocols and lib0 encoders on the input side.
 */

/**
 * Wire frames exactly as y-websocket writes them: the message type is a
 * varUint, a sync payload follows as raw bytes, an awareness payload is
 * length-prefixed by `writeVarUint8Array`.
 */
function toBuffer(encoder: encoding.Encoder): ArrayBuffer {
  const bytes = encoding.toUint8Array(encoder);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function syncFrame(payload: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, payload);
  return toBuffer(encoder);
}

function awarenessFrame(update: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return toBuffer(encoder);
}

function typeOf(payload: Uint8Array): number {
  return decoding.readVarUint(decoding.createDecoder(payload));
}

describe('decodeMessage (TC-03)', () => {
  it('knows the y-websocket message types it relays', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });

  it('types a sync frame and hands over the payload untouched', () => {
    const doc = new Y.Doc();
    const payloadEncoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(payloadEncoder, doc);
    const payload = encoding.toUint8Array(payloadEncoder);
    const decoded = decodeMessage(syncFrame(payload));

    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') {
      return;
    }
    expect(decoded.payload).toBeInstanceOf(Uint8Array);
    // The payload is still a complete y-protocols message.
    expect(typeOf(decoded.payload)).toBe(syncProtocol.messageYjsSyncStep1);
  });

  it('types an awareness frame and keeps every byte', () => {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalStateField('cursor', { x: 1, y: 2 });
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);

    const frameBytes = new Uint8Array(awarenessFrame(update));
    const decoded = decodeMessage(awarenessFrame(update));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') {
      return;
    }
    // Everything after the type byte, unchanged: the room can relay it verbatim.
    expect(Array.from(decoded.payload)).toEqual(Array.from(frameBytes.slice(1)));
    // And the update inside it is still readable by the awareness protocol.
    const updateBytes = decoding.readVarUint8Array(decoding.createDecoder(decoded.payload));
    const peer = new awarenessProtocol.Awareness(new Y.Doc());
    awarenessProtocol.applyAwarenessUpdate(peer, updateBytes, 'test');
    expect(peer.getStates().get(doc.clientID)).toEqual({ cursor: { x: 1, y: 2 } });
  });

  it('types a query-awareness frame, which carries no payload', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
    const decoded = decodeMessage(toBuffer(encoder));
    expect(decoded.kind).toBe('query-awareness');
  });

  it('rejects an unknown message type with a reason', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    encoding.writeUint8Array(encoder, new Uint8Array([1, 2, 3]));
    const decoded = decodeMessage(toBuffer(encoder));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind !== 'invalid') {
      return;
    }
    expect(typeof decoded.reason).toBe('string');
    expect(decoded.reason.length).toBeGreaterThan(0);
  });

  it('rejects truncated frames', () => {
    // A known type with no content at all.
    expect(decodeMessage(syncFrame(new Uint8Array(0))).kind).toBe('invalid');
    expect(decodeMessage(awarenessFrame(new Uint8Array(0))).kind).toBe('invalid');
    // An awareness frame whose declared update is longer than the frame.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint(encoder, 40);
    encoding.writeUint8Array(encoder, new Uint8Array([1, 2, 3]));
    expect(decodeMessage(toBuffer(encoder)).kind).toBe('invalid');
    // A sync frame whose y-protocols message is cut short: the frame itself is
    // well formed, the sync reader is what rejects it.
    const doc = new Y.Doc();
    const payloadEncoder = encoding.createEncoder();
    syncProtocol.writeSyncStep2(payloadEncoder, doc);
    const full = encoding.toUint8Array(payloadEncoder);
    expect(decodeMessage(syncFrame(full.subarray(0, 1))).kind).toBe('sync');
    // A varUint that announces a continuation byte that never arrives.
    expect(decodeMessage(new Uint8Array([0x80]).buffer).kind).toBe('invalid');
    // Empty input.
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  it('rejects a text frame: the protocol is binary only', () => {
    const decoded = decodeMessage('hello');
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind !== 'invalid') {
      return;
    }
    expect(decoded.reason.length).toBeGreaterThan(0);
  });

  it('accepts a frame whose bytes are a real sync message from another client', () => {
    const remote = new Y.Doc();
    remote.getMap('objects').set('a', 1);
    const update = Y.encodeStateAsUpdate(remote);

    const payloadEncoder = encoding.createEncoder();
    encoding.writeVarUint(payloadEncoder, syncProtocol.messageYjsSyncStep2);
    encoding.writeVarUint8Array(payloadEncoder, update);

    const decoded = decodeMessage(syncFrame(encoding.toUint8Array(payloadEncoder)));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') {
      return;
    }
    const local = new Y.Doc();
    // The payload round-trips through the real sync reader.
    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(decoding.createDecoder(decoded.payload), reply, local, null);
    expect(local.getMap('objects').get('a')).toBe(1);
  });
});
