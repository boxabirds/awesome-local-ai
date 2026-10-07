/**
 * Task 1.2: Unit tests for protocol decode (TC-03).
 */
import { describe, it, expect } from 'vitest';
import {
  MESSAGE_SYNC,
  MESSAGE_AWARENESS,
  MESSAGE_QUERY_AWARENESS,
  decodeMessage,
  encodeMessage,
} from '@/shared/protocol';

describe('protocol unit tests', () => {
  // ---- TC-03: decodeMessage ----
  describe('decodeMessage', () => {
    function toArrayBuffer(data: Uint8Array): ArrayBuffer {
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).buffer as ArrayBuffer;
    }

    it('TC-03: sync frame → {kind:"sync"}', () => {
      const payload = new Uint8Array([1, 2, 3]);
      const encoded = encodeMessage(MESSAGE_SYNC, payload);
      const result = decodeMessage(toArrayBuffer(encoded));
      expect(result).toEqual({ kind: 'sync', payload });
    });

    it('TC-03: awareness frame → {kind:"awareness"}', () => {
      const payload = new Uint8Array([4, 5]);
      const encoded = encodeMessage(MESSAGE_AWARENESS, payload);
      const result = decodeMessage(toArrayBuffer(encoded));
      expect(result).toEqual({ kind: 'awareness', payload });
    });

    it('TC-03: query-awareness frame → {kind:"query-awareness"}', () => {
      const encoded = encodeMessage(MESSAGE_QUERY_AWARENESS, new Uint8Array(0));
      const result = decodeMessage(toArrayBuffer(encoded));
      expect(result).toEqual({ kind: 'query-awareness' });
    });

    it('TC-03: unknown type 9 → invalid', () => {
      const encoded = encodeMessage(9, new Uint8Array(0));
      const result = decodeMessage(toArrayBuffer(encoded));
      expect(result.kind).toBe('invalid');
    });

    it('TC-03: truncated bytes (empty) → invalid', () => {
      const result = decodeMessage(new ArrayBuffer(0));
      expect(result.kind).toBe('invalid');
    });

    it('TC-03: string frame → invalid', () => {
      const result = decodeMessage('not binary');
      expect(result.kind).toBe('invalid');
    });
  });
});
