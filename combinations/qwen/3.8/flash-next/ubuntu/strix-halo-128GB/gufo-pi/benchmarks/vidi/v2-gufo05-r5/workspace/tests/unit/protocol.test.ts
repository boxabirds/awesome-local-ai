/**
 * protocol unit tests (TC-03): y-websocket frame decoding.
 *
 * The room closes a socket that sends it something it cannot understand, so decoding must
 * classify every input - including hostile ones - without throwing. Frames here are built the
 * way a `y-websocket` client builds them: a sync frame is the frame type followed by the sync
 * message itself (no length prefix), an awareness frame is the frame type followed by the
 * update as a length-prefixed byte array.
 */
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import {
  bytesOf,
  decodeMessage,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  syncFrame,
  toFrameBytes,
} from '../../src/shared/protocol';

/** Copies a view into its own buffer, as the decode functions accept. */
function own(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

/** A sync frame: `varUint(0)` + the sync message, exactly as the provider frames it. */
function frameOf(message: Uint8Array): ArrayBuffer {
  return own(syncFrame(message));
}

/** An awareness frame: `varUint(1)` + `varUint8Array(update)`. */
function awarenessFrame(update: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return own(encoding.toUint8Array(encoder));
}

/** A few bytes of payload that stand in for an awareness body. */
function payloadOf(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe('decodeMessage (TC-03)', () => {
  test('decodes a SyncStep1 frame into the sync message it carries', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 1);
    const encoder = encoding.createEncoder();
    syncProtocol.writeSyncStep1(encoder, doc);
    const message = encoding.toUint8Array(encoder);

    const decoded = decodeMessage(frameOf(message));
    expect(decoded.kind).toBe('sync');
    // the payload is the whole sync message, own step byte included - that is what
    // `readSyncMessage` needs to be handed
    expect(decoded.kind === 'sync' ? Array.from(decoded.payload) : null).toEqual(
      Array.from(message),
    );
    expect(decoded.kind === 'sync' ? decoded.payload[0] : -1).toBe(
      syncProtocol.messageYjsSyncStep1,
    );
  });

  test('decodes a sync frame carrying a real Yjs update', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 1);
    const update = Y.encodeStateAsUpdate(doc);
    const encoder = encoding.createEncoder();
    syncProtocol.writeUpdate(encoder, update);

    const decoded = decodeMessage(frameOf(encoding.toUint8Array(encoder)));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') throw new Error('unreachable');
    // the payload is the sync message: its step byte, then the update. Applying the update
    // to a fresh doc reproduces the source.
    const inner = decoding.createDecoder(decoded.payload);
    expect(decoding.readVarUint(inner)).toBe(syncProtocol.messageYjsUpdate);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, decoding.readVarUint8Array(inner));
    expect(copy.getMap('objects').get('a')).toBe(1);
  });

  test('a sync frame with nothing after the type byte still decodes as a sync frame', () => {
    // an empty sync message is y-protocols' problem, not the framing's: the room hands it
    // over and closes that socket when it cannot be read
    const decoded = decodeMessage(frameOf(new Uint8Array([])));
    expect(decoded.kind).toBe('sync');
    expect(decoded.kind === 'sync' ? decoded.payload.length : -1).toBe(0);
  });

  test('decodes an awareness frame into its payload bytes', () => {
    const payload = payloadOf(0x01, 0x03, 0xaa, 0xbb, 0xcc);
    const decoded = decodeMessage(awarenessFrame(payload));
    expect(decoded.kind).toBe('awareness');
    expect(decoded.kind === 'awareness' ? Array.from(decoded.payload) : null).toEqual(
      Array.from(payload),
    );
  });

  test('decodes a query-awareness frame, which carries no payload', () => {
    expect(decodeMessage(own(new Uint8Array([MESSAGE_QUERY_AWARENESS])))).toEqual({
      kind: 'query-awareness',
    });
  });

  test('rejects an unknown message type (9)', () => {
    const decoded = decodeMessage(own(new Uint8Array([9, 0])));
    expect(decoded.kind).toBe('invalid');
    expect(decoded.kind === 'invalid' ? decoded.reason : '').not.toBe('');
  });

  test('rejects a truncated awareness frame and an empty frame (error paths)', () => {
    const full = new Uint8Array(awarenessFrame(payloadOf(1, 2, 3, 4, 5, 6)));
    // the length prefix promises more bytes than follow
    expect(decodeMessage(own(full.slice(0, full.length - 3))).kind).toBe('invalid');
    // a varUint continuation bit with nothing after it
    expect(decodeMessage(own(new Uint8Array([0x80]))).kind).toBe('invalid');
    // nothing at all
    expect(decodeMessage(own(new Uint8Array([]))).kind).toBe('invalid');
  });

  test('rejects a text frame (the protocol is binary only)', () => {
    const decoded = decodeMessage('hello');
    expect(decoded.kind).toBe('invalid');
    expect(decoded.kind === 'invalid' ? decoded.reason : '').not.toBe('');
  });

  test('never throws, whatever bytes arrive', () => {
    const hostile: ArrayBuffer[] = [
      own(new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])),
      own(new Uint8Array([MESSAGE_SYNC, 0x7f])),
      own(new Uint8Array([MESSAGE_SYNC])),
      own(new Uint8Array([MESSAGE_AWARENESS, 0x03, 0x00])),
      own(new Uint8Array(64).fill(0xff)),
    ];
    for (const bytes of hostile) {
      expect(() => decodeMessage(bytes)).not.toThrow();
      expect(['sync', 'awareness', 'query-awareness', 'invalid']).toContain(
        decodeMessage(bytes).kind,
      );
    }
  });

  test('decodes whatever shape a runtime delivered (TC-03)', async () => {
    const message = payloadOf(syncProtocol.messageYjsUpdate, 2, 7, 8);
    const bytes = syncFrame(message);

    // a view of a larger buffer, which is what a WebSocket often hands over
    const padded = new Uint8Array(bytes.length + 4).fill(0xff);
    padded.set(bytes, 2);
    const view = padded.subarray(2, 2 + bytes.length);
    expect(bytesOf(view).length).toBe(bytes.length);
    const fromView = decodeMessage(view);
    expect(fromView.kind).toBe('sync');
    expect(fromView.kind === 'sync' ? Array.from(fromView.payload) : null).toEqual(
      Array.from(message),
    );

    // workerd delivers binary WebSocket frames as a Blob, which has to be read first
    const blobSource = new Uint8Array(bytes.length);
    blobSource.set(bytes);
    const fromBlob = await toFrameBytes(new Blob([blobSource]));
    expect(Array.from(fromBlob as Uint8Array)).toEqual(Array.from(bytes));
    expect(decodeMessage(fromBlob as Uint8Array).kind).toBe('sync');

    // a text frame stays text, so the caller can reject it
    expect(await toFrameBytes('hello')).toBe('hello');
    expect(decodeMessage((await toFrameBytes('hello')) as string).kind).toBe('invalid');
  });
});
