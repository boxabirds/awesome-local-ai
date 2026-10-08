import { describe, it, expect } from 'vitest'
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, isValidBoardId, newBoardId } from '../../src/shared/board-id'

/** base64url alphabet check that does not depend on the length rule. */
const ALPHABET_ONLY = /^[A-Za-z0-9_-]+$/

// ── TC-01 isValidBoardId ─────────────────────────────────────────────────────

describe('TC-01 isValidBoardId', () => {
  it('accepts a 22-character base64url id (the valid boundary)', () => {
    const id = newBoardId()
    expect(id).toHaveLength(22)
    expect(isValidBoardId(id)).toBe(true)
  })

  it('accepts hand-written ids that only use the base64url alphabet', () => {
    // 22 chars, includes '-' and '_' as well as digits and both cases.
    const id = `Ab3-_9${'x'.repeat(16)}`
    expect(id).toHaveLength(22)
    expect(isValidBoardId(id)).toBe(true)
    expect(BOARD_ID_PATTERN.test(id)).toBe(true)
  })

  it('rejects 21 and 23 characters (boundary values)', () => {
    const valid = newBoardId()
    expect(isValidBoardId(valid.slice(0, 21))).toBe(false)
    expect(isValidBoardId(valid + 'A')).toBe(false)
    expect(isValidBoardId('A'.repeat(21))).toBe(false)
    expect(isValidBoardId('A'.repeat(23))).toBe(false)
  })

  it('rejects characters outside the base64url alphabet', () => {
    // '+' and '/' are valid base64 but not base64url; '.' and '/' must never
    // reach a Durable Object id, and '=' is padding we never emit.
    expect(isValidBoardId(`Ab3+9${'x'.repeat(17)}`)).toBe(false)
    expect(isValidBoardId(`Ab3=9${'x'.repeat(17)}`)).toBe(false)
    expect(isValidBoardId(`ab/9${'x'.repeat(18)}`)).toBe(false)
    expect(isValidBoardId('../x')).toBe(false)
    expect(isValidBoardId('..%2f..%2fetc%2fpasswd')).toBe(false)
  })

  it('rejects the empty string and whitespace', () => {
    expect(isValidBoardId('')).toBe(false)
    expect(isValidBoardId('                     ')).toBe(false) // 21 spaces
    expect(isValidBoardId(`${'Ab3_9'.repeat(4)} `)).toBe(false)
  })

  it('generates ids of BOARD_ID_BYTES bytes (22 characters, no padding)', () => {
    expect(BOARD_ID_BYTES).toBe(16)
    const id = newBoardId()
    expect(id).toHaveLength(Math.ceil((BOARD_ID_BYTES * 8) / 6))
    expect(ALPHABET_ONLY.test(id)).toBe(true)
  })
})

// ── TC-02 newBoardId ─────────────────────────────────────────────────────────

describe('TC-02 newBoardId x 10000', () => {
  it('always matches BOARD_ID_PATTERN and never repeats', () => {
    const seen = new Set<string>()
    const runs = 10_000
    for (let i = 0; i < runs; i++) {
      const id = newBoardId()
      expect(BOARD_ID_PATTERN.test(id)).toBe(true)
      seen.add(id)
    }
    expect(seen.size).toBe(runs)
  })
})
