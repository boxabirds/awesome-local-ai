/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createWithRetries } from '../../src/worker/create-board';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT, BOARD_CREATE_PERIOD_SECONDS, CREATE_ID_MAX_ATTEMPTS } from '../../src/shared/config';

const GENERATED = 10_000;
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
/** Chi-square critical value for 63 degrees of freedom at p = 0.001. */
const CHI_SQUARE_63_P001 = 103.44;
/**
 * Among 10,000 uniform ids, three sharing a 4-character prefix (24 bits) happens with
 * p ≈ C(10000, 3) / 2^48 ≈ 0.0006 < 0.001, so a bucket of 3 or more fails the check.
 */
const MAX_SHARED_PREFIX4 = 2;
const PREFIX_POSITIONS = 4;

function sequence(ids: string[]): () => string {
  let i = 0;
  return () => ids[i++] ?? `unexpected-${i}`;
}

/** Removes `//` and block comments outside strings (JSONC → JSON). */
function stripJsonComments(text: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inString) {
      out += c;
      if (c === '\\') out += text[++i] ?? '';
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else out += c;
  }
  return out.replace(/,(\s*[}\]])/g, '$1');
}

describe('createWithRetries (share.board_api, share.unique)', () => {
  it('TC-01 skips ids that are taken and returns the third, after 3 initialize calls', async () => {
    const taken = new Set(['taken-1', 'taken-2']);
    const tryInitialize = vi.fn(async (id: string) => (taken.has(id) ? ('exists' as const) : ('created' as const)));
    const result = await createWithRetries(sequence(['taken-1', 'taken-2', 'free-3']), tryInitialize, 3);
    expect(result).toEqual({ ok: true, id: 'free-3' });
    expect(tryInitialize.mock.calls.map((c) => c[0])).toEqual(['taken-1', 'taken-2', 'free-3']);
  });

  it(`TC-02 fails after exactly CREATE_ID_MAX_ATTEMPTS (${CREATE_ID_MAX_ATTEMPTS}) collisions`, async () => {
    const tryInitialize = vi.fn(async () => 'exists' as const);
    const ids = Array.from({ length: CREATE_ID_MAX_ATTEMPTS + 1 }, (_, i) => `taken-${i}`);
    const result = await createWithRetries(sequence(ids), tryInitialize);
    expect(result).toEqual({ ok: false });
    expect(tryInitialize).toHaveBeenCalledTimes(CREATE_ID_MAX_ATTEMPTS);
  });

  it('succeeds on the last allowed attempt', async () => {
    const ids = Array.from({ length: CREATE_ID_MAX_ATTEMPTS }, (_, i) => `id-${i}`);
    const last = ids[ids.length - 1]!;
    const result = await createWithRetries(sequence(ids), async (id) => (id === last ? 'created' : 'exists'));
    expect(result).toEqual({ ok: true, id: last });
  });

  it('propagates an initialize failure (the caller answers 500)', async () => {
    await expect(createWithRetries(() => 'x', async () => Promise.reject(new Error('rpc down')))).rejects.toThrow('rpc down');
  });
});

describe('rate limit settings (share.rate_limit)', () => {
  it('TC-03 wrangler.jsonc BOARD_CREATE_LIMITER mirrors BOARD_CREATE_LIMIT and BOARD_CREATE_PERIOD_SECONDS', () => {
    const config = JSON.parse(stripJsonComments(readFileSync('wrangler.jsonc', 'utf8'))) as {
      ratelimits?: { name: string; simple: { limit: number; period: number } }[];
    };
    const limiter = config.ratelimits?.find((r) => r.name === 'BOARD_CREATE_LIMITER');
    expect(limiter).toBeDefined();
    expect(limiter!.simple.limit).toBe(BOARD_CREATE_LIMIT);
    expect(limiter!.simple.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

describe('link codes (share.unguessable)', () => {
  it(`TC-04 ${GENERATED} newBoardId() are unique, 22 chars of 128 bits, with uniform prefixes`, () => {
    expect(BOARD_ID_BYTES * 8).toBeGreaterThanOrEqual(128);
    const ids = Array.from({ length: GENERATED }, () => newBoardId());
    expect(new Set(ids).size).toBe(GENERATED);
    for (const id of ids) {
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
    }

    // Each of the first 4 characters is a full 6-bit group: uniform over 64 symbols.
    const expected = GENERATED / BASE64URL.length;
    for (let pos = 0; pos < PREFIX_POSITIONS; pos++) {
      const counts = new Array<number>(BASE64URL.length).fill(0);
      for (const id of ids) counts[BASE64URL.indexOf(id[pos]!)]! += 1;
      const chiSquare = counts.reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
      expect(chiSquare, `position ${pos}`).toBeLessThan(CHI_SQUARE_63_P001);
    }

    // No 4-character prefix is shared by more ids than chance predicts.
    const prefixes = new Map<string, number>();
    for (const id of ids) prefixes.set(id.slice(0, PREFIX_POSITIONS), (prefixes.get(id.slice(0, PREFIX_POSITIONS)) ?? 0) + 1);
    expect(Math.max(...prefixes.values())).toBeLessThanOrEqual(MAX_SHARED_PREFIX4);
  });

  it('ids are not derived from time or order: consecutive ids share no more than chance', () => {
    const a = newBoardId();
    const b = newBoardId();
    expect(a).not.toBe(b);
    let common = 0;
    while (common < a.length && a[common] === b[common]) common++;
    expect(common).toBeLessThan(PREFIX_POSITIONS);
  });
});
