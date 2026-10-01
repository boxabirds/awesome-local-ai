import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import {
  MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC, decodeMessage,
} from '../../src/shared/protocol';

function frame(type: number, body?: Uint8Array): ArrayBuffer {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  if (body) encoding.writeVarUint8Array(enc, body);
  const bytes = encoding.toUint8Array(enc);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

describe('decodeMessage (TC-03)', () => {
  it('decodes sync, awareness and query-awareness frames', () => {
    expect(decodeMessage(frame(MESSAGE_SYNC, new Uint8Array([1, 2]))).kind).toBe('sync');
    expect(decodeMessage(frame(MESSAGE_AWARENESS, new Uint8Array([1]))).kind).toBe('awareness');
    expect(decodeMessage(frame(MESSAGE_QUERY_AWARENESS)).kind).toBe('query-awareness');
  });

  it('keeps the whole frame as the payload', () => {
    const f = frame(MESSAGE_AWARENESS, new Uint8Array([7, 8, 9]));
    const d = decodeMessage(f);
    expect(d.kind === 'awareness' && Array.from(d.payload)).toEqual(Array.from(new Uint8Array(f)));
  });

  it('rejects unknown type, truncated and text frames', () => {
    expect(decodeMessage(frame(9)).kind).toBe('invalid');
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
    expect(decodeMessage(frame(MESSAGE_SYNC)).kind).toBe('invalid');
    expect(decodeMessage(new Uint8Array([0x80]).buffer).kind).toBe('invalid');
    expect(decodeMessage('hello').kind).toBe('invalid');
  });
});
