/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('workers pool', () => {
  it('serves the client through the real Worker', async () => {
    const response = await SELF.fetch('http://example.com/b/ABCDEFGHabcdefgh0123-_');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('<div id="root">');
  });
});
