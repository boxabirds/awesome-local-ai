import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import {
  CLOSE_BOARD_LOAD_FAILED,
  CLOSE_STORAGE_FAILURE,
  CLOSE_UNSUPPORTED_DATA,
  decodeMessage,
  encodeSyncMessage,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
} from '../../src/shared/protocol.ts';

function bytesEq(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// TC-03 decodeMessage: typed results for known frames, {kind:'invalid'} for
// unknown type, truncated bytes and a text (string) frame.
describe('decodeMessage', () => {
  it('decodes a sync frame into {kind:"sync"} with the exact sync body', () => {
    const doc = new Y.Doc();
    const bodyEnc = encoding.createEncoder();
    syncProtocol.writeSyncStep1(bodyEnc, doc);
    const body = encoding.toUint8Array(bodyEnc);

    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_SYNC);
    encoding.writeUint8Array(enc, body);
    const frame = encoding.toUint8Array(enc);

    const res = decodeMessage(frame.buffer as ArrayBuffer);
    expect(res.kind).toBe('sync');
    if (res.kind === 'sync') expect(bytesEq(res.payload, body)).toBe(true);
  });

  it('decodes an awareness frame into {kind:"awareness"} with the exact payload', () => {
    const doc = new Y.Doc();
    const aw = new awarenessProtocol.Awareness(doc);
    aw.setLocalState({ user: 'alex' });
    const update = awarenessProtocol.encodeAwarenessUpdate(aw, [doc.clientID]);

    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint8Array(enc, update);
    const frame = encoding.toUint8Array(enc);

    const res = decodeMessage(frame.buffer as ArrayBuffer);
    expect(res.kind).toBe('awareness');
    if (res.kind === 'awareness') expect(bytesEq(res.payload, update)).toBe(true);
  });

  it('decodes a query-awareness frame into {kind:"query-awareness"}', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_QUERY_AWARENESS);
    const frame = encoding.toUint8Array(enc);

    const res = decodeMessage(frame.buffer as ArrayBuffer);
    expect(res.kind).toBe('query-awareness');
  });

  it('marks an unknown message type (9) invalid', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 9);
    encoding.writeVarUint(enc, 1);
    const frame = encoding.toUint8Array(enc);

    const res = decodeMessage(frame.buffer as ArrayBuffer);
    expect(res.kind).toBe('invalid');
  });

  it('marks truncated awareness bytes invalid (length prefix exceeds frame)', () => {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MESSAGE_AWARENESS);
    encoding.writeVarUint(enc, 500); // claims 500 bytes follow...
    encoding.writeUint8Array(enc, new Uint8Array([1, 2, 3])); // ...but only 3 do
    const frame = encoding.toUint8Array(enc);

    const res = decodeMessage(frame.buffer as ArrayBuffer);
    expect(res.kind).toBe('invalid');
  });

  it('marks a text (string) frame invalid', () => {
    const res = decodeMessage('hello world');
    expect(res.kind).toBe('invalid');
  });

  it('marks an empty frame invalid (no type byte to read)', () => {
    const res = decodeMessage(new Uint8Array([]).buffer as ArrayBuffer);
    expect(res.kind).toBe('invalid');
  });

  it('encodeSyncMessage frames a sync body under the sync type', () => {
    const body = new Uint8Array([0, 1, 2, 3]);
    const frame = encodeSyncMessage(body);
    const res = decodeMessage(frame.buffer as ArrayBuffer);
    expect(res.kind).toBe('sync');
    if (res.kind === 'sync') expect(bytesEq(res.payload, body)).toBe(true);
  });
});

// TC-01: the close codes story 4 adds are named in the protocol module, so no
// room or client code has to spell a bare 4500 / 1011.
describe('close codes', () => {
  it('names the board load failure 4500 and the storage failure 1011', () => {
    expect(CLOSE_BOARD_LOAD_FAILED).toBe(4500);
    expect(CLOSE_STORAGE_FAILURE).toBe(1011);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });

  it('4500 is outside y-websocket permanent 4400-4499 range, so clients retry', () => {
    // y-websocket's default shouldReconnect treats 4400..4499 as terminal.
    const permanent = (code: number) => code >= 4400 && code < 4500;
    expect(permanent(CLOSE_BOARD_LOAD_FAILED)).toBe(false);
  });

  it('the codes are distinct from every other close code in the module', () => {
    const codes = [CLOSE_UNSUPPORTED_DATA, CLOSE_BOARD_LOAD_FAILED, CLOSE_STORAGE_FAILURE];
    expect(new Set(codes).size).toBe(codes.length);
  });
});
