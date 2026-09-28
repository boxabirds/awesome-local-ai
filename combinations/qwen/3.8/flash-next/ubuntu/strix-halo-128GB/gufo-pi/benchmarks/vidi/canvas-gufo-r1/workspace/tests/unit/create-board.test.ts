import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createWithRetries } from '../../src/worker/create-board';
import { newBoardId, BOARD_ID_BYTES } from '../../src/shared/board-id';
import {
  BOARD_CREATE_LIMIT,
  BOARD_CREATE_PERIOD_SECONDS,
  CREATE_ID_MAX_ATTEMPTS,
} from '../../src/shared/config';

describe('TC-01: createWithRetries returns third id after two collisions', () => {
  it('generator yields taken, taken, free → returns third id; 3 tryInitialize calls', async () => {
    const ids = ['aaa', 'bbb', 'ccc'];
    let idx = 0;
    const generate = () => ids[idx++]!;

    const calls: string[] = [];
    const tryInitialize = async (id: string): Promise<'created' | 'exists'> => {
      calls.push(id);
      if (calls.length < 3) return 'exists';
      return 'created';
    };

    const result = await createWithRetries(generate, tryInitialize, 3);
    expect(result).toEqual({ ok: true, id: 'ccc' });
    expect(calls).toEqual(['aaa', 'bbb', 'ccc']);
  });
});

describe('TC-02: createWithRetries fails after CREATE_ID_MAX_ATTEMPTS collisions', () => {
  it('generator yields taken CREATE_ID_MAX_ATTEMPTS times → {ok:false}', async () => {
    let callCount = 0;
    const generate = () => `id-${callCount}`;
    const tryInitialize = async (): Promise<'created' | 'exists'> => {
      callCount++;
      return 'exists';
    };

    const result = await createWithRetries(generate, tryInitialize);
    expect(result).toEqual({ ok: false });
    expect(callCount).toBe(CREATE_ID_MAX_ATTEMPTS);
  });
});

describe('TC-03: wrangler.jsonc ratelimits match config settings', () => {
  it('BOARD_CREATE_LIMITER limit == BOARD_CREATE_LIMIT and period == BOARD_CREATE_PERIOD_SECONDS', () => {
    const raw = readFileSync('wrangler.jsonc', 'utf-8');
    const noComments = raw.replace(/\/\/.*$/gm, '');
    const config = JSON.parse(noComments);

    const ratelimits = config.ratelimits;
    expect(ratelimits).toBeDefined();
    expect(Array.isArray(ratelimits)).toBe(true);

    const limiter = ratelimits.find((r: { name: string }) => r.name === 'BOARD_CREATE_LIMITER');
    expect(limiter).toBeDefined();
    expect(limiter.simple?.limit).toBe(BOARD_CREATE_LIMIT);
    expect(limiter.simple?.period).toBe(BOARD_CREATE_PERIOD_SECONDS);
  });
});

describe('TC-04: 10,000 newBoardId() are unique, correct length, uniformly distributed', () => {
  it('all unique, all 22 chars, chi-square prefix distribution p > 0.001', () => {
    const count = 10_000;
    const ids = new Set<string>();

    for (let i = 0; i < count; i++) {
      const id = newBoardId();
      ids.add(id);
      expect(id.length).toBe(22);
    }

    expect(ids.size).toBe(count);
    expect(BOARD_ID_BYTES).toBe(16);

    // Chi-square on first character (64 bins)
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const bins = new Array(ALPHABET.length).fill(0);
    for (const id of ids) {
      const idx = ALPHABET.indexOf(id[0]!);
      expect(idx).toBeGreaterThanOrEqual(0);
      bins[idx]++;
    }

    const expected = count / ALPHABET.length;
    let chiSquare = 0;
    for (const obs of bins) {
      chiSquare += (obs - expected) ** 2 / expected;
    }

    // df=63, critical value at p=0.001 ≈ 107.08
    expect(chiSquare).toBeLessThan(107.08);
  });
});
