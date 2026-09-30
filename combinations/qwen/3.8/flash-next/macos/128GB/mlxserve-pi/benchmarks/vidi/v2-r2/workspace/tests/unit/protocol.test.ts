// protocol unit tests (TC-03). Frames are built with the same lib0 / y-protocols
// encoders the client and the room use; decodeMessage must classify each and
// reject malformed ones.

import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as sync from 'y-protocols/sync';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';

/** The ArrayBuffer form of an encoder's buffer, as a WebSocket receives it. */
function bufferOf(encoder: encoding.Encoder): ArrayBuffer {
  return encoding.toUint8Array(encoder).buffer;
}

function syncStep1Frame(): ArrayBuffer {
  const doc = new Y.Doc();
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  sync.writeSyncStep1(enc, doc);
  return bufferOf(enc);
}

function awarenessFrame(): ArrayBuffer {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(enc, new Uint8Array([7, 1, 2, 3]));
  return bufferOf(enc);
}

function queryAwarenessFrame(): ArrayBuffer {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
  return bufferOf(enc);
}

/** A sync update frame whose declared payload is longer than the real bytes. */
function truncatedSyncUpdateFrame(): ArrayBuffer {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  encoding.writeVarUint(enc, sync.messageYjsUpdate); // 2
  encoding.writeVarUint(enc, 50); // claims 50 bytes of update follow
  encoding.writeUint8(enc, 1); // ...but only one is present
  return bufferOf(enc);
}

describe('TC-03 decodeMessage', () => {
  it('types a SyncStep1 (sync) frame with its full bytes', () => {
    const frame = syncStep1Frame();
    const decoded = decodeMessage(frame);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') {
      expect(decoded.payload).toBeInstanceOf(Uint8Array);
      expect(decoded.payload.byteLength).toBe(frame.byteLength);
    }
  });

  it('types an awareness frame with its full bytes', () => {
    const frame = awarenessFrame();
    const decoded = decodeMessage(frame);
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') {
      expect(new Uint8Array(decoded.payload).slice(-4)).toEqual(new Uint8Array([7, 1, 2, 3]));
    }
  });

  it('types a query-awareness frame', () => {
    expect(decodeMessage(queryAwarenessFrame()).kind).toBe('query-awareness');
  });

  it('rejects an unknown message type (9)', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 9);
    const decoded = decodeMessage(bufferOf(enc));
    expect(decoded.kind).toBe('invalid');
    expect(typeof (decoded as { reason: string }).reason).toBe('string');
  });

  it('rejects bytes truncated inside a sync update', () => {
    expect(decodeMessage(truncatedSyncUpdateFrame()).kind).toBe('invalid');
  });

  it('rejects a text frame', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });

  it('keeps the framing constants y-websocket expects', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
