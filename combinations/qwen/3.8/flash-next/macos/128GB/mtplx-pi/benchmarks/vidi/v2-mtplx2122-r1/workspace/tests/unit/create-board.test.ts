/**
 * Story 5, `share.board_api` — the link code.
 *
 * TC-04: 10,000 `newBoardId()` calls must all be well-formed, all distinct and
 * must come from 16 bytes of cryptographic randomness (128 bits), which is what
 * makes a board link unguessable (`share.unguessable`).
 *
 * The second half of the file covers `createBoard` itself with a fake
 * `DurableObjectNamespace`: one id, one RPC, and no retry loop.
 */

import { describe, it, expect } from 'vitest'
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id'
import { createBoard, type CreateResult } from '../../src/worker/create-board'

// ── decoding ─────────────────────────────────────────────────────────────────

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/**
 * Inverse of `toBase64Url`: 22 characters must decode to exactly 16 bytes and
 * re-encode to the same string.  Anything that does not round-trip is not the
 * base64url rendering of 16 bytes, so it is not a 128-bit code.
 */
function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of text) {
    const index = BASE64URL.indexOf(char)
    if (index < 0) return null
    value = (value << 6) | index
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((value >>> bits) & 0xff)
      value &= (1 << bits) - 1
    }
  }
  if (bits !== 4 && bits !== 0) {
    // A 22-character code carries 132 bits: the last 4 are padding, and the
    // padding bits must be zero for the encoding to round-trip.
    if (value !== 0) return null
  }
  return new Uint8Array(out)
}

function bytesOf(id: string): Uint8Array {
  const bytes = fromBase64Url(id)
  expect(bytes, `id ${id} must be base64url`).not.toBeNull()
  return bytes!
}

/** Deterministic pseudo-random source, used to compare "looks random" claims. */
function byteHistogram(ids: readonly string[]): number[] {
  const histogram = new Array(256).fill(0)
  for (const id of ids) for (const byte of bytesOf(id)) histogram[byte] += 1
  return histogram
}

// ── TC-04 link code format and uniqueness ────────────────────────────────────

describe('TC-04 link code format and uniqueness', () => {
  const RUNS = 10_000

  const ids: string[] = []
  for (let i = 0; i < RUNS; i++) ids.push(newBoardId())

  it('produces codes that are all 22 characters and match BOARD_ID_PATTERN', () => {
    for (const id of ids) {
      expect(id).toHaveLength(22)
      expect(BOARD_ID_PATTERN.test(id)).toBe(true)
      expect(isValidBoardId(id)).toBe(true)
    }
  })

  it('produces 10,000 distinct codes', () => {
    expect(new Set(ids).size).toBe(RUNS)
  })

  it('never repeats a 12-character prefix either (no derived counter)', () => {
    // A sequential, time- or counter-derived code would collide here long
    // before the full code did: 12 characters is 72 bits of the same bytes.
    const prefixes = new Set(ids.map(id => id.slice(0, 12)))
    expect(prefixes.size).toBe(RUNS)
  })

  it('decodes every code back to the full 16 random bytes (128 bits)', () => {
    expect(BOARD_ID_BYTES).toBe(16)
    for (const id of ids.slice(0, 500)) {
      const bytes = bytesOf(id)
      expect(bytes).toHaveLength(16)
      // Round-trip: the 22 characters are exactly the 16 bytes, no padding
      // bits set, so nothing beyond 128 bits is smuggled into a link.
      let bits = 0
      let value = 0
      let rebuilt = ''
      for (const [index, byte] of bytes.entries()) {
        value = (value << 8) | byte
        bits += 8
        while (bits >= 6) {
          bits -= 6
          rebuilt += BASE64URL[(value >>> bits) & 0x3f]
          value &= (1 << bits) - 1
        }
        if (index === bytes.length - 1 && bits > 0) {
          rebuilt += BASE64URL[(value << (6 - bits)) & 0x3f]
        }
      }
      expect(rebuilt).toBe(id)
    }
  })

  it('spreads the random bytes evenly instead of copying a fixed pattern', () => {
    const histogram = byteHistogram(ids)
    const expected = (RUNS * BOARD_ID_BYTES) / 256 // 625
    for (const [byte, count] of histogram.entries()) {
      // ±40 % is many standard deviations away for 160,000 uniform bytes, so
      // this only fails if the source is not uniformly random over 256 values.
      expect(count, `byte ${byte.toString(16)} count ${count}`).toBeGreaterThan(expected * 0.6)
      expect(count, `byte ${byte.toString(16)} count ${count}`).toBeLessThan(expected * 1.4)
    }
  })

  it('does not derive a code from creation order, time or a previous code', () => {
    // Successive codes must differ in essentially every byte: a code built
    // from a counter, a timestamp or another id keeps long stretches equal.
    let samePrefixPairs = 0
    for (let i = 1; i < 200; i++) {
      const previous = bytesOf(ids[i - 1])
      const current = bytesOf(ids[i])
      let equalBytes = 0
      for (let b = 0; b < previous.length; b++) if (previous[b] === current[b]) equalBytes += 1
      if (equalBytes > 4) samePrefixPairs += 1
    }
    expect(samePrefixPairs).toBeLessThan(20)
  })
})

// ── createBoard (fake namespace, no Durable Object) ─────────────────────────

interface FakeNamespace {
  BOARD_ROOM: {
    idFromName(name: string): { toString(): string; name: string }
    get(id: { toString(): string; name: string }): { initialize(): Promise<string> }
  }
}

function fakeEnv(initialize: (name: string) => Promise<string>): { env: FakeNamespace; calls: string[] } {
  const calls: string[] = []
  const env: FakeNamespace = {
    BOARD_ROOM: {
      idFromName: name => ({ toString: () => `do-${name}`, name }),
      get: id => ({
        initialize: async () => {
          calls.push(id.name)
          return initialize(id.name)
        },
      }),
    },
  }
  return { env, calls }
}

describe('createBoard', () => {
  it('returns the generated id when the room reports "created"', async () => {
    const { env, calls } = fakeEnv(async () => 'created')
    const result: CreateResult = await createBoard(env as never)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(BOARD_ID_PATTERN.test(result.id)).toBe(true)
      // The id used for the Durable Object name is the id in the link.
      expect(calls).toEqual([result.id])
    }
  })

  it('fails, without retrying, when a fresh id already exists', async () => {
    const { env, calls } = fakeEnv(async () => 'exists')
    const result = await createBoard(env as never)
    expect(result).toEqual({ ok: false, reason: 'create_failed' })
    // One id, one RPC: a 128-bit collision is not handled by trying again.
    expect(calls).toHaveLength(1)
  })

  it('fails when the initialize RPC throws', async () => {
    const { env, calls } = fakeEnv(async () => {
      throw new Error('rpc exploded')
    })
    const result = await createBoard(env as never)
    expect(result).toEqual({ ok: false, reason: 'create_failed' })
    expect(calls).toHaveLength(1)
  })
})
