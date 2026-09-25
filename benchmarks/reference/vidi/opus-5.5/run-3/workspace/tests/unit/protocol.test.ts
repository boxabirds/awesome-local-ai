import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  encodeAwareness,
  encodeQueryAwareness,
  encodeSync,
} from '../../src/shared/protocol';

function frame(write: (e: encoding.Encoder) => void): ArrayBuffer {
  const e = encoding.createEncoder();
  write(e);
  return encoding.toUint8Array(e).slice().buffer;
}

describe('TC-03 decodeMessage', () => {
  const doc = new Y.Doc();
  doc.getText('t').insert(0, 'green');

  it('decodes a sync frame into its sync message', () => {
    const data = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(e, doc);
    });
    const d = decodeMessage(data);
    expect(d.kind).toBe('sync');
    if (d.kind !== 'sync') return;
    const expected = encoding.createEncoder();
    syncProtocol.writeSyncStep1(expected, doc);
    expect([...d.payload]).toEqual([...encoding.toUint8Array(expected)]);
  });

  it('decodes an awareness frame into the awareness update', () => {
    const awareness = new awarenessProtocol.Awareness(doc);
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);
    const data = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(e, update);
    });
    const d = decodeMessage(data);
    expect(d).toEqual({ kind: 'awareness', payload: update });
    awareness.destroy();
  });

  it('decodes a query-awareness frame', () => {
    expect(decodeMessage(frame((e) => encoding.writeVarUint(e, MESSAGE_QUERY_AWARENESS)))).toEqual({
      kind: 'query-awareness',
    });
  });

  it('accepts Uint8Array frames and matches its own encoders', () => {
    expect(decodeMessage(encodeQueryAwareness()).kind).toBe('query-awareness');
    expect(decodeMessage(encodeAwareness(new Uint8Array([1, 2, 3])))).toEqual({
      kind: 'awareness',
      payload: new Uint8Array([1, 2, 3]),
    });
    expect(decodeMessage(encodeSync((e) => syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc)))).kind).toBe('sync');
  });

  it.each([
    ['unknown type 9', () => frame((e) => encoding.writeVarUint(e, 9))],
    [
      'a truncated sync frame',
      () =>
        frame((e) => {
          encoding.writeVarUint(e, MESSAGE_SYNC);
          syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc));
        }).slice(0, 6),
    ],
    [
      'a truncated awareness frame',
      () =>
        frame((e) => {
          encoding.writeVarUint(e, MESSAGE_AWARENESS);
          encoding.writeVarUint(e, 50);
          encoding.writeUint8(e, 1);
        }),
    ],
    ['a sync frame with no sync message', () => frame((e) => encoding.writeVarUint(e, MESSAGE_SYNC))],
    ['an unterminated varint', () => new Uint8Array([0x80]).buffer],
    ['an empty frame', () => new ArrayBuffer(0)],
    ['a text frame', () => 'hello'],
  ])('returns invalid for %s', (_label, make) => {
    const d = decodeMessage(make());
    expect(d.kind).toBe('invalid');
    if (d.kind === 'invalid') expect(d.reason).not.toBe('');
  });
});
