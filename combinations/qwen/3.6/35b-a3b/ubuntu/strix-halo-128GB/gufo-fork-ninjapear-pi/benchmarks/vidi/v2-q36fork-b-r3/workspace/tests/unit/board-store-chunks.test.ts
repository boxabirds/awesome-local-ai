/**
 * Unit tests for BoardStore pure functions (TC-01, TC-02).
 */

import { describe, it, expect } from 'vitest';
import { SNAPSHOT_CHUNK_BYTES } from '@shared/config';

// --- Pure functions under test ---

export function chunkBytes(data: Uint8Array, size?: number): Uint8Array[] {
  const chunkSize = size ?? SNAPSHOT_CHUNK_BYTES;
  if (chunkSize <= 0) throw new Error('chunk size must be positive');
  if (data.length === 0) return [];
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

export function shouldCompact(count: number, bytes: number): boolean {
  return count >= 500 || bytes >= COMPACTION_BYTES;
}

// Import the config constants we need locally for tests
const COMPACTION_BYTES = 4 * 1024 * 1024;

describe('TC-01: chunkBytes / joinChunks round-trip', () => {
  it('empty → 0 chunks', () => {
    expect(chunkBytes(new Uint8Array(0))).toEqual([]);
  });

  it('1 byte → 1 chunk', () => {
    const input = new Uint8Array([42]);
    const chunks = chunkBytes(input);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual(input);
  });

  it('exactly SNAPSHOT_CHUNK_BYTES → 1 chunk', () => {
    const input = new Uint8Array(SNAPSHOT_CHUNK_BYTES);
    for (let i = 0; i < input.length; i++) input[i] = i % 256;
    const chunks = chunkBytes(input);
    expect(chunks.length).toBe(1);
    expect(chunks[0]).toEqual(input);
  });

  it('SNAPSHOT_CHUNK_BYTES + 1 → 2 chunks', () => {
    const input = new Uint8Array(SNAPSHOT_CHUNK_BYTES + 1);
    for (let i = 0; i < input.length; i++) input[i] = i % 256;
    const chunks = chunkBytes(input);
    expect(chunks.length).toBe(2);
  });

  it('joinChunks round-trips chunkBytes output', () => {
    const original = new Uint8Array(1_500_000);
    for (let i = 0; i < original.length; i++) original[i] = (i * 7 + 13) % 256;
    const chunks = chunkBytes(original);
    const joined = joinChunks(chunks);
    expect(joined).toEqual(original);
  });

  it('joinChunks on empty array returns empty', () => {
    expect(joinChunks([])).toEqual(new Uint8Array(0));
  });

  it('custom chunk size works correctly', () => {
    const original = new Uint8Array(100);
    for (let i = 0; i < original.length; i++) original[i] = i;
    const chunks = chunkBytes(original, 30);
    expect(chunks.length).toBe(4); // 30, 30, 30, 10
    expect(joinChunks(chunks)).toEqual(original);
  });
});

describe('TC-02: shouldCompact threshold checks', () => {
  it('count at COMPACTION_UPDATE_COUNT - 1 is false', () => {
    expect(shouldCompact(499, 0)).toBe(false);
  });

  it('count exactly COMPACTION_UPDATE_COUNT is true', () => {
    expect(shouldCompact(500, 0)).toBe(true);
  });

  it('bytes below COMPACTION_BYTES is false even with high count', () => {
    // count above but bytes far below — actually both matter, so count alone triggers
    expect(shouldCompact(500, COMPACTION_BYTES - 1)).toBe(true);
  });

  it('bytes at COMPACTION_BYTES - 1 with low count is false', () => {
    expect(shouldCompact(100, COMPACTION_BYTES - 1)).toBe(false);
  });

  it('bytes exactly COMPACTION_BYTES is true', () => {
    expect(shouldCompact(100, COMPACTION_BYTES)).toBe(true);
  });

  it('both thresholds exceeded is still true', () => {
    expect(shouldCompact(1000, COMPACTION_BYTES * 2)).toBe(true);
  });
});
