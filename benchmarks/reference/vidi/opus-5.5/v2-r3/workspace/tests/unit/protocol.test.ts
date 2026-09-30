import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';

function frame(write: (e: encoding.Encoder) => void): Uint8Array {
  const e = encoding.createEncoder();
  write(e);
  return encoding.toUint8Array(e);
}

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

describe('decodeMessage (TC-03)', () => {
  const doc = new Y.Doc();
  doc.getText('t').insert(0, 'green');

  it('decodes a sync frame (step 1, step 2, update)', () => {
    const step1 = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(e, doc);
    });
    const result = decodeMessage(buffer(step1));
    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') expect(Array.from(result.payload)).toEqual(Array.from(step1.subarray(1)));

    const update = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc));
    });
    expect(decodeMessage(buffer(update)).kind).toBe('sync');
  });

  it('decodes an awareness frame to its payload', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const bytes = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(e, payload);
    });
    expect(decodeMessage(buffer(bytes))).toEqual({ kind: 'awareness', payload });
  });

  it('decodes a query-awareness frame', () => {
    const bytes = frame((e) => encoding.writeVarUint(e, MESSAGE_QUERY_AWARENESS));
    expect(decodeMessage(buffer(bytes))).toEqual({ kind: 'query-awareness' });
  });

  it('rejects an unknown message type 9', () => {
    const bytes = frame((e) => {
      encoding.writeVarUint(e, 9);
      encoding.writeVarUint8Array(e, new Uint8Array([1]));
    });
    expect(decodeMessage(buffer(bytes)).kind).toBe('invalid');
  });

  it('rejects truncated bytes', () => {
    const full = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc));
    });
    expect(decodeMessage(buffer(full.subarray(0, full.length - 3))).kind).toBe('invalid');
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
    const awareness = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(e, new Uint8Array(10));
    });
    expect(decodeMessage(buffer(awareness.subarray(0, 5))).kind).toBe('invalid');
  });

  it('rejects a string frame', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });
});
