import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';
import { createSticky, initDoc } from '../../src/shared/board-model';

/**
 * TC-03 from the story 3 design: `decodeMessage` classifies the y-websocket
 * framing the browser provider and the BoardRoom speak.
 */

/** A y-websocket sync frame: the outer `MESSAGE_SYNC` byte plus a sync message. */
function syncFrame(write: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  write(encoder);
  return encoding.toUint8Array(encoder);
}

function syncStep1Frame(doc: Y.Doc): Uint8Array {
  return syncFrame((encoder) => syncProtocol.writeSyncStep1(encoder, doc));
}

/**
 * SyncStep2 with no state vector = "here is my whole document". Passing an
 * *empty* state vector instead is a caller error: `y-protocols` cannot decode a
 * zero-length one and throws.
 */
function syncStep2Frame(doc: Y.Doc): Uint8Array {
  return syncFrame((encoder) => syncProtocol.writeSyncStep2(encoder, doc));
}

function awarenessFrame(): Uint8Array {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalStateField('user', 'alex');
  const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

function queryAwarenessFrame(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  encoding.writeUint8(encoder, 1);
  return encoding.toUint8Array(encoder);
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

describe('protocol constants', () => {
  it('uses the y-websocket type numbers and close code', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});

describe('decodeMessage (TC-03)', () => {
  it('types a SyncStep1 frame and hands back its payload', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const frame = syncStep1Frame(doc);
    const decoded = decodeMessage(buffer(frame));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') {
      expect(Array.from(decoded.payload)).toEqual(Array.from(frame.subarray(1)));
    }
  });

  it('types a SyncStep2 frame', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 10, y: 20 });
    const frame = syncStep2Frame(doc);
    const decoded = decodeMessage(buffer(frame));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') {
      expect(decoded.payload.byteLength).toBe(frame.byteLength - 1);
    }
  });

  it('types an awareness frame so a relay reproduces the frame byte for byte', () => {
    const frame = awarenessFrame();
    const decoded = decodeMessage(buffer(frame));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') {
      expect(decoded.payload.byteLength).toBeGreaterThan(0);
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(encoder, decoded.payload);
      expect(Array.from(encoding.toUint8Array(encoder))).toEqual(Array.from(frame));
    }
  });

  it('reports a truncated or empty awareness frame as invalid', () => {
    const frame = awarenessFrame();
    const truncated = decodeMessage(buffer(frame.slice(0, frame.byteLength - 4)));
    expect(truncated.kind).toBe('invalid');

    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    expect(decodeMessage(buffer(encoding.toUint8Array(encoder))).kind).toBe('invalid');
  });

  it('types a query-awareness frame', () => {
    expect(decodeMessage(buffer(queryAwarenessFrame()))).toEqual({
      kind: 'query-awareness',
    });
  });

  it('reports an unknown message type as invalid', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    encoding.writeUint8Array(encoder, new Uint8Array([1, 2, 3]));
    const decoded = decodeMessage(buffer(encoding.toUint8Array(encoder)));
    expect(decoded.kind).toBe('invalid');
    expect((decoded as { reason: string }).reason).toContain('9');
  });

  it('reports a truncated sync frame as invalid', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 100, y: 0 });
    const frame = syncStep2Frame(doc);
    expect(frame.byteLength).toBeGreaterThan(4);
    const truncated = frame.slice(0, frame.byteLength - 2);
    expect(decodeMessage(buffer(truncated)).kind).toBe('invalid');
  });

  it('reports a frame with no payload as invalid', () => {
    expect(decodeMessage(buffer(new Uint8Array([MESSAGE_AWARENESS]))).kind).toBe('invalid');
    expect(decodeMessage(buffer(new Uint8Array([]))).kind).toBe('invalid');
  });

  it('reports a text frame as invalid', () => {
    const decoded = decodeMessage('hello');
    expect(decoded.kind).toBe('invalid');
    expect((decoded as { reason: string }).reason).toMatch(/text|binary/i);
  });
});
