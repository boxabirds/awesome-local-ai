import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import {
  decodeMessage,
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
} from '../../src/shared/protocol.ts';

function syncFrame(doc: Y.Doc): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  syncProtocol.writeSyncStep1(enc, doc);
  return encoding.toUint8Array(enc);
}

function awarenessFrame(payload: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(enc, payload);
  return encoding.toUint8Array(enc);
}

// TC-03: message decoding — typed results for known types, invalid for the rest.
describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame as { kind: "sync" }', () => {
    const doc = new Y.Doc();
    const res = decodeMessage(syncFrame(doc).buffer as ArrayBuffer);
    expect(res.kind).toBe('sync');
    if (res.kind === 'sync') {
      // The sync sub-message (sub-type varint + varuint8array) is the payload.
      expect(res.payload.length).toBeGreaterThan(0);
      expect(res.payload[0]).toBe(syncProtocol.messageYjsSyncStep1);
    }
  });

  it('decodes an awareness frame and returns the inner bytes verbatim', () => {
    const payload = new Uint8Array([9, 1, 2, 3, 200]);
    const res = decodeMessage(awarenessFrame(payload).buffer as ArrayBuffer);
    expect(res.kind).toBe('awareness');
    if (res.kind === 'awareness') {
      expect(Array.from(res.payload)).toEqual(Array.from(payload));
    }
  });

  it('decodes a query-awareness frame as { kind: "query-awareness" }', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
    const res = decodeMessage(encoding.toUint8Array(enc).buffer);
    expect(res).toEqual({ kind: 'query-awareness' });
  });

  it('rejects an unknown message type (9)', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 9);
    encoding.writeVarUint8Array(enc, new Uint8Array([1, 2, 3]));
    const res = decodeMessage(encoding.toUint8Array(enc).buffer);
    expect(res.kind).toBe('invalid');
  });

  it('rejects a truncated varuint message type', () => {
    // 0x80 is a continuation byte with no following byte.
    const res = decodeMessage(new Uint8Array([0x80]).buffer);
    expect(res.kind).toBe('invalid');
  });

  it('rejects a truncated awareness body (length exceeds available bytes)', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint(enc, 100); // claims 100 bytes...
    encoding.writeUint8(enc, 1); // ...only one present
    const res = decodeMessage(encoding.toUint8Array(enc).buffer);
    expect(res.kind).toBe('invalid');
  });

  it('rejects an empty sync body', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    const res = decodeMessage(encoding.toUint8Array(enc).buffer);
    expect(res.kind).toBe('invalid');
  });

  it('rejects a text (string) frame', () => {
    const res = decodeMessage('hello');
    expect(res.kind).toBe('invalid');
    if (res.kind === 'invalid') expect(res.reason).toMatch(/text/i);
  });
});
