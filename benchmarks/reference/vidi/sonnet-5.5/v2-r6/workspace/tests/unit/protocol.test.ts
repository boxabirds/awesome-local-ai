import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC, decodeMessage,
} from '../../src/shared/protocol';

const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer;

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(enc, new Y.Doc());
    const d = decodeMessage(buf(encoding.toUint8Array(enc)));
    expect(d.kind).toBe('sync');
  });

  it('decodes an awareness frame', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, new Uint8Array([1, 2, 3]));
    expect(decodeMessage(buf(encoding.toUint8Array(enc))).kind).toBe('awareness');
  });

  it('decodes a query-awareness frame', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
    expect(decodeMessage(buf(encoding.toUint8Array(enc)))).toEqual({ kind: 'query-awareness' });
  });

  it('rejects unknown type, truncated bytes, empty and string frames', () => {
    expect(decodeMessage(buf(new Uint8Array([9, 1, 2]))).kind).toBe('invalid');
    expect(decodeMessage(buf(new Uint8Array([MESSAGE_SYNC]))).kind).toBe('invalid');
    expect(decodeMessage(buf(new Uint8Array([MESSAGE_AWARENESS, 200, 1]))).kind).toBe('invalid');
    expect(decodeMessage(buf(new Uint8Array([0x80]))).kind).toBe('invalid');
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
    expect(decodeMessage('hello').kind).toBe('invalid');
  });
});
