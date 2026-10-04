import { chromium } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'tests/fixtures/images';
const names = readdirSync(dir).filter((n) => n !== 'generate.mjs');
const browser = await chromium.launch();
const page = await browser.newPage();
const data = names.map((n) => [n, readFileSync(join(dir, n)).toString('base64'), '']);
const out = await page.evaluate(async (entries) => {
  const result = [];
  for (const [name, b64, type] of entries) {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: type || 'image/png' });
    try {
      const bmp = await createImageBitmap(blob);
      result.push([name, bytes.length, bmp.width, bmp.height]);
    } catch (error) {
      result.push([name, bytes.length, 'no', String(error).slice(0, 30)]);
    }
  }
  return result;
}, data);
console.log(out.map((r) => r.join('\t')).join('\n'));
await browser.close();
