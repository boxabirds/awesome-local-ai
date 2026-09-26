/**
 * Story 5 — share.board_api unit tests (TC-01..TC-04).
 * No worker runtime involved: the retry loop, the wrangler binding config and
 * the id entropy are exercised directly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createWithRetries } from '@/worker/create-board';
import { newBoardId, BOARD_ID_PATTERN } from '@/shared/board-id';
import { BOARD_CREATE_LIMIT, BOARD_CREATE_PERIOD_SECONDS, CREATE_ID_MAX_ATTEMPTS } from '@/shared/config';

describe('share.board_api (unit)', () => {
  it('TC-01: createWithRetries returns the first free id, skipping collisions', async () => {
    const ids = ['taken-1', 'taken-2', 'free-1'];
    let i = 0;
    const generate = (): string => ids[i++];
    const calls: string[] = [];
    const tryInitialize = async (id: string): Promise<'created' | 'exists'> => {
      calls.push(id);
      return id === 'free-1' ? 'created' : 'exists';
    };

    const result = await createWithRetries(generate, tryInitialize);

    expect(result).toEqual({ ok: true, id: 'free-1' });
    expect(calls).toEqual(['taken-1', 'taken-2', 'free-1']);
  });

  it('TC-02: createWithRetries gives up after CREATE_ID_MAX_ATTEMPTS collisions', async () => {
    let attempts = 0;
    const result = await createWithRetries(
      () => `taken-${++attempts}`,
      async () => 'exists',
    );

    expect(result).toEqual({ ok: false });
    expect(attempts).toBe(CREATE_ID_MAX_ATTEMPTS);
  });

  it('TC-03: wrangler.jsonc declares the BOARD_CREATE_LIMITER binding matching the named settings', () => {
    const raw = readFileSync(path.resolve(__dirname, '../../wrangler.jsonc'), 'utf8');
    // wrangler.jsonc is a JSONC file: strip comments before parsing.
    const json = JSON.parse(stripJsoncComments(raw)) as {
      ratelimits?: Array<{ name: string; limit: number; period: number }>;
    };
    const binding = json.ratelimits?.find((r) => r.name === 'BOARD_CREATE_LIMITER');
    expect(binding, 'BOARD_CREATE_LIMITER ratelimits entry').toBeTruthy();
    expect(binding!.limit).toBe(BOARD_CREATE_LIMIT);
    expect(binding!.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });

  it('TC-04: 10,000 newBoardId() values are unique, 22 chars, and uniformly distributed', () => {
    const n = 10_000;
    const seen = new Set<string>();
    const prefixCounts = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const id = newBoardId();
      expect(id).toMatch(BOARD_ID_PATTERN);
      expect(seen.has(id), `duplicate id ${id}`).toBe(false);
      seen.add(id);
      const prefix = id.slice(0, 4);
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }

    // Chi-square goodness-of-fit over the 4-char base64url prefix space
    // (4,096^2 = 16,777,216 buckets; Wilson–Hilferty normal approximation).
    const buckets = 4096 ** 2;
    const e = n / buckets;
    let stat = 0;
    for (const count of prefixCounts.values()) stat += (count - e) ** 2 / e;
    stat += (buckets - prefixCounts.size) * e; // empty buckets: (0 - e)^2 / e = e
    const p = chiSquareSurvival(stat, buckets - 1);
    expect(p, `chi-square p-value ${p}`).toBeGreaterThan(0.001);
  });
});

/** Removes // and /* … *\/ comments from JSONC without touching string contents. */
function stripJsoncComments(src: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < src.length) {
    const ch = src[i];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += src[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function normCdf(z: number): number {
  // Abramowitz & Stegun 7.1.26 erf approximation.
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

/** P(X > stat) for X ~ chi-square(df), Wilson–Hilferty normal approximation. */
function chiSquareSurvival(stat: number, df: number): number {
  const x3 = Math.cbrt(stat / df);
  const z = (x3 - (1 - 2 / (9 * df))) / Math.sqrt(2 / (9 * df));
  return 1 - normCdf(z);
}
