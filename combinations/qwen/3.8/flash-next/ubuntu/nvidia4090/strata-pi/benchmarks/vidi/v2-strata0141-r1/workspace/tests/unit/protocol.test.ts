import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';

/**
 * TC-03 (anchor `sync.room`): the room's message decoder is pure, so the
 * malformed-traffic error paths are checked here before they are checked over
 * real WebSockets in the integration suite.
 *
 * Frames are built with the same lib0/y-protocols encoders the browser provider
 * uses, so a passing test means the room reads real provider traffic.
 *
 * Dimension classes: D1 = text insert, D2 = single writer, D3 = 1, D4 = steady
 * (and one run with D4 = malformed traffic).
 */

function frame(type: number, write?: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  write?.(encoder);
  return encoding.toUint8Array(encoder);
}

const bytes = (data: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy.buffer;
};

const SYNC_FRAME = frame(MESSAGE_SYNC, (encoder) => {
  syncProtocol.writeSyncStep1(encoder, new Y.Doc());
});

const AWARENESS_FRAME = (() => {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalStateField('board', 'live');
  return frame(MESSAGE_AWARENESS, (encoder) => {
    encoding.writeVarUint8Array(
      encoder,
      awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]),
    );
  });
})();

describe('protocol constants', () => {
  it('uses the y-websocket message type numbers', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});

describe('decodeMessage (TC-03)', () => {
  it('types a sync frame and returns the sub-message as payload', () => {
    const decoded = decodeMessage(bytes(SYNC_FRAME));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') {
      return;
    }
    // Everything after the type byte, i.e. what readSyncMessage consumes.
    expect(decoded.payload).toEqual(SYNC_FRAME.subarray(1));
    const decoder = decoded.payload;
    expect(decoder[0]).toBe(syncProtocol.messageYjsSyncStep1);
  });

  it('types an awareness frame and returns its update as payload', () => {
    const decoded = decodeMessage(bytes(AWARENESS_FRAME));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') {
      return;
    }
    expect(decoded.payload).toEqual(AWARENESS_FRAME.subarray(1));
  });

  it('types an awareness query, which carries no payload', () => {
    const decoded = decodeMessage(bytes(frame(MESSAGE_QUERY_AWARENESS)));
    expect(decoded.kind).toBe('query-awareness');
  });

  it('reports an unknown message type as invalid', () => {
    const decoded = decodeMessage(bytes(frame(9, (encoder) => encoding.writeUint8(encoder, 7))));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') {
      expect(decoded.reason).toContain('9');
    }
  });

  it('reports truncated bytes as invalid', () => {
    // A sync type with no sub-message at all.
    expect(decodeMessage(bytes(frame(MESSAGE_SYNC))).kind).toBe('invalid');
    // A varUint that promises a continuation byte that never arrives.
    expect(decodeMessage(bytes(new Uint8Array([0x80]))).kind).toBe('invalid');
    expect(decodeMessage(bytes(new Uint8Array([]))).kind).toBe('invalid');
    // A sync Update frame whose length prefix promises more bytes than exist.
    const truncated = frame(MESSAGE_SYNC, (encoder) => {
      encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
      encoding.writeVarUint(encoder, 128);
      encoding.writeUint8(encoder, 1);
    });
    const decoded = decodeMessage(bytes(truncated));
    expect(decoded.kind).toBe('invalid');
  });

  it('reports a text frame as invalid (the protocol is binary only)', () => {
    const decoded = decodeMessage('{"hello":true}');
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') {
      expect(decoded.reason.length).toBeGreaterThan(0);
    }
  });
});
