import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import * as sync from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  decodeMessage,
} from '../../src/shared/protocol';

/** Build a real y-websocket sync frame: [0: varuint][raw sync message]. */
function syncFrame(doc: Y.Doc): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  sync.writeSyncStep1(encoder, doc);
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

/** Build a real awareness frame: [1: varuint][clientID: varuint][state: varuint8array]. */
function awarenessFrame(clientId: number, state: Uint8Array): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint(encoder, clientId);
  encoding.writeVarUint8Array(encoder, state);
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

function freshDoc(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap('objects'); // touch the doc so its state vector is well-formed
  return doc;
}

describe('TC-03: decodeMessage', () => {
  it('decodes a sync frame to a typed sync result', () => {
    const result = decodeMessage(syncFrame(freshDoc()));
    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      // [step1: varuint][state vector: varuint8array]
      expect(result.payload[0]).toBe(0);
      expect(result.payload.length).toBeGreaterThan(1);
    }
  });

  it('decodes an awareness frame to a typed awareness result', () => {
    const state = new Uint8Array([9, 8, 7]);
    const result = decodeMessage(awarenessFrame(42, state));
    expect(result.kind).toBe('awareness');
    if (result.kind === 'awareness') {
      // clientID (42 → one varuint byte) + state bytes
      expect(Array.from(result.payload)).toEqual([42, 3, 9, 8, 7]);
    }
  });

  it('decodes a query-awareness frame (no payload)', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
    const frame = encoding.toUint8Array(encoder).buffer as ArrayBuffer;
    expect(decodeMessage(frame)).toEqual({ kind: 'query-awareness' });
  });

  it('returns invalid for an unknown type (9)', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    const frame = encoding.toUint8Array(encoder).buffer as ArrayBuffer;
    const result = decodeMessage(frame);
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toBeTruthy();
    }
  });

  it('returns invalid for truncated bytes', () => {
    const full = new Uint8Array(syncFrame(freshDoc()));
    const truncated = full.slice(0, full.length - 1);
    const result = decodeMessage(truncated.buffer as ArrayBuffer);
    expect(result.kind).toBe('invalid');
  });

  it('returns invalid for a string frame', () => {
    const result = decodeMessage('not binary');
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') {
      expect(result.reason).toBeTruthy();
    }
  });
});
