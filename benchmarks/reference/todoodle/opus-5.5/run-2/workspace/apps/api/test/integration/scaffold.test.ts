import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { ORIGIN } from '../helpers';

describe('single Worker serving the SPA', () => {
  it('TC-C01 / serves index.html for the Todoodle app', async () => {
    const res = await SELF.fetch(`${ORIGIN}/`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>Todoodle</title>');
    expect(html).toContain('<div id="root"></div>');
  });

  it.each(['/w', '/anything/deep'])('TC-C02 %s falls back to the SPA index', async (path) => {
    const res = await SELF.fetch(`${ORIGIN}${path}`, { headers: { 'Sec-Fetch-Mode': 'navigate' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>Todoodle</title>');
  });
});
