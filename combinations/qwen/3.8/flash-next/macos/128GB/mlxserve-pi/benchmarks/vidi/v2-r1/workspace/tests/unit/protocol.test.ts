import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { describe, expect, it } from 'vitest';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  type Decoded,
} from '../../src/shared/protocol';

/**
 * TC-03 (sync.room): the room's frame decoder classifies exactly the frames
 * y-websocket sends, and reports every malformed frame as `invalid` so the room
 * can close just that socket. Frames are built with the same lib0 / y-protocols
 * encoders the browser provider uses.
 */

const frameBytes = (encoder: encoding.Encoder): ArrayBuffer => {
  const bytes = encoding.toUint8Array(encoder);
  // Hand out a detached-copy buffer, exactly like a WebSocket frame's data.
  return bytes.slice().buffer;
};

/** A sync frame: type prefix, then a y-protocols/sync message. */
const syncFrame = (write: (encoder: encoding.Encoder) => void): ArrayBuffer => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return frameBytes(encoder);
};

const awarenessFrame = (body: Uint8Array): ArrayBuffer => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, body);
  return frameBytes(encoder);
};

const queryAwarenessFrame = (): ArrayBuffer => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return frameBytes(encoder);
};

const bytesOf = (data: ArrayBuffer): Uint8Array => new Uint8Array(data);

/**
 * A decoder positioned where y-protocols/sync wants it: past the y-websocket
 * message type. This is what the room does before readSyncMessage.
 */
const syncBody = (payload: Uint8Array): decoding.Decoder => {
  const decoder = decoding.createDecoder(payload);
  expect(decoding.readVarUint(decoder)).toBe(MESSAGE_SYNC);
  return decoder;
};

const syncStep1 = (doc: Y.Doc): ArrayBuffer =>
  syncFrame((encoder) => {
    syncProtocol.writeSyncStep1(encoder, doc);
  });

describe('frame constants', () => {
  it('match the y-websocket framing', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});

describe('decodeMessage (TC-03)', () => {
  it('types a SyncStep1 frame and hands back the whole frame', () => {
    const doc = new Y.Doc();
    const frame = syncStep1(doc);
    const decoded: Decoded = decodeMessage(frame);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    // The payload is relayable/decodable as-is: the room can read the sync
    // message straight off it.
    expect(Array.from(decoded.payload)).toEqual(Array.from(bytesOf(frame)));
    const reply = encoding.createEncoder();
    expect(
      syncProtocol.readSyncMessage(
        syncBody(decoded.payload),
        reply,
        new Y.Doc(),
        'test',
      ),
    ).toBe(syncProtocol.messageYjsSyncStep1);
  });

  it('types a SyncStep2 frame', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 1);
    const frame = syncFrame((encoder) => {
      syncProtocol.writeSyncStep2(encoder, doc);
    });
    expect(decodeMessage(frame).kind).toBe('sync');
  });

  it('types a document update frame', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 1);
    const update = Y.encodeStateAsUpdate(doc);
    const frame = syncFrame((encoder) => {
      syncProtocol.writeUpdate(encoder, update);
    });
    const decoded = decodeMessage(frame);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    const receiver = new Y.Doc();
    // readSyncMessage applies the update without throwing.
    const reply = encoding.createEncoder();
    syncProtocol.readSyncMessage(syncBody(decoded.payload), reply, receiver, 'test');
    expect(receiver.getMap('objects').get('a')).toBe(1);
  });

  it('types an awareness frame and keeps its bytes verbatim', () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const frame = awarenessFrame(body);
    const decoded = decodeMessage(frame);
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') return;
    expect(Array.from(decoded.payload)).toEqual(Array.from(bytesOf(frame)));
  });

  it('types a query-awareness frame', () => {
    expect(decodeMessage(queryAwarenessFrame())).toEqual({
      kind: 'query-awareness',
    });
  });

  it('reports an unknown message type as invalid', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    encoding.writeVarUint8Array(encoder, new Uint8Array([7]));
    const decoded = decodeMessage(frameBytes(encoder));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind !== 'invalid') return;
    expect(decoded.reason).toContain('9');
  });

  it('reports a truncated frame as invalid', () => {
    const frame = syncStep1(new Y.Doc());
    // Drop the tail: the length prefix now promises more bytes than arrive.
    const truncated = bytesOf(frame).slice(0, bytesOf(frame).length - 1).buffer;
    const decoded = decodeMessage(truncated);
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind !== 'invalid') return;
    expect(decoded.reason.length).toBeGreaterThan(0);

    const awareness = awarenessFrame(new Uint8Array([1, 2, 3, 4, 5]));
    const cutAwareness = bytesOf(awareness).slice(0, 3).buffer;
    expect(decodeMessage(cutAwareness).kind).toBe('invalid');
  });

  it('reports an empty frame as invalid', () => {
    expect(decodeMessage(new Uint8Array([]).buffer).kind).toBe('invalid');
  });

  it('reports a text frame as invalid', () => {
    const decoded = decodeMessage('hello');
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind !== 'invalid') return;
    expect(decoded.reason.length).toBeGreaterThan(0);
  });
});
