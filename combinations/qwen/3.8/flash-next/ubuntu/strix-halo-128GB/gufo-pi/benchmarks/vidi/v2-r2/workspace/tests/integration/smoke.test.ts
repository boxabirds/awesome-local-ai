/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect } from 'vitest';
import { SELF, env } from 'cloudflare:test';

describe('smoke', () => {
  it('has env bindings', () => {
    // vitest-pool-workers normalizes DO binding names to SCREAMING_SNAKE_CASE in test env
    expect((env as Record<string, unknown>)['BOARD_ROOM']).toBeDefined();
    expect(env.ASSETS).toBeDefined();
  });
  it('SELF is available', async () => {
    const res = await SELF.fetch('http://x.invalid/');
    expect(res.status).toBeLessThan(500);
  });
});
