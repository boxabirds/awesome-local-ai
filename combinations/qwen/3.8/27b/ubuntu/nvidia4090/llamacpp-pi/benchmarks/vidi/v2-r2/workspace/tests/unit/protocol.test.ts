import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';
import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  type Decoded,
} from '../../src/shared/protocol';

/**
 * sync.room unit tests (design TC-03): decodeMessage over y-websocket frames
 * built with the same lib0 encoders the clients and server use.
 */

function frame(type: number, payload?: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, type);
  if (payload !== undefined) {
    encoding.writeVarUint8Array(enc, payload);
  }
  return encoding.toUint8Array(enc);
}

/** Sync frames append the y-protocols message RAW (no length prefix). */
function syncFrame(syncMessage: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, MESSAGE_SYNC);
  encoding.writeUint8Array(enc, syncMessage);
  return encoding.toUint8Array(enc);
}

function asBytes(data: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(data.byteLength);
  new Uint8Array(buf).set(data);
  return buf;
}

describe('decodeMessage (TC-03)', () => {
  it('decodes a sync frame (step1 with a state vector)', () => {
    const stateVector = new Uint8Array([1, 2, 3, 4]);
    // y-protocols SyncStep1: [0, varUint8Array(stateVector)]
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0); // syncMessageType.SyncStep1
    encoding.writeVarUint8Array(enc, stateVector);
    const inner = encoding.toUint8Array(enc); // the y-protocols sync message
    const d = decodeMessage(asBytes(syncFrame(inner))) as Extract<
      Decoded,
      { kind: 'sync' }
    >;
    expect(d.kind).toBe('sync');
    expect(new Uint8Array(d.payload)).toEqual(inner);
  });

  it('decodes an awareness frame', () => {
    const awarenessBytes = new Uint8Array([9, 8, 7]);
    const d = decodeMessage(asBytes(frame(MESSAGE_AWARENESS, awarenessBytes))) as Extract<
      Decoded,
      { kind: 'awareness' }
    >;
    expect(d.kind).toBe('awareness');
    expect(new Uint8Array(d.payload)).toEqual(awarenessBytes);
  });

  it('decodes a query-awareness frame', () => {
    const d = decodeMessage(asBytes(frame(MESSAGE_QUERY_AWARENESS)));
    expect(d).toEqual({ kind: 'query-awareness' });
  });

  it('rejects an unknown message type (9)', () => {
    const d = decodeMessage(asBytes(frame(9, new Uint8Array([1, 2])))) as Extract<
      Decoded,
      { kind: 'invalid' }
    >;
    expect(d.kind).toBe('invalid');
    expect(d.reason).toMatch(/unknown message type/i);
  });

  it('rejects truncated awareness bytes (declared length exceeds available data)', () => {
    // awareness is the length-prefixed frame: [1, varUint(5)] with no payload
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint(enc, 5);
    const d = decodeMessage(asBytes(encoding.toUint8Array(enc))) as Extract<
      Decoded,
      { kind: 'invalid' }
    >;
    expect(d.kind).toBe('invalid');
  });

  it('treats a sync frame with an empty remainder as sync (garbage is caught downstream)', () => {
    // With raw sync framing, [0] alone decodes to an empty sync payload;
    // the room's readSyncMessage rejects it (integration TC-15).
    const d = decodeMessage(asBytes(new Uint8Array([MESSAGE_SYNC])));
    expect(d.kind).toBe('sync');
    if (d.kind === 'sync') {
      expect(d.payload.byteLength).toBe(0);
    }
  });

  it('rejects an empty frame', () => {
    const d = decodeMessage(asBytes(new Uint8Array(0))) as Extract<Decoded, { kind: 'invalid' }>;
    expect(d.kind).toBe('invalid');
  });

  it('rejects a string frame', () => {
    const d = decodeMessage('hello world') as Extract<Decoded, { kind: 'invalid' }>;
    expect(d.kind).toBe('invalid');
  });

  it('rejects bytes that are not a valid varUint prefix', () => {
    // 0xff 0xff ... is an unterminated varUint
    const d = decodeMessage(asBytes(new Uint8Array([0xff, 0xff, 0xff]))) as Extract<
      Decoded,
      { kind: 'invalid' }
    >;
    expect(d.kind).toBe('invalid');
  });

  it('accepts a Uint8Array input directly (workerd may deliver views)', () => {
    const awarenessBytes = new Uint8Array([1]);
    const d = decodeMessage(frame(MESSAGE_AWARENESS, awarenessBytes));
    expect(d.kind).toBe('awareness');
  });

  it('exports the contract constants', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
