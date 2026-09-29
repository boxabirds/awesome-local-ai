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
import { createSticky, deleteObject, getStickyText } from '../../src/shared/board-model';

/**
 * TC-03 (sync.room, unit half).
 *
 * `decodeMessage` is the room's only gate on incoming traffic, so the frames
 * here are built with the same lib0 encoders the real clients use - a fixture
 * written by hand would not prove that the room understands the wire.
 */

/** Frames on the wire are binary; the tests hand over the copied frame bytes. */
function frame(encoder: encoding.Encoder): Uint8Array {
  return encoding.toUint8Array(encoder).slice();
}

function syncStepOne(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return frame(encoder);
}

function updateFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, syncProtocol.messageYjsUpdate);
  encoding.writeVarUint8Array(encoder, update);
  return frame(encoder);
}

function awarenessFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return frame(encoder);
}

function queryAwarenessFrame(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return frame(encoder);
}

/** A document with one note in it, so that an update has something to carry. */
function seededDoc(): Y.Doc {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: 10, y: 20 });
  if (id) getStickyText(doc, id)?.insert(0, 'hello');
  return doc;
}

describe('decodeMessage: the frames a real client sends', () => {
  it('recognises sync step 1', () => {
    const doc = new Y.Doc();
    const decoded = decodeMessage(syncStepOne(doc));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    // The payload is the sync message with its sub-type byte kept: that is
    // what readSyncMessage is documented to take. A brand new document still
    // encodes a state vector, so the frame is "sub-type, length, bytes".
    const stateVector = Array.from(Y.encodeStateVector(doc));
    expect(Array.from(decoded.payload)).toEqual([0, stateVector.length, ...stateVector]);
  });

  it('recognises sync step 1 for a document that is not empty', () => {
    const doc = seededDoc();
    const stateVector = Array.from(Y.encodeStateVector(doc));
    const decoded = decodeMessage(syncStepOne(doc));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    expect(Array.from(decoded.payload)).toEqual([0, stateVector.length, ...stateVector]);
  });

  it('recognises a document update and hands over a payload Yjs can read', () => {
    const source = seededDoc();
    const update = Y.encodeStateAsUpdate(source);
    const decoded = decodeMessage(updateFrame(update));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;

    // The payload must be positioned exactly where y-protocols expects: one
    // decoder over it replays the whole update into another document.
    const target = new Y.Doc();
    const reply = encoding.createEncoder();
    const failures: Error[] = [];
    const messageType = syncProtocol.readSyncMessage(
      decoding.createDecoder(decoded.payload),
      reply,
      target,
      null,
      (error: Error) => failures.push(error),
    );
    expect(failures).toEqual([]);
    expect(messageType).toBe(syncProtocol.messageYjsUpdate);
    expect(target.getMap('objects').size).toBe(1);
  });

  it('recognises an awareness update', () => {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    awareness.setLocalState({ editor: true });
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);
    const decoded = decodeMessage(awarenessFrame(update));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') return;
    expect(Array.from(decoded.payload)).toEqual(Array.from(update));
  });

  it('recognises query-awareness, which the room ignores', () => {
    expect(decodeMessage(queryAwarenessFrame())).toEqual({ kind: 'query-awareness' });
  });
});

describe('decodeMessage: the frames the room must refuse', () => {
  const update = Y.encodeStateAsUpdate(seededDoc());

  it('refuses a text frame', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
    expect(decodeMessage('{"kind":"sync"}').kind).toBe('invalid');
  });

  it('refuses an empty frame', () => {
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
    expect(decodeMessage(new Uint8Array(0)).kind).toBe('invalid');
  });

  it('refuses truncated bytes', () => {
    const truncated = updateFrame(update);
    expect(decodeMessage(truncated.subarray(0, truncated.length - 2)).kind).toBe('invalid');
    // A sync update whose length prefix lies about how much follows it.
    expect(decodeMessage(new Uint8Array([MESSAGE_SYNC, 2, 40, 1, 2, 3])).kind).toBe('invalid');
    // A frame that stops in the middle of the message type.
    expect(decodeMessage(new Uint8Array([MESSAGE_SYNC])).kind).toBe('invalid');
    // A six-byte continuation with no terminating byte.
    expect(decodeMessage(new Uint8Array([0x80, 0x80, 0x80, 0x80, 0x80, 0x7f])).kind).toBe(
      'invalid',
    );
    // An awareness frame that declares nothing.
    expect(decodeMessage(new Uint8Array([MESSAGE_AWARENESS, 0])).kind).toBe('invalid');
  });

  it('refuses an unknown message type', () => {
    expect(decodeMessage(new Uint8Array([9, 0])).kind).toBe('invalid');
    expect(decodeMessage(new Uint8Array([9])).kind).toBe('invalid');
    // 250 is not a message type either, and needs a two-byte varUint.
    expect(decodeMessage(new Uint8Array([250, 1, 0, 0])).kind).toBe('invalid');
    // A known frame type wrapping an unknown sync sub-type.
    expect(decodeMessage(new Uint8Array([MESSAGE_SYNC, 7, 0])).kind).toBe('invalid');
  });

  it('refuses auth frames, which this story has no way to answer', () => {
    expect(decodeMessage(new Uint8Array([2, 0])).kind).toBe('invalid');
  });

  it('does not mistake a complete update for a truncated one', () => {
    // Guards the length check above: the same bytes, complete, are accepted.
    expect(decodeMessage(updateFrame(update)).kind).toBe('sync');
    expect(decodeMessage(syncStepOne(seededDoc())).kind).toBe('sync');
  });

  it('reports why a frame was refused', () => {
    const refused = decodeMessage('hello');
    expect(refused.kind).toBe('invalid');
    if (refused.kind !== 'invalid') return;
    expect(refused.reason.length).toBeGreaterThan(0);
  });

  it('keeps the close code the room answers with', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });

  it('is usable straight after a delete, which is not an empty update', () => {
    const doc = seededDoc();
    const id = [...doc.getMap('objects').keys()][0]!;
    expect(deleteObject(doc, id)).toBe(true);
    expect(decodeMessage(updateFrame(Y.encodeStateAsUpdate(doc))).kind).toBe('sync');
  });
});
