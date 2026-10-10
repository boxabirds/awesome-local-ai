/**
 * TC-03 — message decoding (sync.room).
 *
 * The frames are built with the same lib0/y-protocols encoders the browser
 * provider uses, so the decoder is checked against the real framing instead of
 * hand-written bytes. Every error path of the room's contract (text frame,
 * truncated bytes, unknown type) is decoded here as `{ kind: 'invalid' }`.
 */
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';

import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';

/** The bytes an encoder produced, as a standalone ArrayBuffer. */
function frameOf(encoder: encoding.Encoder): ArrayBuffer {
  const bytes = encoding.toUint8Array(encoder);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/** Just the body of a frame: the type varUint is added by the caller. */
function frameOfBody(type: number, body: encoding.Encoder): ArrayBuffer {
  const frame = encoding.createEncoder();
  encoding.writeVarUint(frame, type);
  encoding.writeUint8Array(frame, encoding.toUint8Array(body));
  return frameOf(frame);
}

function bytesOf(value: Uint8Array): number[] {
  return Array.from(value);
}

const doc = new Y.Doc();
const awareness = new awarenessProtocol.Awareness(doc);
awareness.setLocalStateField('hidden', true);

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync step 1 frame', () => {
    const body = encoding.createEncoder();
    syncProtocol.writeSyncStep1(body, doc);
    const decoded = decodeMessage(frameOfBody(MESSAGE_SYNC, body));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    // The body survives untouched: re-decoding it yields the sync step number.
    expect(bytesOf(decoded.payload)).toEqual(bytesOf(encoding.toUint8Array(body)));
    expect(decoding.readVarUint(decoding.createDecoder(decoded.payload))).toBe(
      syncProtocol.messageYjsSyncStep1,
    );
  });

  it('decodes a document update frame', () => {
    doc.getMap('objects').set('seed', new Y.Map());
    const update = Y.encodeStateAsUpdate(doc);
    const body = encoding.createEncoder();
    syncProtocol.writeUpdate(body, update);
    const decoded = decodeMessage(frameOfBody(MESSAGE_SYNC, body));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    const inner = decoding.createDecoder(decoded.payload);
    expect(decoding.readVarUint(inner)).toBe(syncProtocol.messageYjsUpdate);
    expect(bytesOf(decoding.readVarUint8Array(inner))).toEqual(bytesOf(update));
  });

  it('decodes an awareness frame', () => {
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);
    const body = encoding.createEncoder();
    encoding.writeVarUint8Array(body, update);
    const decoded = decodeMessage(frameOfBody(MESSAGE_AWARENESS, body));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') return;
    expect(bytesOf(decoding.readVarUint8Array(decoding.createDecoder(decoded.payload)))).toEqual(
      bytesOf(update),
    );
  });

  it('decodes a query-awareness frame, which has no body', () => {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, MESSAGE_QUERY_AWARENESS);
    expect(decodeMessage(frameOf(frame))).toEqual({ kind: 'query-awareness' });
  });

  it('reports an unknown message type as invalid', () => {
    const frame = encoding.createEncoder();
    encoding.writeVarUint(frame, 9);
    encoding.writeUint8(frame, 1);
    const decoded = decodeMessage(frameOf(frame));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind !== 'invalid') return;
    expect(decoded.reason.length).toBeGreaterThan(0);
  });

  it('reports truncated bytes as invalid', () => {
    // A frame type with no body at all.
    const empty = encoding.createEncoder();
    encoding.writeVarUint(empty, MESSAGE_SYNC);
    expect(decodeMessage(frameOf(empty)).kind).toBe('invalid');

    // A varUint that announces more bytes than the frame contains.
    expect(decodeMessage(new Uint8Array([0x80]).buffer).kind).toBe('invalid');

    // A zero-length frame.
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  it('reports a text frame as invalid (binary frames only)', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });
});

describe('protocol constants', () => {
  it('matches the y-websocket framing and the close code', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
