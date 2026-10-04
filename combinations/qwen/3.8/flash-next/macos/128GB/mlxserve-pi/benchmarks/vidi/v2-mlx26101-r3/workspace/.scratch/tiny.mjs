import { chromium } from '@playwright/test';
const b = await chromium.launch();
const p = await b.newPage();
const r = await p.evaluate(() => {
  const c = document.createElement('canvas'); c.width = 16; c.height = 12;
  const x = c.getContext('2d');
  x.fillStyle = '#123456'; x.fillRect(0,0,16,12);
  x.fillStyle = '#abcdef'; x.fillRect(2,2,6,6);
  const webp = c.toDataURL('image/webp', 0.8).split(',')[1];
  const jpeg = c.toDataURL('image/jpeg', 0.7).split(',')[1];
  return { webp, jpeg };
});
console.log('webp b64 len', r.webp.length);
console.log('jpeg b64 len', r.jpeg.length);
console.log('WEBP=' + r.webp);
console.log('JPEG=' + r.jpeg);
require('node:fs').writeFileSync('.scratch/tiny.json', JSON.stringify(r));
await b.close();
