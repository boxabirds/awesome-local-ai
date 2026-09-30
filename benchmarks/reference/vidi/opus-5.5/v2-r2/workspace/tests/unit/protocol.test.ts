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

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync message and keeps the sync payload', () => {
    const doc = new Y.Doc();
    doc.getText('t').insert(0, 'hello');
    const bytes = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc));
    });
    const decoded = decodeMessage(toArrayBuffer(bytes));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    expect(Array.from(decoded.payload)).toEqual(Array.from(bytes.subarray(1)));
  });

  it('decodes an awareness message into its body bytes', () => {
    const body = new Uint8Array([1, 2, 3, 4]);
    const bytes = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(e, body);
    });
    expect(decodeMessage(toArrayBuffer(bytes))).toEqual({ kind: 'awareness', payload: body });
  });

  it('decodes a query-awareness message', () => {
    const bytes = frame((e) => encoding.writeVarUint(e, MESSAGE_QUERY_AWARENESS));
    expect(decodeMessage(toArrayBuffer(bytes))).toEqual({ kind: 'query-awareness' });
  });

  it('accepts typed-array views as well as ArrayBuffers', () => {
    const bytes = frame((e) => encoding.writeVarUint(e, MESSAGE_QUERY_AWARENESS));
    expect(decodeMessage(bytes)).toEqual({ kind: 'query-awareness' });
  });

  it('rejects an unknown message type', () => {
    const bytes = frame((e) => encoding.writeVarUint(e, 9));
    expect(decodeMessage(toArrayBuffer(bytes)).kind).toBe('invalid');
  });

  it.each([
    ['empty frame', new Uint8Array([])],
    ['sync frame with no body', new Uint8Array([MESSAGE_SYNC])],
    ['sync update claiming more bytes than present', new Uint8Array([MESSAGE_SYNC, 2, 50, 1, 2])],
    ['awareness claiming more bytes than present', new Uint8Array([MESSAGE_AWARENESS, 10, 1])],
    ['unterminated varint', new Uint8Array([0x80])],
  ])('rejects truncated bytes: %s', (_label, bytes) => {
    expect(decodeMessage(toArrayBuffer(bytes)).kind).toBe('invalid');
  });

  it('rejects a text frame', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });
});
