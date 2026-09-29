import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
} from '@shared/protocol';

function syncFrame(syncType: number, payload: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  encoding.writeVarUint(enc, syncType);
  encoding.writeVarUint8Array(enc, payload);
  return encoding.toUint8Array(enc);
}

function awarenessFrame(payload: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(enc, payload);
  return encoding.toUint8Array(enc);
}

describe('protocol decodeMessage (TC-03)', () => {
  const doc = new Y.Doc();

  it('decodes a SyncStep1 frame', () => {
    const frame = syncFrame(0, Y.encodeStateVector(doc));
    const decoded = decodeMessage(frame);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') {
      expect(decoded.payload).toBeInstanceOf(Uint8Array);
      // first varUint of the payload is the sync type
      expect(decoded.payload[0]).toBe(0);
    }
  });

  it('decodes an Update frame', () => {
    const frame = syncFrame(2, Y.encodeStateAsUpdate(doc));
    expect(decodeMessage(frame).kind).toBe('sync');
  });

  it('decodes an awareness frame and preserves the payload', () => {
    const payload = new Uint8Array([7, 1, 2, 3, 9]);
    const frame = awarenessFrame(payload);
    const decoded = decodeMessage(frame);
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') {
      expect(Array.from(decoded.payload)).toEqual(Array.from(payload));
    }
  });

  it('decodes a query-awareness frame', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
    const decoded = decodeMessage(encoding.toUint8Array(enc));
    expect(decoded.kind).toBe('query-awareness');
  });

  it('rejects an unknown message type (9)', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 9);
    encoding.writeVarUint8Array(enc, new Uint8Array([1, 2, 3]));
    const decoded = decodeMessage(encoding.toUint8Array(enc));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') expect(decoded.reason).toMatch(/unknown message type 9/);
  });

  it('rejects an unknown sync sub-type', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    encoding.writeVarUint(enc, 7); // not 0/1/2
    encoding.writeVarUint8Array(enc, new Uint8Array([1]));
    expect(decodeMessage(encoding.toUint8Array(enc)).kind).toBe('invalid');
  });

  it('rejects truncated awareness bytes (length longer than buffer)', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint(enc, 10); // claims 10 bytes...
    const partial = encoding.toUint8Array(enc);
    const truncated = new Uint8Array([...partial, 1, 2]); // ...but only 2 follow
    expect(decodeMessage(truncated).kind).toBe('invalid');
  });

  it('rejects truncated sync bytes', () => {
    const frame = syncFrame(1, new Uint8Array([5, 6, 7]));
    const truncated = frame.subarray(0, frame.length - 2);
    expect(decodeMessage(truncated).kind).toBe('invalid');
  });

  it('rejects a text (string) frame', () => {
    const decoded = decodeMessage('hello world');
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') expect(decoded.reason).toMatch(/text frames/);
  });

  it('rejects an empty buffer', () => {
    expect(decodeMessage(new Uint8Array([])).kind).toBe('invalid');
  });
});
