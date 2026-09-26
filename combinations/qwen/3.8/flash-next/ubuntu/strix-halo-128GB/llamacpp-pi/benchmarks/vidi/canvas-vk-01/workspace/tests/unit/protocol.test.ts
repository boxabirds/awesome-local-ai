import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';

import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  type Decoded,
} from '../../src/shared/protocol';

/**
 * TC-03 — y-websocket frame decoding (sync.room). Frames are built the way the
 * browser provider builds them (`y-websocket/src/y-websocket.js`): a
 * `varuint(type)` followed by the message itself — inline for sync messages,
 * `varuint8array` for awareness.
 */

/** Sync frame: `varuint(0)` then the y-protocols message inline. */
function syncFrame(inner: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeUint8Array(encoder, inner);
  return encoding.toUint8Array(encoder);
}

/** Awareness frame: `varuint(1)` then `varuint8array(payload)`. */
function awarenessFrame(payload: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, payload);
  return encoding.toUint8Array(encoder);
}

function queryFrame(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(encoder);
}

function typeOnlyFrame(type: number): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  return encoding.toUint8Array(encoder);
}

/** Copy into a fresh ArrayBuffer (WebSocket delivers ArrayBuffer, not views). */
function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function reasonOf(result: Decoded): string {
  return (result as Extract<Decoded, { kind: 'invalid' }>).reason;
}

describe('protocol constants', () => {
  it('matches the y-websocket wire constants', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame, payload starting at the sync sub-type', () => {
    // y-protocols SyncStep1: varuint(0) + varuint8array(state vector).
    const inner = new Uint8Array([0, 1, 0]);
    const result = decodeMessage(asArrayBuffer(syncFrame(inner)));
    expect(result.kind).toBe('sync');
    expect(Array.from((result as Extract<Decoded, { kind: 'sync' }>).payload)).toEqual(
      Array.from(inner),
    );
  });

  it('decodes an awareness frame', () => {
    const payload = new Uint8Array([9, 8, 7]);
    const result = decodeMessage(asArrayBuffer(awarenessFrame(payload)));
    expect(result.kind).toBe('awareness');
    expect((result as Extract<Decoded, { kind: 'awareness' }>).payload).toEqual(payload);
  });

  it('decodes a query-awareness frame (no payload)', () => {
    const result = decodeMessage(asArrayBuffer(queryFrame()));
    expect(result.kind).toBe('query-awareness');
  });

  it('rejects an unknown message type 9', () => {
    const result = decodeMessage(asArrayBuffer(typeOnlyFrame(9)));
    expect(result.kind).toBe('invalid');
    expect(reasonOf(result)).toContain('9');
  });

  it('rejects an awareness frame whose declared payload is truncated', () => {
    const full = awarenessFrame(new Uint8Array([1, 2, 3, 4, 5]));
    const truncated = full.slice(0, full.byteLength - 3);
    const result = decodeMessage(asArrayBuffer(truncated));
    expect(result.kind).toBe('invalid');
    expect(reasonOf(result)).toContain('truncated');
  });

  it('rejects a sync frame with only a type byte and no message', () => {
    const result = decodeMessage(asArrayBuffer(typeOnlyFrame(MESSAGE_SYNC)));
    expect(result.kind).toBe('invalid');
  });

  it('rejects an empty buffer', () => {
    const result = decodeMessage(new ArrayBuffer(0));
    expect(result.kind).toBe('invalid');
  });

  it('rejects a text frame', () => {
    const result = decodeMessage('hello');
    expect(result.kind).toBe('invalid');
  });
});
