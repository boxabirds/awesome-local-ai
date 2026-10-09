import { describe, expect, test } from 'vitest';
import { createEncoder, toUint8Array, writeUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding';
import * as Y from 'yjs';
import { Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness';
import { SYNC_STEP1, SYNC_STEP2, SYNC_UPDATE, decodeMessage } from '../../src/shared/protocol';
import {
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC
} from '../../src/shared/protocol';

// Frames are built with the same lib0 encoders the browser provider uses, so
// the decoder is tested against the real wire format.
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function frame(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function syncStep1Bytes(): Uint8Array {
  const enc = createEncoder();
  writeVarUint(enc, SYNC_STEP1);
  writeVarUint8Array(enc, new Uint8Array(0)); // empty state vector
  return toUint8Array(enc);
}

function awarenessBytes(): Uint8Array {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);
  awareness.setLocalStateField('heartbeat', 1);
  const body = encodeAwarenessUpdate(awareness, [awareness.clientID]);
  awareness.destroy();
  doc.destroy();
  return body;
}

describe('sync.room message decoding (TC-03)', () => {
  test('TC-03 a sync step1 frame decodes to kind sync with the body as payload', () => {
    const body = syncStep1Bytes();
    const message = frame(new Uint8Array([MESSAGE_SYNC]), body);
    const decoded = decodeMessage(toArrayBuffer(message));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') expect(equalBytes(decoded.payload, body)).toBe(true);
  });

  test('TC-03 a sync update frame decodes to kind sync', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 1);
    const update = Y.encodeStateAsUpdate(doc);
    const bodyEnc = createEncoder();
    writeVarUint(bodyEnc, SYNC_UPDATE);
    writeVarUint8Array(bodyEnc, update);
    const body = toUint8Array(bodyEnc);
    const decoded = decodeMessage(toArrayBuffer(frame(new Uint8Array([MESSAGE_SYNC]), body)));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') expect(equalBytes(decoded.payload, body)).toBe(true);
  });

  test('TC-03 a sync step2 frame decodes to kind sync', () => {
    const doc = new Y.Doc();
    const sv = Y.encodeStateVector(doc);
    const bodyEnc = createEncoder();
    writeVarUint(bodyEnc, SYNC_STEP2);
    writeVarUint8Array(bodyEnc, Y.encodeStateAsUpdate(doc, sv));
    const body = toUint8Array(bodyEnc);
    const decoded = decodeMessage(toArrayBuffer(frame(new Uint8Array([MESSAGE_SYNC]), body)));
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') expect(equalBytes(decoded.payload, body)).toBe(true);
  });

  test('TC-03 an awareness frame decodes to kind awareness with the update as payload', () => {
    const body = awarenessBytes();
    const decoded = decodeMessage(toArrayBuffer(frame(new Uint8Array([MESSAGE_AWARENESS]), body)));
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') expect(equalBytes(decoded.payload, body)).toBe(true);
  });

  test('TC-03 a query-awareness frame decodes to kind query-awareness', () => {
    const decoded = decodeMessage(toArrayBuffer(new Uint8Array([MESSAGE_QUERY_AWARENESS])));
    expect(decoded).toEqual({ kind: 'query-awareness' });
  });

  test('TC-03 an unknown message type is invalid', () => {
    const decoded = decodeMessage(toArrayBuffer(new Uint8Array([9, 1, 2, 3])));
    expect(decoded.kind).toBe('invalid');
  });

  test('TC-03 truncated frames are invalid', () => {
    // Frame with only the message type.
    expect(decodeMessage(toArrayBuffer(new Uint8Array([MESSAGE_SYNC]))).kind).toBe('invalid');
    // Sync step1 whose state vector declares five bytes but carries none.
    const enc = createEncoder();
    writeVarUint(enc, SYNC_STEP1);
    writeVarUint(enc, 5);
    expect(decodeMessage(toArrayBuffer(frame(new Uint8Array([MESSAGE_SYNC]), toUint8Array(enc))))).toEqual({
      kind: 'invalid',
      reason: expect.any(String)
    });
    // Sync update whose declared update length exceeds the frame.
    const updateEnc = createEncoder();
    writeVarUint(updateEnc, SYNC_UPDATE);
    writeVarUint(updateEnc, 100);
    writeUint8Array(updateEnc, new Uint8Array([1, 2, 3]));
    expect(decodeMessage(toArrayBuffer(frame(new Uint8Array([MESSAGE_SYNC]), toUint8Array(updateEnc))))).toEqual({
      kind: 'invalid',
      reason: expect.any(String)
    });
    // Awareness frame with only the message type.
    expect(decodeMessage(toArrayBuffer(new Uint8Array([MESSAGE_AWARENESS]))).kind).toBe('invalid');
    // Empty frame.
    expect(decodeMessage(toArrayBuffer(new Uint8Array([]))).kind).toBe('invalid');
  });

  test('TC-03 a text frame is invalid', () => {
    const decoded = decodeMessage('hello');
    expect(decoded.kind).toBe('invalid');
  });
});
