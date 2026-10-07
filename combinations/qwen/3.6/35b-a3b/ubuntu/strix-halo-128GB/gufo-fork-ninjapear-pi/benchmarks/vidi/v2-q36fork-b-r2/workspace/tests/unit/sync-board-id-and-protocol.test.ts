import { describe, it, expect } from 'vitest';
import { isValidBoardId, newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import { decodeMessage, MESSAGE_SYNC, MESSAGE_AWARENESS, MESSAGE_QUERY_AWARENESS, CLOSE_UNSUPPORTED_DATA } from '../../src/shared/protocol';

// --- TC-01: isValidBoardId ---
describe('TC-01: isValidBoardId', () => {
  it('valid 22-char base64url → true', () => {
    // Generate several via newBoardId — all should be valid
    for (let i = 0; i < 10; i++) {
      const id = newBoardId();
      expect(id.length).toBe(22);
      expect(isValidBoardId(id)).toBe(true);
    }
    // Also direct strings that match the pattern (exactly 22 base64url chars)
    expect(isValidBoardId('ABCdef01234567890abc__')).toBe(true);
  });

  it('21 chars → false', () => {
    expect(isValidBoardId('ABCdef01234567890ab')).toBe(false);
  });

  it('23 chars → false', () => {
    expect(isValidBoardId('ABCdef01234567890abcd')).toBe(false);
  });

  it('+ char → false (+ not in base64url)', () => {
    expect(isValidBoardId('ABC+ef01234567890ab')).toBe(false);
  });

  it('../x path traversal → false', () => {
    expect(isValidBoardId('../x')).toBe(false);
  });

  it('empty string → false', () => {
    expect(isValidBoardId('')).toBe(false);
  });

  it('null / undefined → false', () => {
    expect(isValidBoardId(null as any)).toBe(false);
    expect(isValidBoardId(undefined as any)).toBe(false);
  });
});

// --- TC-02: newBoardId x 10,000 ---
describe('TC-02: newBoardId uniqueness and pattern', () => {
  it('all 10,000 generated ids match pattern and are unique', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = newBoardId();
      expect(BOARD_ID_PATTERN.test(id)).toBe(true);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
  });
});

// --- TC-03: decodeMessage ---
describe('TC-03: decodeMessage', () => {
  // Helper: encode a y-websocket frame of type `type` with payload bytes
  function encodeFrame(type: number, payload: Uint8Array): ArrayBuffer {
    const buf = new Uint8Array(payload.length + 1);
    buf[0] = type;
    buf.set(payload, 1);
    return buf.buffer;
  }

  it('sync message type 0 → decoded', () => {
    const payload = new Uint8Array([1, 2, 3]);
    const result = decodeMessage(encodeFrame(MESSAGE_SYNC, payload));
    expect(result).toEqual({ kind: 'sync', payload: new Uint8Array([1, 2, 3]) });
  });

  it('awareness message type 1 → decoded', () => {
    const payload = new Uint8Array([4, 5, 6]);
    const result = decodeMessage(encodeFrame(MESSAGE_AWARENESS, payload));
    expect(result).toEqual({ kind: 'awareness', payload: new Uint8Array([4, 5, 6]) });
  });

  it('query-awareness message type 3 → decoded', () => {
    const result = decodeMessage(new Uint8Array([MESSAGE_QUERY_AWARENESS]).buffer);
    expect(result).toEqual({ kind: 'query-awareness' });
  });

  it('unknown type 9 → invalid', () => {
    const result = decodeMessage(new Uint8Array([9, 0, 0]).buffer);
    expect(result).toEqual({ kind: 'invalid', reason: 'unknown message type 9' });
  });

  it('truncated bytes (empty payload for sync) → still decodable as sync', () => {
    const result = decodeMessage(new Uint8Array([MESSAGE_SYNC]).buffer);
    expect(result).toEqual({ kind: 'sync', payload: new Uint8Array(0) });
  });

  it('string frame → invalid', () => {
    const result = decodeMessage('not a binary frame') as { kind: string };
    expect(result.kind).toBe('invalid');
  });

  it('CLOSE_UNSUPPORTED_DATA is 1003', () => {
    expect(CLOSE_UNSUPPORTED_DATA).toBe(1003);
  });
});
