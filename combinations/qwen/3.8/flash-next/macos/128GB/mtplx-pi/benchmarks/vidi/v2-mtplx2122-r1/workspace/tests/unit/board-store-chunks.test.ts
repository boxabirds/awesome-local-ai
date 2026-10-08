/**
 * TC-01 / TC-02 — the pure maths behind compaction, tested in isolation from
 * any database.
 */

import { describe, expect, it } from 'vitest'
import { COMPACTION_BYTES, COMPACTION_UPDATE_COUNT, SNAPSHOT_CHUNK_BYTES } from '../../src/shared/config'
import { chunkBytes, joinChunks, shouldCompact } from '../../src/worker/board-store'

function bytes(n: number): Uint8Array {
  const data = new Uint8Array(n)
  for (let i = 0; i < n; i++) data[i] = (i * 31 + 7) % 251
  return data
}

describe('TC-01 chunkBytes / joinChunks', () => {
  it('splits 0, 1, exactly one chunk and one chunk + 1 bytes into 0, 1, 1, 2 chunks', () => {
    expect(chunkBytes(bytes(0))).toHaveLength(0)
    expect(chunkBytes(bytes(1))).toHaveLength(1)
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES))).toHaveLength(1)
    expect(chunkBytes(bytes(SNAPSHOT_CHUNK_BYTES + 1))).toHaveLength(2)
  })

  it('never produces an empty chunk and never loses or duplicates a byte', () => {
    for (const size of [SNAPSHOT_CHUNK_BYTES, 1024, 1000]) {
      for (const total of [0, 1, 999, size, size + 1, size * 3 - 1, size * 3 + 1]) {
        const data = bytes(total)
        const chunks = chunkBytes(data, size)
        expect(chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)).toBe(total)
        for (const chunk of chunks) {
          expect(chunk.byteLength).toBeGreaterThan(0)
          expect(chunk.byteLength).toBeLessThanOrEqual(size)
        }
        expect(joinChunks(chunks)).toEqual(data)
      }
    }
  })

  it('round-trips byte-identically, including the empty case', () => {
    expect(joinChunks([]).byteLength).toBe(0)
    const data = bytes(SNAPSHOT_CHUNK_BYTES + 5)
    const round = joinChunks(chunkBytes(data))
    expect(round.byteLength).toBe(data.byteLength)
    expect(Array.from(round)).toEqual(Array.from(data))
  })

  it('chunks a real payload without aliasing the source buffer', () => {
    const data = bytes(2048)
    const chunks = chunkBytes(data, 1000)
    const round = joinChunks(chunks)
    // Writing through the copy must not disturb the original (chunks are copies).
    round[0] = 0xff
    expect(data[0]).not.toBe(0xff)
    for (const chunk of chunks) expect(chunk.byteOffset + chunk.byteLength).toBe(chunk.buffer.byteLength)
  })
})

describe('TC-02 shouldCompact', () => {
  it('flips exactly at COMPACTION_UPDATE_COUNT rows', () => {
    expect(shouldCompact(COMPACTION_UPDATE_COUNT - 1, 0)).toBe(false)
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, 0)).toBe(true)
  })

  it('flips exactly at COMPACTION_BYTES', () => {
    expect(shouldCompact(0, COMPACTION_BYTES - 1)).toBe(false)
    expect(shouldCompact(0, COMPACTION_BYTES)).toBe(true)
  })

  it('is false below both thresholds and true above either one', () => {
    expect(shouldCompact(0, 0)).toBe(false)
    expect(shouldCompact(1, 1)).toBe(false)
    expect(shouldCompact(0, COMPACTION_BYTES + 1)).toBe(true)
    expect(shouldCompact(COMPACTION_UPDATE_COUNT + 1, 0)).toBe(true)
    expect(shouldCompact(COMPACTION_UPDATE_COUNT, COMPACTION_BYTES)).toBe(true)
  })
})
