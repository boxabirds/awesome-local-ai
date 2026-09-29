import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createWithRetries } from '../../src/worker/create-board';
import { BOARD_ID_BYTES, BOARD_ID_PATTERN, newBoardId } from '../../src/shared/board-id';
import { BOARD_CREATE_LIMIT, BOARD_CREATE_PERIOD_SECONDS, CREATE_ID_MAX_ATTEMPTS } from '../../src/shared/config';

// Strips line and block comments outside strings (enough for wrangler.jsonc).
function stripJsonComments(src: string): string {
  let out = '';
  let inString = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inString) {
      out += c;
      if (c === '\\') out += src[++i];
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 1;
    } else out += c;
  }
  return out;
}

function sequence(...ids: string[]) {
  let i = 0;
  return vi.fn(() => ids[i++]);
}

describe('share.board_api: createWithRetries', () => {
  it('TC-01 a taken id is never handed out; the next free one is', async () => {
    const generate = sequence('taken-1', 'taken-2', 'free');
    const tryInitialize = vi.fn(async (id: string) => (id.startsWith('taken') ? ('exists' as const) : ('created' as const)));
    await expect(createWithRetries(generate, tryInitialize)).resolves.toEqual({ ok: true, id: 'free' });
    expect(tryInitialize.mock.calls.map((c) => c[0])).toEqual(['taken-1', 'taken-2', 'free']);
  });

  it('TC-02 fails after exactly CREATE_ID_MAX_ATTEMPTS collisions', async () => {
    const generate = vi.fn(() => 'taken');
    const tryInitialize = vi.fn(async () => 'exists' as const);
    await expect(createWithRetries(generate, tryInitialize)).resolves.toEqual({ ok: false });
    expect(tryInitialize).toHaveBeenCalledTimes(CREATE_ID_MAX_ATTEMPTS);
    expect(generate).toHaveBeenCalledTimes(CREATE_ID_MAX_ATTEMPTS);
  });
});

describe('share.board_api: settings', () => {
  it('TC-03 the wrangler rate limiter matches the named settings', () => {
    const config = JSON.parse(stripJsonComments(readFileSync('wrangler.jsonc', 'utf8')));
    const limiter = (config.ratelimits as { name: string; simple: { limit: number; period: number } }[]).find(
      (r) => r.name === 'BOARD_CREATE_LIMITER',
    );
    expect(limiter).toBeDefined();
    expect(limiter!.simple.limit).toBe(BOARD_CREATE_LIMIT);
    expect(limiter!.simple.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

describe('share.unguessable: link codes', () => {
  it('TC-04 10,000 ids: distinct, 22 characters of 128 random bits, prefixes spread uniformly', () => {
    const ids = Array.from({ length: 10_000 }, () => newBoardId());
    expect(BOARD_ID_BYTES * 8).toBeGreaterThanOrEqual(128);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toHaveLength(22);
      expect(id).toMatch(BOARD_ID_PATTERN);
    }

    // Each of the first four characters (6 random bits each) is uniform over the 64 base64url symbols:
    // chi-square with 63 degrees of freedom stays below 103.44 (p = 0.001).
    const CHI2_63_P001 = 103.44;
    for (let pos = 0; pos < 4; pos++) {
      const counts = new Map<string, number>();
      for (const id of ids) counts.set(id[pos], (counts.get(id[pos]) ?? 0) + 1);
      const expected = ids.length / 64;
      let chi2 = 0;
      for (let s = 0; s < 64; s++) {
        const symbol = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'[s];
        chi2 += ((counts.get(symbol) ?? 0) - expected) ** 2 / expected;
      }
      expect(chi2, `position ${pos}`).toBeLessThan(CHI2_63_P001);
    }

    // First-4-character prefixes: 10,000 draws into 64^4 buckets. Chance predicts a few shared pairs and
    // a triple with probability < 0.001; anything more would mean prefixes are not independent.
    const prefixes = new Map<string, number>();
    for (const id of ids) prefixes.set(id.slice(0, 4), (prefixes.get(id.slice(0, 4)) ?? 0) + 1);
    expect(Math.max(...prefixes.values())).toBeLessThanOrEqual(2);
  });
});
