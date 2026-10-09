import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';

function toArray(value: Uint8Array): number[] {
  return Array.from(value);
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function syncStep1Frame(): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  encoding.writeVarUint(enc, 0); // syncStep1
  encoding.writeVarUint8Array(enc, Y.encodeStateVector(new Y.Doc()));
  return encoding.toUint8Array(enc);
}

function updateFrame(): Uint8Array {
  const doc = new Y.Doc();
  doc.getMap('objects').set('x', 1);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  encoding.writeVarUint(enc, 2); // update
  encoding.writeVarUint8Array(enc, Y.encodeStateAsUpdate(doc));
  return encoding.toUint8Array(enc);
}

function awarenessFrame(): { frame: Uint8Array; update: Uint8Array } {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState({ cursor: { x: 1, y: 2 } });
  const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(enc, update);
  return { frame: encoding.toUint8Array(enc), update };
}

function queryAwarenessFrame(): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(enc);
}

// TC-03: decodeMessage — typed results for known frames, `invalid` for
// unknown type, truncated bytes and text (string) frames.
describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame into kind sync with the sync content as payload', () => {
    for (const frame of [syncStep1Frame(), updateFrame()]) {
      const res = decodeMessage(asArrayBuffer(frame));
      expect(res.kind).toBe('sync');
      if (res.kind === 'sync') {
        // payload = everything after the message-type byte
        expect(toArray(res.payload)).toEqual(toArray(frame.subarray(1)));
      }
    }
  });

  it('decodes an awareness frame into kind awareness', () => {
    const { frame, update } = awarenessFrame();
    const res = decodeMessage(asArrayBuffer(frame));
    expect(res.kind).toBe('awareness');
    if (res.kind === 'awareness') {
      // payload still carries the varuint length prefix (forwarded verbatim)
      const enc = encoding.createEncoder();
      encoding.writeVarUint8Array(enc, update);
      expect(toArray(res.payload)).toEqual(toArray(encoding.toUint8Array(enc)));
    }
  });

  it('decodes a query-awareness frame', () => {
    const frame = queryAwarenessFrame();
    const res = decodeMessage(asArrayBuffer(frame));
    expect(res).toEqual({ kind: 'query-awareness' });
  });

  it('rejects an unknown message type 9', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 9);
    encoding.writeVarUint8Array(enc, new Uint8Array([1, 2, 3]));
    const frame = encoding.toUint8Array(enc);
    const res = decodeMessage(asArrayBuffer(frame));
    expect(res.kind).toBe('invalid');
  });

  it('rejects truncated sync and awareness frames', () => {
    // sync frame announcing more payload bytes than present
    const truncSync = encoding.createEncoder();
    encoding.writeVarUint(truncSync, MESSAGE_SYNC);
    encoding.writeVarUint(truncSync, 2); // update
    encoding.writeVarUint(truncSync, 50); // claims 50 bytes...
    encoding.writeUint8Array(truncSync, new Uint8Array([1, 2, 3])); // ...only 3 follow
    const frame1 = encoding.toUint8Array(truncSync);
    expect(
      decodeMessage(asArrayBuffer(frame1)).kind,
    ).toBe('invalid');

    // awareness frame truncated in the middle of the length prefix
    const truncAware = encoding.createEncoder();
    encoding.writeVarUint(truncAware, MESSAGE_AWARENESS);
    encoding.writeVarUint(truncAware, 40);
    const frame2 = encoding.toUint8Array(truncAware);
    expect(
      decodeMessage(asArrayBuffer(frame2)).kind,
    ).toBe('invalid');

    // a single type byte with nothing behind it
    expect(decodeMessage(new Uint8Array([MESSAGE_SYNC]).buffer).kind).toBe('invalid');
    // an empty frame
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  it('rejects string (text) frames', () => {
    const res = decodeMessage('hello');
    expect(res.kind).toBe('invalid');
  });

  it('exposes the y-websocket framing constants', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
