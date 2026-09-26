import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { url } from '../support/http.ts';

describe('SPA served by the Worker', () => {
  it('TC-C01 GET / serves index.html with the Todoodle title and no-referrer meta', async () => {
    const res = await SELF.fetch(url('/'));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Todoodle</title>');
    expect(html).toContain('<meta name="referrer" content="no-referrer" />');
    expect(html).toMatch(/<script type="module" crossorigin src="\/assets\/[^"]+\.js"><\/script>/);
  });

  it.each(['/w', '/anything/deep'])('TC-C02 %s falls back to index.html', async (path) => {
    const index = await (await SELF.fetch(url('/'))).text();
    const res = await SELF.fetch(url(path));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(index);
  });
});
