import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  encodeAwareness,
  encodeQueryAwareness,
  encodeSyncStep1,
  encodeUpdate,
  readSync,
} from '../../src/shared/protocol';

function frame(write: (e: encoding.Encoder) => void): Uint8Array {
  const e = encoding.createEncoder();
  write(e);
  return encoding.toUint8Array(e);
}

function docWithText(text: string): Y.Doc {
  const doc = new Y.Doc();
  doc.getText('t').insert(0, text);
  return doc;
}

describe('TC-03 decodeMessage', () => {
  it('decodes a sync step 1 frame built with lib0 encoders', () => {
    const doc = docWithText('hello');
    const bytes = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      syncProtocol.writeSyncStep1(e, doc);
    });
    const decoded = decodeMessage(bytes.slice().buffer);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    // The payload is the sync message (type + state vector) after the MESSAGE_SYNC byte.
    expect(decoded.payload).toEqual(bytes.subarray(1));
  });

  it('decodes a sync update frame', () => {
    const update = Y.encodeStateAsUpdate(docWithText('green'));
    const decoded = decodeMessage(encodeUpdate(update));
    expect(decoded.kind).toBe('sync');
  });

  it('decodes an awareness frame to its update bytes', () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const bytes = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_AWARENESS);
      encoding.writeVarUint8Array(e, payload);
    });
    expect(decodeMessage(bytes)).toEqual({ kind: 'awareness', payload });
    expect(encodeAwareness(payload)).toEqual(bytes);
  });

  it('decodes a query-awareness frame', () => {
    const bytes = frame((e) => encoding.writeVarUint(e, MESSAGE_QUERY_AWARENESS));
    expect(decodeMessage(bytes)).toEqual({ kind: 'query-awareness' });
    expect(encodeQueryAwareness()).toEqual(bytes);
  });

  it('rejects an unknown message type 9', () => {
    const bytes = frame((e) => {
      encoding.writeVarUint(e, 9);
      encoding.writeVarUint8Array(e, new Uint8Array([1]));
    });
    expect(decodeMessage(bytes).kind).toBe('invalid');
  });

  it('rejects an unknown sync sub-type', () => {
    const bytes = frame((e) => {
      encoding.writeVarUint(e, MESSAGE_SYNC);
      encoding.writeVarUint(e, 7);
      encoding.writeVarUint8Array(e, new Uint8Array([1]));
    });
    expect(decodeMessage(bytes).kind).toBe('invalid');
  });

  it('rejects truncated bytes', () => {
    const full = encodeUpdate(Y.encodeStateAsUpdate(docWithText('truncate me')));
    expect(decodeMessage(full.subarray(0, full.length - 3)).kind).toBe('invalid');
    expect(decodeMessage(new Uint8Array([MESSAGE_AWARENESS, 10, 1])).kind).toBe('invalid');
    expect(decodeMessage(new Uint8Array([])).kind).toBe('invalid');
  });

  it('rejects a string frame', () => {
    expect(decodeMessage('hello')).toEqual({ kind: 'invalid', reason: 'text frame' });
  });
});

describe('readSync', () => {
  it('answers sync step 1 with the missing updates and applies updates with the origin', () => {
    const server = docWithText('server');
    const client = new Y.Doc();
    const step1 = decodeMessage(encodeSyncStep1(client));
    if (step1.kind !== 'sync') throw new Error('expected sync');
    const reply = readSync(server, step1.payload, 'origin');
    expect(reply).not.toBeNull();
    const step2 = decodeMessage(reply!);
    if (step2.kind !== 'sync') throw new Error('expected sync');
    const origins: unknown[] = [];
    client.on('update', (_u: Uint8Array, origin: unknown) => origins.push(origin));
    expect(readSync(client, step2.payload, 'room')).toBeNull();
    expect(client.getText('t').toString()).toBe('server');
    expect(origins).toEqual(['room']);
  });

  it('throws when Yjs rejects the update', () => {
    const bytes = encodeUpdate(new Uint8Array([200, 200, 200, 200, 200]));
    const decoded = decodeMessage(bytes);
    if (decoded.kind !== 'sync') throw new Error('expected sync framing');
    expect(() => readSync(new Y.Doc(), decoded.payload, null)).toThrow();
  });
});
