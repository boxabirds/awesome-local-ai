import { chromium } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dir = 'tests/fixtures/images';
const b = await chromium.launch();
const p = await b.newPage();
for (const name of readdirSync(dir).filter((n) => n !== 'generate.mjs')) {
  const data = [...readFileSync(join(dir, name))];
  const r = await p.evaluate(async ([bytes, n]) => {
    const blob = new Blob([new Uint8Array(bytes)]);
    try {
      const bmp = await createImageBitmap(blob);
      return `${n}: ${bmp.width}x${bmp.height}`;
    } catch (e) {
      return `${n}: FAILED ${e.message}`;
    }
  }, [data, name]);
  console.log(r);
}
await b.close();
