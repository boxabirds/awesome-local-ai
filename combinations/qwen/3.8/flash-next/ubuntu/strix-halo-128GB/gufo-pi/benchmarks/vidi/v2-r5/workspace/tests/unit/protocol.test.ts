import { describe, it, expect } from 'vitest';
import * as encoding from 'lib0/encoding';
import {
  decodeMessage,
  wrapSyncMessage,
  encodeAwarenessMessage,
  MESSAGE_SYNC,
  MESSAGE_QUERY_AWARENESS,
} from '../../src/shared/protocol';

function makeSyncFrame(syncPayload: Uint8Array): ArrayBuffer {
  // MESSAGE_SYNC is 0, which encodes as a single byte 0x00
  const arr = new Uint8Array(1 + syncPayload.length);
  arr[0] = MESSAGE_SYNC;
  arr.set(syncPayload, 1);
  return arr.buffer;
}

function makeAwarenessFrame(payload: Uint8Array): ArrayBuffer {
  const arr = encodeAwarenessMessage(payload);
  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return buf;
}

function makeQueryAwarenessFrame(): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MESSAGE_QUERY_AWARENESS);
  const arr = encoding.toUint8Array(encoder);
  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return buf;
}

function makeUnknownTypeFrame(type: number): ArrayBuffer {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  const arr = encoding.toUint8Array(encoder);
  const buf = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buf).set(arr);
  return buf;
}

describe('decodeMessage', () => {
  // TC-03: sync frame → typed result
  it('decodes a sync message', () => {
    // A minimal sync protocol SyncStep1: varuint(0) + varuint8array([])
    const syncPayload = encoding.createEncoder();
    encoding.writeVarUint(syncPayload, 0); // SyncStep1
    encoding.writeVarUint8Array(syncPayload, new Uint8Array(0));
    const syncBytes = encoding.toUint8Array(syncPayload);

    const buf = makeSyncFrame(syncBytes);
    const result = decodeMessage(buf);
    expect(result.kind).toBe('sync');
    if (result.kind === 'sync') {
      expect(result.payload).toEqual(syncBytes);
    }
  });

  // TC-03: awareness frame → typed result
  it('decodes an awareness message', () => {
    const payload = new Uint8Array([10, 20, 30]);
    const buf = makeAwarenessFrame(payload);
    const result = decodeMessage(buf);
    expect(result.kind).toBe('awareness');
    if (result.kind === 'awareness') {
      expect(result.payload).toEqual(payload);
    }
  });

  // TC-03: query-awareness frame → typed result
  it('decodes a query-awareness message', () => {
    const buf = makeQueryAwarenessFrame();
    const result = decodeMessage(buf);
    expect(result.kind).toBe('query-awareness');
  });

  // TC-03: unknown type 9 → invalid
  it('rejects unknown message type 9', () => {
    const buf = makeUnknownTypeFrame(9);
    const result = decodeMessage(buf);
    expect(result.kind).toBe('invalid');
  });

  // TC-03: truncated bytes (empty ArrayBuffer) → invalid
  it('rejects empty/truncated bytes', () => {
    const result = decodeMessage(new ArrayBuffer(0));
    expect(result.kind).toBe('invalid');
  });

  // TC-03: string frame → invalid
  it('rejects string frame', () => {
    const result = decodeMessage('hello');
    expect(result.kind).toBe('invalid');
  });
});

describe('wrapSyncMessage', () => {
  it('prepends MESSAGE_SYNC byte 0 to the payload', () => {
    const payload = new Uint8Array([1, 2, 3]);
    const wrapped = wrapSyncMessage(payload);
    expect(wrapped[0]).toBe(0);
    expect(wrapped.slice(1)).toEqual(payload);
  });
});
