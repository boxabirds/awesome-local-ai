import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { writeSyncStep1, writeSyncStep2 } from 'y-protocols/sync';
import * as Y from 'yjs';

import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';

/**
 * TC-03 — sync.room: the y-websocket outer frame is a lib0 varUint message type
 * followed by the raw payload of the inner y-protocols message. Frames are built
 * with the same encoders the client provider uses.
 */

/** One wire message: frame type byte(s) + raw payload bytes. */
function frame(type: number, payload?: Uint8Array): ArrayBuffer {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  if (payload) encoding.writeUint8Array(enc, payload);
  const bytes = encoding.toUint8Array(enc);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** Inner y-protocols SyncStep1 payload for `doc`. */
function syncStep1Payload(doc: Y.Doc): Uint8Array {
  const enc = encoding.createEncoder();
  writeSyncStep1(enc, doc);
  return encoding.toUint8Array(enc);
}

/** Inner y-protocols SyncStep2 payload (the whole document) for `doc`. */
function syncStep2Payload(doc: Y.Doc): Uint8Array {
  const enc = encoding.createEncoder();
  writeSyncStep2(enc, doc);
  return encoding.toUint8Array(enc);
}

/** Inner y-protocols awareness payload for the given clients. */
function awarenessPayload(awareness: Awareness, clients: number[]): Uint8Array {
  return encodeAwarenessUpdate(awareness, clients);
}

describe('frame type constants', () => {
  it('matches the y-websocket protocol', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});

describe('decodeMessage — valid frames (TC-03)', () => {
  it('decodes a sync frame and keeps the payload bytes verbatim', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 1);
    for (const payload of [syncStep1Payload(doc), syncStep2Payload(doc)]) {
      const decoded = decodeMessage(frame(MESSAGE_SYNC, payload));
      expect(decoded.kind).toBe('sync');
      if (decoded.kind === 'sync') {
        expect(Array.from(decoded.payload)).toEqual(Array.from(payload));
      }
    }
  });

  it('decodes an awareness frame and keeps the payload bytes verbatim', () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField('user', 'alex');
    const payload = awarenessPayload(awareness, [doc.clientID]);
    const decoded = decodeMessage(frame(MESSAGE_AWARENESS, payload));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') {
      expect(Array.from(decoded.payload)).toEqual(Array.from(payload));
    }
    awareness.destroy();
  });

  it('decodes a query-awareness frame (no payload)', () => {
    expect(decodeMessage(frame(MESSAGE_QUERY_AWARENESS))).toEqual({
      kind: 'query-awareness',
    });
  });
});

describe('decodeMessage — invalid frames (TC-03 error paths)', () => {
  it('rejects an unknown frame type', () => {
    const decoded = decodeMessage(frame(9, new Uint8Array([1, 2, 3])));
    expect(decoded.kind).toBe('invalid');
    expect(decoded.kind === 'invalid' && decoded.reason.length).toBeGreaterThan(0);
  });

  it('rejects truncated bytes', () => {
    // A sync header with no inner message at all.
    expect(decodeMessage(frame(MESSAGE_SYNC)).kind).toBe('invalid');
    expect(decodeMessage(frame(MESSAGE_AWARENESS)).kind).toBe('invalid');
    // A varUint continuation byte with nothing following it.
    expect(decodeMessage(new Uint8Array([0x80]).buffer).kind).toBe('invalid');
    // Empty message.
    expect(decodeMessage(new Uint8Array(0).buffer).kind).toBe('invalid');
  });

  it('rejects a text frame', () => {
    const decoded = decodeMessage('hello');
    expect(decoded.kind).toBe('invalid');
    expect(decoded.kind === 'invalid' && decoded.reason.length).toBeGreaterThan(0);
  });
});
