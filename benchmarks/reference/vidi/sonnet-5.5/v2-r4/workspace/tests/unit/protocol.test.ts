import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, MESSAGE_SYNC, decodeMessage } from '../../src/shared/protocol';

function frame(type: number, body?: (e: encoding.Encoder) => void): Uint8Array {
  const e = encoding.createEncoder();
  encoding.writeVarUint(e, type);
  body?.(e);
  return encoding.toUint8Array(e);
}

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame', () => {
    const bytes = frame(MESSAGE_SYNC, (e) => syncProtocol.writeSyncStep1(e, new Y.Doc()));
    const d = decodeMessage(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(d.kind).toBe('sync');
    if (d.kind === 'sync') expect(d.payload.length).toBe(bytes.length - 1);
  });
  it('decodes awareness and query-awareness frames', () => {
    const aw = frame(MESSAGE_AWARENESS, (e) => encoding.writeVarUint8Array(e, new Uint8Array([1, 2])));
    expect(decodeMessage(aw).kind).toBe('awareness');
    expect(decodeMessage(frame(MESSAGE_QUERY_AWARENESS)).kind).toBe('query-awareness');
  });
  it('flags unknown type, truncated bytes, empty and string frames as invalid', () => {
    expect(decodeMessage(frame(9)).kind).toBe('invalid');
    expect(decodeMessage(new Uint8Array([0x80]))).toMatchObject({ kind: 'invalid' });
    expect(decodeMessage(new Uint8Array([]))).toMatchObject({ kind: 'invalid' });
    expect(decodeMessage(frame(MESSAGE_SYNC)).kind).toBe('invalid');
    expect(decodeMessage('hello')).toMatchObject({ kind: 'invalid' });
  });
});
