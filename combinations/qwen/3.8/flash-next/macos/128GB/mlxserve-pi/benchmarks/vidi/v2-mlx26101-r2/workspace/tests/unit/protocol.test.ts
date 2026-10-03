import { describe, expect, it } from 'vitest';

import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import {
  CLOSE_UNSUPPORTED_DATA,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  MESSAGE_SYNC,
  decodeMessage,
  frameMessage,
  type Decoded,
} from '../../src/shared/protocol.js';

/**
 * TC-03 (design "BoardRoom Durable Object", unit scope): the room's message
 * decoder. The frames here are built with the same lib0 encoders the client
 * provider uses, so a frame that decodes here is a frame the browser sends.
 */

/** An ArrayBuffer copy of an encoder's bytes (what a WebSocket message holds). */
const bufferOf = (encoder: encoding.Encoder): ArrayBuffer =>
  encoding.toUint8Array(encoder).slice().buffer;

/** A y-websocket frame: the message type, then a length-prefixed body. */
const frame = (type: number, body?: Uint8Array): ArrayBuffer => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, type);
  if (body !== undefined) encoding.writeUint8Array(encoder, body);
  return bufferOf(encoder);
};

/** A y-websocket frame whose body is written without a length prefix. */
const rawFrame = (write: (encoder: encoding.Encoder) => void): ArrayBuffer => {
  const encoder = encoding.createEncoder();
  write(encoder);
  return bufferOf(encoder);
};

const invalid = (decoded: Decoded): string => {
  if (decoded.kind !== 'invalid') throw new Error(`expected invalid, got ${decoded.kind}`);
  return decoded.reason;
};

describe('decodeMessage (TC-03)', () => {
  it('decodes a SyncStep1 frame', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 1);
    const stateVector = Y.encodeStateVector(doc);

    const body = encoding.encode((encoder) => {
      encoding.writeVarUint(encoder, 0); // syncProtocol.messageYjsSyncStep1
      encoding.writeVarUint8Array(encoder, stateVector);
    });
    const decoded = decodeMessage(frame(MESSAGE_SYNC, body));

    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    // The payload is the y-protocols body: ready for readSyncMessage.
    const payload = decoding.createDecoder(decoded.payload);
    expect(decoding.readVarUint(payload)).toBe(0);
    expect(Array.from(decoding.readVarUint8Array(payload))).toEqual(Array.from(stateVector));
  });

  it('decodes a SyncStep2 frame carrying an update', () => {
    const doc = new Y.Doc();
    doc.getMap('objects').set('a', 1);
    const update = Y.encodeStateAsUpdate(doc);

    const body = encoding.encode((encoder) => {
      encoding.writeVarUint(encoder, 1); // syncProtocol.messageYjsSyncStep2
      encoding.writeVarUint8Array(encoder, update);
    });
    const decoded = decodeMessage(frame(MESSAGE_SYNC, body));

    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    const payload = decoding.createDecoder(decoded.payload);
    expect(decoding.readVarUint(payload)).toBe(1);
    expect(() => Y.applyUpdate(new Y.Doc(), decoding.readVarUint8Array(payload))).not.toThrow();
  });

  it('decodes an awareness frame and keeps the update bytes', () => {
    const update = Uint8Array.from([1, 2, 3, 4]);
    const body = encoding.encode((encoder) => {
      encoding.writeVarUint8Array(encoder, update);
    });
    const decoded = decodeMessage(frame(MESSAGE_AWARENESS, body));

    expect(decoded.kind).toBe('awareness');
    if (decoded.kind !== 'awareness') return;
    const payload = decoding.createDecoder(decoded.payload);
    expect(Array.from(decoding.readVarUint8Array(payload))).toEqual(Array.from(update));
  });

  it('decodes a query-awareness frame', () => {
    expect(decodeMessage(rawFrame((e) => encoding.writeVarUint(e, MESSAGE_QUERY_AWARENESS)))).toEqual(
      { kind: 'query-awareness' },
    );
  });

  it('reports an unknown message type as invalid', () => {
    expect(invalid(decodeMessage(rawFrame((e) => encoding.writeVarUint(e, 9))))).toContain('9');
  });

  it('reports truncated bytes as invalid', () => {
    // An awareness frame whose update is shorter than its length prefix says.
    expect(invalid(decodeMessage(new Uint8Array([MESSAGE_AWARENESS, 5, 1, 2]).buffer))).toMatch(
      /truncated/i,
    );
    // A sync frame with no body at all.
    expect(invalid(decodeMessage(new Uint8Array([MESSAGE_SYNC]).buffer))).toMatch(/body/i);
    // A message type varuint that stops in the middle of the number.
    expect(invalid(decodeMessage(new Uint8Array([0xff]).buffer))).toMatch(/message type/i);
    // An empty message.
    expect(invalid(decodeMessage(new Uint8Array(0).buffer))).toMatch(/empty/i);
  });

  it('reports a text frame as invalid', () => {
    expect(invalid(decodeMessage('hello'))).toMatch(/text/i);
  });

  it('never throws for any input', () => {
    const inputs: (ArrayBuffer | string)[] = [
      'anything',
      new Uint8Array(0).buffer,
      new Uint8Array([255, 255, 255, 255, 127]).buffer,
      new Uint8Array([MESSAGE_SYNC, 0]).buffer,
      new Uint8Array([MESSAGE_AWARENESS]).buffer,
    ];
    for (const input of inputs) {
      expect(() => decodeMessage(input)).not.toThrow();
    }
  });

  it('uses the documented frame and close-code constants', () => {
    expect(MESSAGE_SYNC).toBe(0);
    expect(MESSAGE_AWARENESS).toBe(1);
    expect(MESSAGE_QUERY_AWARENESS).toBe(3);
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});

describe('frameMessage', () => {
  it('round-trips a sync body through decodeMessage', () => {
    const body = encoding.encode((encoder) => {
      encoding.writeVarUint(encoder, 0);
      encoding.writeVarUint8Array(encoder, Y.encodeStateVector(new Y.Doc()));
    });
    const framed = frameMessage(MESSAGE_SYNC, body);
    const decoded = decodeMessage(framed.buffer as ArrayBuffer);

    expect(decoded.kind).toBe('sync');
    if (decoded.kind !== 'sync') return;
    expect(Array.from(decoded.payload)).toEqual(Array.from(body));
  });

  it('prefixes the body with the frame type and nothing else', () => {
    const framed = frameMessage(MESSAGE_AWARENESS, Uint8Array.from([7, 8, 9]));
    expect(Array.from(framed)).toEqual([MESSAGE_AWARENESS, 7, 8, 9]);
  });
});
