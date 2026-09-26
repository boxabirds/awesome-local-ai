import { describe, expect, it } from 'vitest';
import { backoffDelay } from '@/features/live/backoff';

const noJitter = () => 0.5;

describe('live.connection_status: backoff', () => {
  it('TC-O01 attempt 0 -> 1 s, 4 -> 16 s, 5 -> 30 s (cap), 50 -> 30 s', () => {
    expect(backoffDelay(0, noJitter)).toBe(1_000);
    expect(backoffDelay(4, noJitter)).toBe(16_000);
    expect(backoffDelay(5, noJitter)).toBe(30_000);
    expect(backoffDelay(50, noJitter)).toBe(30_000);
  });

  it('TC-O02 jitter at both bounds: backoff(2) is 3.2 s at random 0 and 4.8 s at random 1', () => {
    expect(backoffDelay(2, () => 0)).toBeCloseTo(3_200);
    expect(backoffDelay(2, () => 1)).toBeCloseTo(4_800);
  });
});
