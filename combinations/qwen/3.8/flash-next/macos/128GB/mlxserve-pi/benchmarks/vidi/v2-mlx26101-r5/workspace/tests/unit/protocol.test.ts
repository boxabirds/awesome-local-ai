/**
 * TC-03 (sync.room): `decodeMessage` types every frame the room can act on and
 * reports `invalid` — instead of throwing — for everything the room must reject.
 */

import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { readSyncMessage, writeSyncStep1, writeSyncStep2, writeUpdate } from 'y-protocols/sync';
import { describe, expect, it } from 'vitest';

import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  SYNC_STEP_1,
  SYNC_STEP_2,
  SYNC_UPDATE,
  decodeMessage,
  encodeAwarenessMessage,
  encodeQueryAwarenessMessage,
  encodeSyncMessage,
  encodeVarUint,
} from '../../src/shared/protocol';

/** A frame whose payload is cut short of the length its prefix declares. */
const truncated = (type: number, subType: number): Uint8Array => {
  const declared = encodeVarUint(subType);
  const length = encodeVarUint(200);
  const body = new Uint8Array(3); // far fewer than the 200 bytes promised
  return new Uint8Array([...encodeVarUint(type), ...declared, ...length, ...body]);
};

describe('decodeMessage', () => {
  it('types a SyncStep1 frame and keeps the sync sub-type in the payload', () => {
    const doc = new Y.Doc();
    const encoder = encoding.createEncoder();
    writeSyncStep1(encoder, doc);
    const frame = encodeSyncMessage(encoding.toUint8Array(encoder));
    expect(frame[0]).toBe(MESSAGE_SYNC);

    const decoded = decodeMessage(bufferOf(frame));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    // The payload is what `readSyncMessage` reads: sub-type first, no type byte.
    expect(decodeVarUintAt(decoded.payload, 0)).toBe(SYNC_STEP_1);
    expect(readSyncMessage(decoding.createDecoder(decoded.payload), encoding.createEncoder(), new Y.Doc(), null)).toBe(
      SYNC_STEP_1,
    );
  });

  it('types a SyncStep2 frame carrying a real document update', () => {
    const source = new Y.Doc();
    source.getMap('objects').set('a', 1);
    const encoder = encoding.createEncoder();
    writeSyncStep2(encoder, source);
    const frame = encodeSyncMessage(encoding.toUint8Array(encoder));

    const decoded = decodeMessage(bufferOf(frame));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    expect(decodeVarUintAt(decoded.payload, 0)).toBe(SYNC_STEP_2);

    // And the room can apply it: one update message, one applied change.
    const target = new Y.Doc();
    const reply = encoding.createEncoder();
    let applied: unknown = null;
    target.on('update', (update) => (applied = update));
    readSyncMessage(decoding.createDecoder(decoded.payload), reply, target, 'origin');
    expect(applied).not.toBeNull();
    expect(target.getMap('objects').get('a')).toBe(1);
  });

  it('types a single-update frame', () => {
    const source = new Y.Doc();
    source.getMap('objects').set('b', 2);
    const encoder = encoding.createEncoder();
    writeUpdate(encoder, Y.encodeStateAsUpdate(source));
    const decoded = decodeMessage(bufferOf(encodeSyncMessage(encoding.toUint8Array(encoder))));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    expect(decodeVarUintAt(decoded.payload, 0)).toBe(SYNC_UPDATE);
  });

  it('types an awareness frame and keeps its bytes verbatim', () => {
    const update = new Uint8Array([1, 5, 120, 1, 4, 115, 97, 109, 3]);
    const frame = encodeAwarenessMessage(update);
    expect(frame[0]).toBe(MESSAGE_AWARENESS);

    const decoded = decodeMessage(bufferOf(frame));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') return;
    expect(Array.from(decoded.payload)).toEqual(Array.from(update));
  });

  it('types a query-awareness frame', () => {
    const frame = encodeQueryAwarenessMessage();
    expect(frame[0]).toBe(MESSAGE_QUERY_AWARENESS);
    expect(decodeMessage(bufferOf(frame))).toEqual({ kind: 'query-awareness' });
  });

  // Error paths.
  it('reports an unknown message type as invalid', () => {
    const decoded = decodeMessage(new Uint8Array([9, 1, 2, 3]).buffer);
    expect(decoded.kind).toBe('invalid');
    expect(decoded.kind === 'invalid' ? decoded.reason : '').toMatch(/type/i);
  });

  it('reports truncated bytes as invalid', () => {
    for (const subType of [SYNC_STEP_1, SYNC_STEP_2, SYNC_UPDATE]) {
      const frame = truncated(MESSAGE_SYNC, subType);
      const decoded = decodeMessage(bufferOf(frame));
      expect(decoded.kind).toBe('invalid');
      expect(decoded.kind === 'invalid' ? decoded.reason : '').toMatch(/truncat/i);
    }
  });

  it('reports a frame that stops after the message type as invalid', () => {
    for (const type of [MESSAGE_SYNC, MESSAGE_AWARENESS]) {
      const decoded = decodeMessage(bufferOf(encodeVarUint(type)));
      expect(decoded.kind).toBe('invalid');
      expect(decoded.kind === 'invalid' ? decoded.reason : '').toMatch(/empty|truncat|incomplete/i);
    }
  });

  it('reports a text frame as invalid', () => {
    const decoded = decodeMessage('hello');
    expect(decoded.kind).toBe('invalid');
    expect(decoded.kind === 'invalid' ? decoded.reason : '').toMatch(/text/i);
  });

  it('reports an empty frame as invalid', () => {
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  it('exposes the close code used for undecodable frames', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});

/** A frame as the WebSocket delivers it: a fresh ArrayBuffer of exactly these bytes. */
function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.length);
  new Uint8Array(copy).set(bytes);
  return copy;
}

/** Reads the first varUint of a byte array. */
function decodeVarUintAt(bytes: Uint8Array, at: number): number {
  return decoding.readVarUint(decoding.createDecoder(bytes.subarray(at)));
}
