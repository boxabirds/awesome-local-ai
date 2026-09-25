import { describe, expect, it } from 'vitest';
import { createEncoder, toUint8Array, writeVarUint8Array } from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  type Decoded,
} from '@/shared/protocol';

/** Builds a y-websocket frame: [type: varUint][raw bytes]. */
function frameRaw(type: number, raw: Uint8Array = new Uint8Array(0)): ArrayBuffer {
  const bytes = new Uint8Array(1 + raw.length);
  bytes[0] = type; // small types fit in one varUint byte
  bytes.set(raw, 1);
  return bytes.buffer;
}

/** Builds a sync frame: [0][inner yjs sync message]. */
function syncFrame(inner: Uint8Array): ArrayBuffer {
  return frameRaw(MESSAGE_SYNC, inner);
}

function syncPayload(inner: Uint8Array): Uint8Array {
  // Inner yjs sync message, e.g. an UPDATE wrapping a real update.
  const innerEncoder = createEncoder();
  syncProtocol.writeUpdate(innerEncoder, inner);
  return toUint8Array(innerEncoder);
}

function awarenessPayload(): Uint8Array {
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  awareness.setLocalState({ x: 1 });
  // Only clients with a meta entry (i.e. the local client) can be encoded.
  return awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]);
}

describe('protocol: decodeMessage', () => {
  describe('TC-03: known frame types decode to typed results', () => {
    it('decodes a sync frame carrying a real Yjs update', () => {
      const doc = new Y.Doc();
      const text = doc.getText('t');
      doc.transact(() => text.insert(0, 'hi'));
      const update = Y.encodeStateAsUpdate(doc);

      const decoded = decodeMessage(syncFrame(syncPayload(update)));
      expect(decoded).toMatchObject({ kind: 'sync' });
      if (decoded.kind !== 'sync') throw new Error('unreachable');
      // The payload must be exactly the inner yjs sync message.
      expect(decoded.payload).toEqual(syncPayload(update));
    });

    it('decodes an awareness frame verbatim', () => {
      // On the wire, the awareness payload is a length-prefixed
      // varUint8Array after the outer type (y-websocket framing).
      const update = awarenessPayload();
      const inner = createEncoder();
      writeVarUint8Array(inner, update);
      const onWire = toUint8Array(inner);

      const decoded = decodeMessage(frameRaw(MESSAGE_AWARENESS, onWire));
      expect(decoded).toMatchObject({ kind: 'awareness' });
      if (decoded.kind !== 'awareness') throw new Error('unreachable');
      expect(decoded.payload).toEqual(onWire);
    });

    it('decodes a query-awareness frame (no payload needed)', () => {
      const decoded = decodeMessage(frameRaw(MESSAGE_QUERY_AWARENESS));
      expect(decoded).toEqual({ kind: 'query-awareness' });
    });
  });

  describe('TC-03: error paths yield { kind: invalid }', () => {
    it('rejects a string (text) frame', () => {
      const decoded: Decoded = decodeMessage('hello');
      expect(decoded.kind).toBe('invalid');
    });

    it('rejects an empty frame', () => {
      const decoded = decodeMessage(new ArrayBuffer(0));
      expect(decoded.kind).toBe('invalid');
    });

    it('rejects an unknown outer type (9)', () => {
      const decoded = decodeMessage(frameRaw(9, new Uint8Array([1, 2, 3])));
      expect(decoded.kind).toBe('invalid');
    });

    it('rejects truncated payloads (sync and awareness with no body)', () => {
      expect(decodeMessage(frameRaw(MESSAGE_SYNC)).kind).toBe('invalid');
      expect(decodeMessage(frameRaw(MESSAGE_AWARENESS)).kind).toBe('invalid');
    });
  });

  describe('close code constant', () => {
    it('CLOSE_UNSUPPORTED_DATA is 1003', () => {
      expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
    });
  });
});
