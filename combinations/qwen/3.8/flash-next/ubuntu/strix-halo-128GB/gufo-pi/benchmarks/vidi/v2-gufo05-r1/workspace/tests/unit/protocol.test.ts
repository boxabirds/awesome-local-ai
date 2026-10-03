/**
 * TC-03 — decoding one WebSocket frame.
 *
 * The room acts on three kinds of frame and must treat everything else as
 * something to close the socket for. These tests build frames with the same
 * lib0 encoders the clients use, so the framing under test is the framing that
 * actually goes over the wire.
 */
import * as encoding from 'lib0/encoding';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import {
  decodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';

/** The frame bytes with the message type stripped off the front. */
function withoutType(bytes: Uint8Array): Uint8Array {
  return bytes.slice(1);
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/** SyncStep1: type, sync kind 0, the state vector. */
function syncFrame(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, 0);
  encoding.writeVarUint8Array(encoder, new Uint8Array([1, 2, 3]));
  return encoding.toUint8Array(encoder);
}

/** A Yjs update carried as a sync "update" message (kind 2), as `writeUpdate` frames it. */
function syncUpdateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, 2);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

function awarenessFrame(): Uint8Array {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalStateField('user', 'Sam');
  const update = encodeAwarenessUpdate(awareness, [awareness.clientID]);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  // y-websocket length-prefixes the awareness update, unlike the sync kinds.
  encoding.writeVarUint8Array(encoder, update);
  awareness.destroy();
  doc.destroy();
  return encoding.toUint8Array(encoder);
}

function queryFrame(withHint: boolean): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  if (withHint) encoding.writeVarString(encoder, 'awareness');
  return encoding.toUint8Array(encoder);
}

describe('decodeMessage (TC-03)', () => {
  it('types a sync frame and returns the bytes after the message type', () => {
    const bytes = syncFrame();
    const decoded = decodeMessage(bufferOf(bytes));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') expect(decoded.payload).toEqual(withoutType(bytes));
  });

  it('types a sync update frame', () => {
    const bytes = syncUpdateFrame(new Uint8Array([4, 5, 6]));
    expect(decodeMessage(bufferOf(bytes)).kind).toBe('sync');
  });

  it('types an awareness frame and returns the encoded update', () => {
    const bytes = awarenessFrame();
    const decoded = decodeMessage(bufferOf(bytes));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') expect(decoded.payload).toEqual(withoutType(bytes));
  });

  it('types a query-awareness frame, with and without a hint', () => {
    expect(decodeMessage(bufferOf(queryFrame(false)))).toEqual({ kind: 'query-awareness' });
    expect(decodeMessage(bufferOf(queryFrame(true)))).toEqual({ kind: 'query-awareness' });
  });

  it('reports an unknown message type as invalid', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    encoding.writeVarString(encoder, 'surprise');
    const decoded = decodeMessage(bufferOf(encoding.toUint8Array(encoder)));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') expect(decoded.reason).toContain('9');
  });

  it('reports an unknown sync kind as invalid', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, 7);
    encoding.writeVarUint8Array(encoder, new Uint8Array([1]));
    expect(decodeMessage(bufferOf(encoding.toUint8Array(encoder))).kind).toBe('invalid');
  });

  it('reports a sync frame truncated after its type as invalid', () => {
    const truncated = syncFrame().slice(0, 1);
    expect(decodeMessage(bufferOf(truncated)).kind).toBe('invalid');
  });

  it('reports a sync frame cut off inside its state vector as invalid', () => {
    const truncated = syncFrame().slice(0, 4); // promises 3 state-vector bytes, has 1
    expect(decodeMessage(bufferOf(truncated)).kind).toBe('invalid');
  });

  it('reports an awareness frame that promises a client it does not carry', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint(encoder, 2); // two clients follow, none do
    const bytes = encoding.toUint8Array(encoder);
    const decoded = decodeMessage(bufferOf(bytes));
    expect(decoded.kind).toBe('invalid');
  });

  it('reports an awareness frame truncated in the middle of a state as invalid', () => {
    const truncated = awarenessFrame().slice(0, -1);
    expect(decodeMessage(bufferOf(truncated)).kind).toBe('invalid');
  });

  it('reports an empty message as invalid', () => {
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  it('reports a text frame as invalid', () => {
    const decoded = decodeMessage('hello');
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') expect(decoded.reason).toContain('text');
  });
});
