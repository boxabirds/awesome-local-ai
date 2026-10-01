import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import {
  MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC, decodeMessage,
} from '../../src/shared/protocol';

function frame(type: number, body: number[] = []): ArrayBuffer {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, type);
  for (const b of body) encoding.writeUint8(e, b);
  const bytes = encoding.toUint8Array(e);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('decodeMessage (TC-03)', () => {
  it('decodes sync frames', () => {
    const r = decodeMessage(frame(MESSAGE_SYNC, [1, 2, 3]));
    expect(r.kind).toBe('sync');
    if (r.kind === 'sync') expect([...r.payload]).toEqual([1, 2, 3]);
  });
  it('decodes awareness frames', () => {
    const r = decodeMessage(frame(MESSAGE_AWARENESS, [9]));
    expect(r.kind).toBe('awareness');
    if (r.kind === 'awareness') expect([...r.payload]).toEqual([9]);
  });
  it('decodes query-awareness frames', () => {
    expect(decodeMessage(frame(MESSAGE_QUERY_AWARENESS))).toEqual({ kind: 'query-awareness' });
  });
  it('rejects unknown types', () => {
    expect(decodeMessage(frame(9)).kind).toBe('invalid');
  });
  it('rejects truncated and empty bytes', () => {
    expect(decodeMessage(new Uint8Array([0x80]).buffer).kind).toBe('invalid');
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });
  it('rejects string frames', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });
});
