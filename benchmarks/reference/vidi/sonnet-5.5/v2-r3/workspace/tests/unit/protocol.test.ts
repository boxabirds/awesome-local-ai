import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC, decodeMessage } from '../../src/shared/protocol';

const buf = (u: Uint8Array): ArrayBuffer => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

function frame(type: number, body?: (e: encoding.Encoder) => void): ArrayBuffer {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, type);
  body?.(e);
  return buf(encoding.toUint8Array(e));
}

describe('decodeMessage (TC-03)', () => {
  it('types a sync frame', () => {
    const f = frame(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, new Y.Doc()));
    const r = decodeMessage(f);
    expect(r.kind).toBe('sync');
    if (r.kind === 'sync') expect(r.payload).toEqual(new Uint8Array(f));
  });
  it('types an awareness frame', () => {
    expect(decodeMessage(frame(MESSAGE_AWARENESS, (e) => encoding.writeVarUint8Array(e, new Uint8Array([1, 2])))).kind).toBe(
      'awareness',
    );
  });
  it('types a query-awareness frame', () => {
    expect(decodeMessage(frame(MESSAGE_QUERY_AWARENESS))).toEqual({ kind: 'query-awareness' });
  });
  it('rejects unknown type 9', () => {
    expect(decodeMessage(frame(9)).kind).toBe('invalid');
  });
  it('rejects truncated bytes (a dangling varint continuation)', () => {
    expect(decodeMessage(buf(new Uint8Array([0x80]))).kind).toBe('invalid');
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });
  it('rejects a string frame', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });
});
