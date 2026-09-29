// Story 3, TC-03: decodeMessage for the y-websocket framing (sync.room).
// Frames are built with the same lib0 encoders the wire uses.
//
// Wire format (matches the y-websocket provider exactly):
//   - type 0 (sync): body is the RAW inner sync message (no varBytes).
//   - type 1 (awareness): body is varBytes(awareness update).
//   - type 3 (query-awareness): no body.

import { describe, expect, it } from 'vitest';
import { createEncoder, toUint8Array, writeUint8Array, writeVarUint, writeVarUint8Array } from 'lib0/encoding';
import { decodeMessage } from '../../src/shared/protocol';

/** Type byte followed by a raw body (the sync framing). */
function rawFrame(type: number, body?: Uint8Array): ArrayBuffer {
  const encoder = createEncoder();
  writeVarUint(encoder, type);
  if (body !== undefined) writeUint8Array(encoder, body);
  return toUint8Array(encoder).buffer;
}

/** varBytes-wraps a payload (the awareness framing). */
function varBytes(payload: Uint8Array): Uint8Array {
  const encoder = createEncoder();
  writeVarUint8Array(encoder, payload);
  return toUint8Array(encoder);
}

describe('TC-03: decodeMessage', () => {
  it('decodes a sync frame (type 0) whose body is the raw inner message', () => {
    const inner = new Uint8Array([0, 7, 1, 2, 3, 4, 5, 6, 7]); // SyncStep1 + state vector
    const decoded = decodeMessage(rawFrame(0, inner));
    expect(decoded).toEqual({ kind: 'sync', payload: inner });
  });

  it('decodes an awareness frame (type 1) whose body is varBytes', () => {
    const update = new Uint8Array([9, 8, 7]);
    const decoded = decodeMessage(rawFrame(1, varBytes(update)));
    expect(decoded).toEqual({ kind: 'awareness', payload: update });
  });

  it('decodes a query-awareness frame (type 3) without body', () => {
    const decoded = decodeMessage(rawFrame(3));
    expect(decoded).toEqual({ kind: 'query-awareness' });
  });

  it('rejects an unknown message type (9)', () => {
    const decoded = decodeMessage(rawFrame(9));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') expect(decoded.reason).not.toBe('');
  });

  it('rejects a sync frame with no body (empty payload)', () => {
    const decoded = decodeMessage(rawFrame(0));
    expect(decoded.kind).toBe('invalid');
    if (decoded.kind === 'invalid') expect(decoded.reason).toBe('empty payload');
  });

  it('rejects truncated awareness varBytes (declared length exceeds the frame)', () => {
    // type 1, then varBytes length 256 with zero following bytes.
    const truncated = new Uint8Array([0x01, 0x81, 0x80]);
    const decoded = decodeMessage(truncated.buffer);
    expect(decoded.kind).toBe('invalid');
  });

  it('rejects an empty frame (truncated type)', () => {
    expect(decodeMessage(new Uint8Array(0).buffer).kind).toBe('invalid');
  });

  it('rejects string frames', () => {
    const decoded = decodeMessage('hello world');
    expect(decoded).toEqual(expect.objectContaining({ kind: 'invalid' }));
  });
});
