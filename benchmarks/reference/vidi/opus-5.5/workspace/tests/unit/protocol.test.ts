import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';

const UNKNOWN_TYPE = 9;
const UNKNOWN_SYNC_TYPE = 7;

function frame(write: (e: encoding.Encoder) => void): ArrayBuffer {
  const e = encoding.createEncoder();
  write(e);
  const bytes = encoding.toUint8Array(e);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function docWithText(): Y.Doc {
  const doc = new Y.Doc();
  doc.getText('t').insert(0, 'green');
  return doc;
}

describe('TC-03 decodeMessage', () => {
  it('decodes SyncStep1 as sync with the sync message as payload', () => {
    const doc = docWithText();
    const data = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(e, doc);
    });
    const decoded = decodeMessage(data);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    expect(decoded.payload[0]).toBe(syncProtocol.messageYjsSyncStep1);
    expect(Array.from(decoded.payload)).toEqual(Array.from(new Uint8Array(data).subarray(1)));
  });

  it('decodes SyncStep2 and update frames as sync', () => {
    const doc = docWithText();
    const step2 = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeSyncStep2(e, doc);
    });
    const update = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeUpdate(e, Y.encodeStateAsUpdate(doc));
    });
    expect(decodeMessage(step2).kind).toBe('sync');
    expect(decodeMessage(update).kind).toBe('sync');
  });

  it('decodes awareness with the awareness update as payload', () => {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const inner = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);
    awareness.destroy();
    const decoded = decodeMessage(
      frame((e) => {
        encoding.writeVarUint(e, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(e, inner);
      }),
    );
    expect(decoded).toEqual({ kind: 'awareness', payload: inner });
  });

  it('decodes query-awareness', () => {
    expect(decodeMessage(frame((e) => encoding.writeVarUint(e, MESSAGE_QUERY_AWARENESS)))).toEqual({
      kind: 'query-awareness',
    });
  });

  it('returns invalid for unknown message type 9', () => {
    expect(decodeMessage(frame((e) => encoding.writeVarUint(e, UNKNOWN_TYPE))).kind).toBe('invalid');
  });

  it('returns invalid for an unknown sync sub-type', () => {
    const data = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      encoding.writeVarUint(e, UNKNOWN_SYNC_TYPE);
      encoding.writeVarUint8Array(e, new Uint8Array([1]));
    });
    expect(decodeMessage(data).kind).toBe('invalid');
  });

  it('returns invalid for truncated bytes', () => {
    const doc = docWithText();
    const whole = new Uint8Array(
      frame((e) => {
        encoding.writeVarUint(e, MESSAGE_SYNC);
        syncProtocol.writeSyncStep2(e, doc);
      }),
    );
    const truncated = whole.slice(0, whole.length - 2);
    expect(decodeMessage(truncated.buffer).kind).toBe('invalid');
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
    expect(decodeMessage(new Uint8Array([MESSAGE_SYNC]).buffer).kind).toBe('invalid');
    expect(decodeMessage(new Uint8Array([MESSAGE_AWARENESS]).buffer).kind).toBe('invalid');
  });

  it('returns invalid for a string frame', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });
});
