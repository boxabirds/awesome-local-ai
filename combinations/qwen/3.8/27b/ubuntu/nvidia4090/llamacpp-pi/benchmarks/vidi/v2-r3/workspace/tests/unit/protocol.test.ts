import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { writeUpdate } from 'y-protocols/sync';
import { createSticky, initDoc } from '../../src/shared/board-model';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  encodeFrame,
} from '../../src/shared/protocol';

function frame(type: number, payload: Uint8Array): ArrayBuffer {
  return encodeFrame(type, payload).buffer as ArrayBuffer;
}

describe('protocol framing (y-websocket wire format)', () => {
  it('decodeMessage parses a sync frame (varuint type 0 + raw sync messages)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    const encoder = encoding.createEncoder();
    writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
    const payload = encoding.toUint8Array(encoder);

    const decoded = decodeMessage(frame(MESSAGE_SYNC, payload));
    if (decoded.kind !== 'sync') throw new Error(`expected sync, got ${decoded.kind}`);
    expect(new Uint8Array(decoded.payload)).toEqual(payload);
  });

  it('sync frames are raw (no length wrap), matching the y-websocket client byte-for-byte', () => {
    // y-websocket onopen frame for an empty doc: [0] + step1 [0, 1, 0]
    const raw = new Uint8Array([0, 0, 1, 0]);
    const decoded = decodeMessage(raw.buffer as ArrayBuffer);
    if (decoded.kind !== 'sync') throw new Error(`expected sync, got ${decoded.kind}`);
    expect(Array.from(new Uint8Array(decoded.payload))).toEqual([0, 1, 0]);
  });

  it('decodeMessage parses an awareness frame (type 1) with real awareness bytes', () => {
    const awareness = new Awareness(new Y.Doc());
    awareness.setLocalStateField('user', 'alex');
    const payload = encodeAwarenessUpdate(awareness, [awareness.clientID]);
    const decoded = decodeMessage(frame(MESSAGE_AWARENESS, payload));
    if (decoded.kind !== 'awareness') throw new Error(`expected awareness, got ${decoded.kind}`);
    expect(new Uint8Array(decoded.payload)).toEqual(payload);
  });

  it('decodeMessage parses a query-awareness frame (type 3, no payload)', () => {
    const decoded = decodeMessage(new Uint8Array([MESSAGE_QUERY_AWARENESS]).buffer as ArrayBuffer);
    if (decoded.kind !== 'query-awareness') throw new Error(`expected query, got ${decoded.kind}`);
    expect(decoded.payload.byteLength).toBe(0);
  });

  it('decodeMessage rejects invalid frames (unknown type, truncated, garbage)', () => {
    // unknown message type
    expect(decodeMessage(frame(9, new Uint8Array([1]))).kind).toBe('invalid');
    // truncated awareness frame: declared length exceeds the buffer
    expect(decodeMessage(new Uint8Array([1, 5, 2]).buffer as ArrayBuffer).kind).toBe('invalid');
    // garbage: varuint never terminates
    expect(decodeMessage(new Uint8Array([0xff, 0xff, 0xff]).buffer as ArrayBuffer).kind).toBe('invalid');
  });

  it('decodeMessage treats text frames (string data) as invalid', () => {
    const decoded = decodeMessage('hello');
    expect(decoded.kind).toBe('invalid');
  });

  it('CLOSE_UNSUPPORTED_DATA is 1003', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
