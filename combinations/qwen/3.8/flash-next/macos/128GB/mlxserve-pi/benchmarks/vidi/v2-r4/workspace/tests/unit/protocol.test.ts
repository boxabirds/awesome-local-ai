/**
 * TC-03 — message framing (design anchor `sync.room`, unit level).
 *
 * The room acts on the *framing* before it looks at any document: a frame it
 * cannot classify must be refused with a close code, and must never be guessed
 * at. These tests build the exact bytes a client would put on the wire with the
 * same lib0 encoders the client provider uses.
 */
import { describe, expect, it } from 'vitest';
import * as encoding from 'lib0/encoding';

import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  type Decoded,
} from '../../src/shared/protocol';

/** One frame: the message type byte followed by `body`. */
function frame(type: number, body: number[] = []): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  for (const byte of body) encoding.writeUint8(encoder, byte);
  return encoding.toUint8Array(encoder).buffer as ArrayBuffer;
}

/** The bytes of a `y-protocols` awareness update, spelled out: one client, state `{}`. */
const AWARENESS_BYTES = [1, 0, 1, 123, 0];

describe('decodeMessage', () => {
  it('types a sync frame and hands back its payload untouched', () => {
    const payload = [1, 2, 3, 4];
    const decoded = decodeMessage(frame(MESSAGE_SYNC, payload));
    expect(decoded.kind).toBe('sync');
    expect(Array.from((decoded as Extract<Decoded, { kind: 'sync' }>).payload)).toEqual(payload);
  });

  it('types an awareness frame and hands back its payload untouched', () => {
    const decoded = decodeMessage(frame(MESSAGE_AWARENESS, AWARENESS_BYTES));
    expect(decoded.kind).toBe('awareness');
    expect(Array.from((decoded as Extract<Decoded, { kind: 'awareness' }>).payload)).toEqual(
      AWARENESS_BYTES,
    );
  });

  it('types a query-awareness frame, which carries no payload', () => {
    expect(decodeMessage(frame(MESSAGE_QUERY_AWARENESS)).kind).toBe('query-awareness');
  });

  it('reframes a sync message written by the client provider', () => {
    // The provider writes the type with `writeVarUint` and then the sync message
    // itself, so the frame is one byte for a type below 128 followed by the body.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, 0); // syncProtocol messageSync (SyncStep1)
    encoding.writeVarUint8Array(encoder, new Uint8Array([0])); // an empty state vector
    const decoded = decodeMessage(encoding.toUint8Array(encoder).buffer as ArrayBuffer);
    expect(decoded.kind).toBe('sync');
    expect(
      Array.from((decoded as Extract<Decoded, { kind: 'sync' }>).payload),
    ).toEqual([0, 1, 0]);
  });

  it('refuses a message type this protocol does not have', () => {
    const decoded = decodeMessage(frame(9, AWARENESS_BYTES));
    expect(decoded.kind).toBe('invalid');
    expect((decoded as Extract<Decoded, { kind: 'invalid' }>).reason).toContain('9');
  });

  it.each([
    ['an empty frame', new ArrayBuffer(0)],
    ['a frame that stops before its type byte', frame(255)],
    ['a sync frame with no body', frame(MESSAGE_SYNC)],
    ['an awareness frame with no body', frame(MESSAGE_AWARENESS)],
  ])('refuses %s as truncated', (_label, data) => {
    expect(decodeMessage(data).kind).toBe('invalid');
  });

  it('refuses a text frame: the protocol is binary', () => {
    const decoded = decodeMessage('hello');
    expect(decoded.kind).toBe('invalid');
    expect((decoded as Extract<Decoded, { kind: 'invalid' }>).reason).not.toBe('');
  });
});

describe('protocol constants', () => {
  it('matches the y-websocket framing the client provider speaks', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
