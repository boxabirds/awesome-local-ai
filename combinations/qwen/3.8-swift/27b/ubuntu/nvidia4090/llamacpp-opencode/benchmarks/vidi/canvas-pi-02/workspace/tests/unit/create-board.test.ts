// Story 5, share.board_api unit tests: pure creation logic — collision
// retries (TC-01, TC-02), rate-limit settings parity with wrangler.jsonc
// (TC-03) and link-code strength (TC-04).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { newBoardId, BOARD_ID_PATTERN } from '../../src/shared/board-id';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '../../src/shared/config';
import { createWithRetries } from '../../src/worker/create-board';

/** Strips // line comments and /* block comments *\/ from JSONC so the
 *  production wrangler config can be parsed by JSON.parse. */
function stripJsonc(text: string): string {
  let out = '';
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (inLineComment) {
      if (ch === '\n') {
        inLineComment = false;
        out += ch;
      }
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i++;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

describe('share.board_api (unit)', () => {
  it('TC-01: two collisions, then a free id -> the third id after 3 initialize calls', async () => {
    const taken1 = 'a'.repeat(22);
    const taken2 = 'b'.repeat(22);
    const free = 'c'.repeat(22);
    const generated = [taken1, taken2, free];
    let initializeCalls = 0;

    const result = await createWithRetries(
      () => generated[initializeCalls],
      async (id) => {
        initializeCalls += 1;
        return id === free ? 'created' : 'exists';
      },
    );

    expect(result).toEqual({ ok: true, id: free });
    expect(initializeCalls).toBe(3);
  });

  it('TC-02: every attempt collides -> failure after exactly CREATE_ID_MAX_ATTEMPTS', async () => {
    let initializeCalls = 0;
    const result = await createWithRetries(
      () => 'x'.repeat(22),
      async () => {
        initializeCalls += 1;
        return 'exists';
      },
    );

    expect(result).toEqual({ ok: false });
    expect(initializeCalls).toBe(CREATE_ID_MAX_ATTEMPTS);
  });

  it('TC-03: wrangler.jsonc BOARD_CREATE_LIMITER mirrors the named settings', () => {
    const configPath = resolve(__dirname, '../../wrangler.jsonc');
    expect(existsSync(configPath)).toBe(true);
    const config = JSON.parse(stripJsonc(readFileSync(configPath, 'utf8'))) as {
      ratelimits?: Array<{
        name: string;
        simple?: { limit: number; period: number };
      }>;
    };
    const entry = (config.ratelimits ?? []).find((r) => r.name === 'BOARD_CREATE_LIMITER');
    expect(entry).toBeDefined();
    expect(entry!.simple).toBeDefined();
    expect(entry!.simple!.limit).toBe(BOARD_CREATE_LIMIT);
    expect(entry!.simple!.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });

  it('TC-04: 10,000 ids — all unique, 22 chars, uniform 4-char prefix (chi-square p > 0.001)', () => {
    const N = 10_000;
    const seen = new Set<string>();
    const buckets = new Map<string, number>();
    for (let i = 0; i < N; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(seen.has(id)).toBe(false); // distinct codes (share.unique)
      seen.add(id);
      const prefix = id.slice(0, 4);
      buckets.set(prefix, (buckets.get(prefix) ?? 0) + 1);
    }

    // Chi-square uniformity of the first-4-char prefix. 64^4 buckets over
    // 10,000 draws gives an expected occupancy of ~0.0006, far below the
    // per-bin E>=5 rule of thumb, so bucket sizes are aggregated into four
    // classes (empty / 1 / 2 / >=3) with expectations from the Poisson
    // occupancy law, lambda = N / 64^4. df = 3; the critical value at
    // p = 0.001 is 16.266 — the bound the design requires.
    const binCount = 64 ** 4;
    const lambda = N / binCount;
    const p0 = Math.exp(-lambda);
    const p1 = lambda * p0;
    const p2 = (lambda * lambda) / 2 * p0;
    const expected = [
      binCount * p0,
      binCount * p1,
      binCount * p2,
      binCount * (1 - p0 - p1 - p2),
    ];
    const observed = [0, 0, 0, 0];
    for (const count of buckets.values()) {
      if (count === 0) observed[0] += 1;
      else if (count === 1) observed[1] += 1;
      else if (count === 2) observed[2] += 1;
      else observed[3] += 1;
    }
    observed[0] += binCount - buckets.size; // buckets never drawn are empty

    let chiSquare = 0;
    for (let i = 0; i < 4; i++) {
      chiSquare += (observed[i] - expected[i]) ** 2 / expected[i];
    }
    // Max prefix bucket is within the chi-square bound (p > 0.001).
    expect(chiSquare).toBeLessThan(16.266);
    const maxBucket = Math.max(...buckets.values());
    expect(maxBucket).toBeLessThanOrEqual(4);
  });
});
