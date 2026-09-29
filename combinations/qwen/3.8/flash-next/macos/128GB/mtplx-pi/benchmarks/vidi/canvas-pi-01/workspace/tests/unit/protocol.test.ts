import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  toArrayBuffer,
} from '../../src/shared/protocol';

/** Wrap a body with the leading message-type byte, as the provider does. */
function frame(type: number, body: (enc: encoding.Encoder) => void): ArrayBuffer {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  body(enc);
  return encoding.toUint8Array(enc).buffer as ArrayBuffer;
}

describe('decodeMessage — valid frames', () => {
  it('classifies a SyncStep1 (an empty state vector) as sync', () => {
    const doc = new Y.Doc();
    const buffer = frame(MESSAGE_SYNC, (enc) => {
      encoding.writeVarUint(enc, 0); // SyncStep1
      syncProtocol.writeSyncStep1(enc, doc);
    });
    const decoded = decodeMessage(buffer);
    expect(decoded.kind).toBe('sync');
    // The payload handed to `readSyncMessage` drops the message-type byte.
    if (decoded.kind === 'sync') {
      expect(decoded.payload.length).toBe(new Uint8Array(buffer).length - 1);
    }
  });

  it('classifies a document update as sync', () => {
    const update = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const buffer = frame(MESSAGE_SYNC, (enc) => {
      syncProtocol.writeUpdate(enc, update);
    });
    expect(decodeMessage(buffer).kind).toBe('sync');
  });

  it('classifies an awareness update as awareness and keeps it verbatim', () => {
    const payload = new Uint8Array([0x00, 0x01, 0xaa, 0xbb]);
    const buffer = frame(MESSAGE_AWARENESS, (enc) => {
      encoding.writeVarUint8Array(enc, payload);
    });
    const decoded = decodeMessage(buffer);
    expect(decoded.kind).toBe('awareness');
    // Awareness is relayed byte-for-byte, so the payload still includes the
    // message-type byte (it is the whole frame).
    if (decoded.kind === 'awareness') {
      expect(Array.from(decoded.payload)).toEqual(Array.from(new Uint8Array(buffer)));
    }
  });

  it('recognises a query-awareness frame (no payload to relay)', () => {
    const buffer = frame(MESSAGE_QUERY_AWARENESS, () => {});
    expect(decodeMessage(buffer).kind).toBe('query-awareness');
  });
});

describe('decodeMessage — invalid frames become a single 1003 (design §5)', () => {
  it('rejects a text frame', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
  });

  it('rejects an empty frame', () => {
    expect(decodeMessage(new Uint8Array(0).buffer as ArrayBuffer).kind).toBe('invalid');
  });

  it('rejects random bytes whose first byte is not a known message type', () => {
    // 0x05 is neither sync (0) nor awareness (1) nor query (3): not a Yjs frame.
    const buffer = new Uint8Array([0x05, 0xff, 0x00, 0x7f, 0x10]).buffer as ArrayBuffer;
    expect(decodeMessage(buffer).kind).toBe('invalid');
  });

  it('rejects a truncated sync frame (looks like 0x00 but is not a frame)', () => {
    // message-type 0 then a sync sub-type but a payload length that runs off the
    // end of the buffer: the design's "a random byte that happens to be 0x00/01/02".
    const buffer = new Uint8Array([MESSAGE_SYNC, 2, 0x10]).buffer as ArrayBuffer;
    expect(decodeMessage(buffer).kind).toBe('invalid');
  });

  it('rejects an unknown sync sub-type', () => {
    const buffer = frame(MESSAGE_SYNC, (enc) => {
      encoding.writeVarUint(enc, 5); // not 0/1/2
      encoding.writeVarUint8Array(enc, new Uint8Array([1, 2, 3]));
    });
    expect(decodeMessage(buffer).kind).toBe('invalid');
  });
});

describe('toArrayBuffer', () => {
  it('passes a raw ArrayBuffer through and copies a view to byte 0', () => {
    const backing = new Uint8Array(8);
    backing.set([9, 9, 9, 1, 2, 3, 4, 5], 0);
    const view = backing.subarray(3);
    const copied = toArrayBuffer(view);
    expect(copied).not.toBeNull();
    expect(Array.from(new Uint8Array(copied as ArrayBuffer))).toEqual([1, 2, 3, 4, 5]);
  });

  it('returns null for a text frame', () => {
    expect(toArrayBuffer('hi')).toBeNull();
  });
});

it('uses the documented close code', () => {
  expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
});
