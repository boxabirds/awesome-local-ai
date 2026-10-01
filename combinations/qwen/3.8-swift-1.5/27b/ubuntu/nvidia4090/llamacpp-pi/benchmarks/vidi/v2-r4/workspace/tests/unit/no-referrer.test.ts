import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('TC-32: board page must not send board link as Referer', () => {
  it('index.html source contains no-referrer meta tag', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');
    expect(html).toContain('name="referrer" content="no-referrer"');
  });
});
