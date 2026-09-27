// Unit tests for the y-websocket frame decoder (design "sync.room"): TC-03.
// Every known message type decodes to a typed result carrying the bytes after
// the message type; anything unknown, truncated or textual decodes to
// { kind: 'invalid' } so the room can close just that socket.
import * as encoding from 'lib0/encoding';
import { describe, expect, it } from 'vitest';

import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
} from '../../src/shared/protocol';

/** y-protocols/sync inner message types. */
const SYNC_STEP_1 = 0;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function syncFrame(innerType: number, body: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_SYNC);
  encoding.writeVarUint(encoder, innerType);
  encoding.writeVarUint8Array(encoder, body);
  return encoding.toUint8Array(encoder);
}

function awarenessFrame(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return encoding.toUint8Array(encoder);
}

function queryAwarenessFrame(): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  return encoding.toUint8Array(encoder);
}

describe('decodeMessage (TC-03)', () => {
  it('decodes a SyncStep1 frame as sync', () => {
    const stateVector = new Uint8Array([9, 0, 1, 5]);
    const frame = syncFrame(SYNC_STEP_1, stateVector);
    const result = decodeMessage(bufferOf(frame));
    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(Array.from(result.payload)).toEqual([SYNC_STEP_1, stateVector.length, ...stateVector]);
  });

  it('decodes a SyncStep2 frame as sync', () => {
    const update = new Uint8Array([1, 2, 3, 4, 5]);
    const result = decodeMessage(bufferOf(syncFrame(SYNC_STEP_2, update)));
    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(Array.from(result.payload)).toEqual([SYNC_STEP_2, update.length, ...update]);
  });

  it('decodes an Update frame as sync', () => {
    const update = new Uint8Array([7, 8]);
    const result = decodeMessage(bufferOf(syncFrame(SYNC_UPDATE, update)));
    expect(result.kind).toBe('sync');
    if (result.kind !== 'sync') return;
    expect(Array.from(result.payload)).toEqual([SYNC_UPDATE, update.length, ...update]);
  });

  it('decodes an awareness frame as awareness, keeping the payload for relay', () => {
    const update = new Uint8Array([3, 9, 12, 4]);
    const result = decodeMessage(bufferOf(awarenessFrame(update)));
    expect(result.kind).toBe('awareness');
    if (result.kind !== 'awareness') return;
    expect(Array.from(result.payload)).toEqual([update.length, ...update]);
  });

  it('decodes a query-awareness frame', () => {
    expect(decodeMessage(bufferOf(queryAwarenessFrame()))).toEqual({
      kind: 'query-awareness',
    });
  });

  it('reports an unknown message type as invalid', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 9);
    encoding.writeVarUint8Array(encoder, new Uint8Array([1, 2, 3]));
    const result = decodeMessage(bufferOf(encoding.toUint8Array(encoder)));
    expect(result.kind).toBe('invalid');
  });

  it('reports an unknown inner sync message type as invalid', () => {
    const result = decodeMessage(bufferOf(syncFrame(7, new Uint8Array([1]))));
    expect(result.kind).toBe('invalid');
  });

  it('reports a truncated sync body as invalid', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, SYNC_STEP_2);
    encoding.writeVarUint(encoder, 64); // promises 64 bytes
    encoding.writeUint8(encoder, 1); // provides 1
    encoding.writeUint8(encoder, 2);
    encoding.writeUint8(encoder, 3);
    const result = decodeMessage(bufferOf(encoding.toUint8Array(encoder)));
    expect(result.kind).toBe('invalid');
  });

  it('reports a truncated awareness body as invalid', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_AWARENESS);
    encoding.writeVarUint(encoder, 10);
    encoding.writeUint8(encoder, 1);
    encoding.writeUint8(encoder, 2);
    const result = decodeMessage(bufferOf(encoding.toUint8Array(encoder)));
    expect(result.kind).toBe('invalid');
  });

  it('reports a frame that promises more bytes than it holds as invalid', () => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    encoding.writeVarUint(encoder, SYNC_STEP_1);
    const result = decodeMessage(bufferOf(encoding.toUint8Array(encoder)));
    expect(result.kind).toBe('invalid');
  });

  it('reports a text frame as invalid', () => {
    expect(decodeMessage('hello').kind).toBe('invalid');
    expect(decodeMessage('').kind).toBe('invalid');
  });

  it('reports an empty binary frame as invalid', () => {
    expect(decodeMessage(new ArrayBuffer(0)).kind).toBe('invalid');
  });

  it('uses the RFC 6455 unsupported-data close code', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
