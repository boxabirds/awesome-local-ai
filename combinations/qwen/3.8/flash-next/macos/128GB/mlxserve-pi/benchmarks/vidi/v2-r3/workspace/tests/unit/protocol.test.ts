import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  SYNC_STEP_1,
  SYNC_STEP_2,
  SYNC_UPDATE,
  decodeMessage,
} from '../../src/shared/protocol';

/**
 * Story 3, sync.room: the room decides what to do with a frame from its type
 * byte alone and never throws on bad input, because one client's malformed
 * traffic must close only that client's socket (TC-15).
 */

const encoder = (): encoding.Encoder => encoding.createEncoder();

/** One y-websocket frame: type byte, then whatever the caller wrote. */
const frame = (type: number, write: (e: encoding.Encoder) => void = () => {}): ArrayBuffer => {
  const e = encoder();
  encoding.writeVarUint(e, type);
  write(e);
  return encoding.toUint8Array(e).buffer as ArrayBuffer;
};

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values);

describe('decodeMessage (known frame types)', () => {
  it('decodes a SyncStep1 frame into a sync payload', () => {
    const data = frame(MESSAGE_SYNC, (e) => {
      encoding.writeVarUint(e, SYNC_STEP_1);
      // A state vector: one client, clock 3.
      encoding.writeVarUint(e, 1);
      encoding.writeVarUint(e, 42);
      encoding.writeVarUint(e, 3);
    });
    const decoded = decodeMessage(data);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') {
      expect(Array.from(decoded.payload)).toEqual([SYNC_STEP_1, 1, 42, 3]);
    }
  });

  it('decodes a SyncStep2 frame into a sync payload', () => {
    const data = frame(MESSAGE_SYNC, (e) => {
      encoding.writeVarUint(e, SYNC_STEP_2);
      encoding.writeVarUint8Array(e, bytes(9, 8, 7));
    });
    const decoded = decodeMessage(data);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') {
      expect(Array.from(decoded.payload)).toEqual([SYNC_STEP_2, 3, 9, 8, 7]);
    }
  });

  it('decodes a document-update frame into a sync payload', () => {
    const data = frame(MESSAGE_SYNC, (e) => {
      encoding.writeVarUint(e, SYNC_UPDATE);
      encoding.writeVarUint8Array(e, bytes(1, 2, 3, 4));
    });
    const decoded = decodeMessage(data);
    expect(decoded.kind).toBe('sync');
    if (decoded.kind === 'sync') {
      expect(Array.from(decoded.payload)).toEqual([SYNC_UPDATE, 4, 1, 2, 3, 4]);
    }
  });

  it('decodes an awareness frame into its verbatim payload', () => {
    const data = frame(MESSAGE_AWARENESS, (e) => {
      encoding.writeVarUint8Array(e, bytes(1, 1, 7, 3, 11));
    });
    const decoded = decodeMessage(data);
    expect(decoded.kind).toBe('awareness');
    if (decoded.kind === 'awareness') {
      expect(Array.from(decoded.payload)).toEqual([1, 1, 7, 3, 11]);
    }
  });

  it('decodes a query-awareness frame', () => {
    const decoded = decodeMessage(frame(MESSAGE_QUERY_AWARENESS));
    expect(decoded).toEqual({ kind: 'query-awareness' });
  });
});

describe('decodeMessage (error paths)', () => {
  it('reports an unknown frame type as invalid', () => {
    const decoded = decodeMessage(frame(9, (e) => encoding.writeUint8(e, 1)));
    expect(decoded.kind).toBe('invalid');
  });

  it('reports an unknown sync sub-type as invalid', () => {
    const decoded = decodeMessage(
      frame(MESSAGE_SYNC, (e) => {
        encoding.writeVarUint(e, 7);
        encoding.writeUint8(e, 1);
      }),
    );
    expect(decoded.kind).toBe('invalid');
  });

  it('reports a frame truncated inside its payload as invalid', () => {
    // The awareness length prefix promises 10 bytes; only 3 are there.
    const decoded = decodeMessage(
      frame(MESSAGE_AWARENESS, (e) => {
        encoding.writeVarUint(e, 10);
        encoding.writeUint8Array(e, bytes(1, 2, 3));
      }),
    );
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') expect(decoded.reason.length).toBeGreaterThan(0);
  });

  it('reports an empty frame and a text frame as invalid', () => {
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
    expect(decodeMessage('hello').kind).toBe('invalid');
    expect(decodeMessage('{"kind":"sync"}').kind).toBe('invalid');
  });

  it('uses the 1003 close code for unusable data', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
