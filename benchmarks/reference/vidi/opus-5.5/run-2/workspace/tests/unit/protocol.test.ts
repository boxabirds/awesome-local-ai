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
} from '../../src/shared/protocol';
import { createSticky, getStickyText, LOCAL_ORIGIN } from '../../src/shared/board-model';

const UNKNOWN_TYPE = 9;

function frame(write: (e: encoding.Encoder) => void): ArrayBuffer {
  const e = encoding.createEncoder();
  write(e);
  const bytes = encoding.toUint8Array(e);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** A realistic update: typing into a sticky note. */
function textUpdate(): Uint8Array {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: 0, y: 0 });
  let update: Uint8Array = new Uint8Array();
  doc.on('update', (u: Uint8Array) => (update = u));
  doc.transact(() => getStickyText(doc, id)?.insert(0, 'Pricing'), LOCAL_ORIGIN);
  return update;
}

describe('decodeMessage (sync.room)', () => {
  it('TC-03 decodes a sync update frame', () => {
    const update = textUpdate();
    const data = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeUpdate(e, update);
    });
    const decoded = decodeMessage(data);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    const expected = frame((e) => syncProtocol.writeUpdate(e, update));
    expect([...decoded.payload]).toEqual([...new Uint8Array(expected)]);
  });

  it('TC-03 decodes a sync step 1 frame', () => {
    const doc = new Y.Doc();
    const data = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(e, doc);
    });
    expect(decodeMessage(data).kind).toBe('sync');
  });

  it('TC-03 decodes an awareness frame', () => {
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const update = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID]);
    awareness.destroy();
    const decoded = decodeMessage(
      frame((e) => {
        encoding.writeVarUint(e, MESSAGE_AWARENESS);
        encoding.writeVarUint8Array(e, update);
      }),
    );
    expect(decoded).toEqual({ kind: 'awareness', payload: update });
  });

  it('TC-03 decodes a query-awareness frame', () => {
    expect(decodeMessage(frame((e) => encoding.writeVarUint(e, MESSAGE_QUERY_AWARENESS)))).toEqual({
      kind: 'query-awareness',
    });
  });

  it('TC-03 rejects an unknown message type', () => {
    const decoded = decodeMessage(frame((e) => encoding.writeVarUint(e, UNKNOWN_TYPE)));
    expect(decoded.kind).toBe('invalid');
  });

  it('TC-03 rejects truncated sync and awareness frames', () => {
    const full = new Uint8Array(
      frame((e) => {
        encoding.writeVarUint(e, MESSAGE_SYNC);
        syncProtocol.writeUpdate(e, textUpdate());
      }),
    );
    const truncated = full.slice(0, full.length - 3);
    expect(decodeMessage(truncated.buffer).kind).toBe('invalid');
    const awareness = new Uint8Array([MESSAGE_AWARENESS, 40, 1, 2]);
    expect(decodeMessage(awareness.buffer).kind).toBe('invalid');
    expect(decodeMessage(new Uint8Array([0x80]).buffer).kind).toBe('invalid'); // unterminated varUint
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  it('TC-03 rejects a text frame', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });
});
