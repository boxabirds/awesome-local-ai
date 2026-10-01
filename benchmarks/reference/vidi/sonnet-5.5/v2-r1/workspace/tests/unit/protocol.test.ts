import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
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
    const d = decodeMessage(frame(MESSAGE_SYNC, [0, 1, 0]));
    expect(d.kind).toBe('sync');
    if (d.kind === 'sync') expect([...d.payload]).toEqual([0, 1, 0]);
  });

  it('decodes awareness frames', () => {
    const d = decodeMessage(frame(MESSAGE_AWARENESS, [1, 2]));
    expect(d.kind).toBe('awareness');
    if (d.kind === 'awareness') expect([...d.payload]).toEqual([1, 2]);
  });

  it('decodes query-awareness frames', () => {
    expect(decodeMessage(frame(MESSAGE_QUERY_AWARENESS)).kind).toBe('query-awareness');
  });

  it('reports unknown types as invalid', () => {
    expect(decodeMessage(frame(9, [1])).kind).toBe('invalid');
  });

  it('reports truncated and empty bytes as invalid', () => {
    expect(decodeMessage(new Uint8Array([0x80]).buffer).kind).toBe('invalid');
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
    expect(decodeMessage(frame(MESSAGE_SYNC)).kind).toBe('invalid');
  });

  it('reports string frames as invalid', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });
});
