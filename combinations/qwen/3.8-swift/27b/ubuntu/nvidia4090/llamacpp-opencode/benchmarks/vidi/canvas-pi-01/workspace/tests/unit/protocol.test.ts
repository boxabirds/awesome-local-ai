// sync.room — y-websocket frame decoding (TC-03).
//
// Frames are built with the same lib0 encoders the y-websocket provider uses.

import { describe, expect, it } from 'vitest';
import {
  createEncoder,
  toUint8Array,
  writeUint8Array,
  writeVarUint,
  writeVarUint8Array,
} from 'lib0/encoding';
import * as awareness from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  encodeFrameMessage,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../src/shared/protocol';

function syncFrame(payload: Uint8Array): ArrayBuffer {
  const encoder = createEncoder();
  writeVarUint(encoder, MESSAGE_SYNC);
  writeUint8Array(encoder, payload); // raw y-protocols payload, no length prefix
  return toUint8Array(encoder).buffer as ArrayBuffer;
}

function awarenessFrame(payload: Uint8Array): ArrayBuffer {
  const encoder = createEncoder();
  writeVarUint(encoder, MESSAGE_AWARENESS);
  writeVarUint8Array(encoder, payload); // varuint8-prefixed
  return toUint8Array(encoder).buffer as ArrayBuffer;
}

describe('TC-03 decodeMessage', () => {
  it('decodes a sync frame', () => {
    const doc = new Y.Doc();
    const payload = Y.encodeStateAsUpdate(doc);
    const decoded = decodeMessage(syncFrame(payload));
    expect(decoded).toEqual({ kind: 'sync', payload });
  });

  it('decodes an awareness frame', () => {
    const doc = new Y.Doc();
    const clientAwareness = new awareness.Awareness(doc);
    clientAwareness.setLocalState({ user: 'test' });
    const awarenessPayload = awareness.encodeAwarenessUpdate(clientAwareness, [doc.clientID]);
    const decoded = decodeMessage(awarenessFrame(awarenessPayload));
    expect(decoded).toEqual({ kind: 'awareness', payload: awarenessPayload });
  });

  it('decodes a query-awareness frame', () => {
    const encoder = createEncoder();
    writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
    const decoded = decodeMessage(toUint8Array(encoder).buffer as ArrayBuffer);
    expect(decoded).toEqual({ kind: 'query-awareness' });
  });

  it('rejects an unknown message type (9)', () => {
    const encoder = createEncoder();
    writeVarUint(encoder, 9);
    writeUint8Array(encoder, new Uint8Array([1, 2, 3]));
    const decoded = decodeMessage(toUint8Array(encoder).buffer as ArrayBuffer);
    expect(decoded).toMatchObject({ kind: 'invalid' });
  });

  it('rejects truncated bytes', () => {
    // awareness frame whose varuint8 length continues past the end of the frame
    const truncated = new Uint8Array([MESSAGE_AWARENESS, 0x93]);
    const decoded = decodeMessage(truncated.buffer as ArrayBuffer);
    expect(decoded).toMatchObject({ kind: 'invalid' });
    // sync frame with no payload at all
    const empty = new Uint8Array([MESSAGE_SYNC]);
    expect(decodeMessage(empty.buffer as ArrayBuffer)).toMatchObject({ kind: 'invalid' });
  });

  it('rejects a string frame', () => {
    const decoded = decodeMessage('not binary');
    expect(decoded).toMatchObject({ kind: 'invalid' });
  });

  it('uses the reserved close code for unsupported data', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });

  it('encodeFrameMessage round-trips through decodeMessage', () => {
    const doc = new Y.Doc();
    const syncPayload = Y.encodeStateAsUpdate(doc);
    expect(decodeMessage(encodeFrameMessage(MESSAGE_SYNC, syncPayload).buffer as ArrayBuffer)).toEqual({
      kind: 'sync',
      payload: syncPayload,
    });
    const awarenessPayload = new Uint8Array([0, 1, 2, 3]);
    expect(
      decodeMessage(
        encodeFrameMessage(MESSAGE_AWARENESS, awarenessPayload).buffer as ArrayBuffer,
      ),
    ).toEqual({ kind: 'awareness', payload: awarenessPayload });
  });
});
