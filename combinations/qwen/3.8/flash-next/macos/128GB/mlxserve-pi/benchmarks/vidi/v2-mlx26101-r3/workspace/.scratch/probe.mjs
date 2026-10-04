import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.setContent(`<div id="t" style="width:200px;height:200px;background:#eee"></div>`);

// 1. can the browser encode a webp from a canvas?
const encoded = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 320;
  c.height = 240;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#3af';
  ctx.fillRect(0, 0, 320, 240);
  ctx.fillStyle = '#f33';
  ctx.fillRect(20, 20, 100, 100);
  const webp = c.toDataURL('image/webp', 0.9);
  const png = c.toDataURL('image/png');
  const jpeg = c.toDataURL('image/jpeg', 0.95);
  return { webp: webp.slice(0, 40), webpLen: webp.length, png: png.slice(0, 30), jpeg: jpeg.slice(0, 30) };
});
console.log('encode', encoded);

// 2. can a drop event carry a real File into a listener?
await page.evaluate(() => {
  window.__got = [];
  document.addEventListener('drop', (event) => {
    window.__got.push({
      type: event.type,
      defaultPrevented: event.defaultPrevented,
      files: [...(event.dataTransfer?.files ?? [])].map((f) => ({ name: f.name, type: f.type, size: f.size })),
    });
  });
  document.addEventListener('dragover', (event) => {
    event.preventDefault();
    window.__got.push({ type: 'dragover', dt: event.dataTransfer?.types ? [...event.dataTransfer.types] : null });
  });
});
const handle = await page.evaluateHandle(() => {
  const dt = new DataTransfer();
  dt.items.add(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'shot.png', { type: 'image/png' }));
  return dt;
});
await page.locator('#t').dispatchEvent('dragover', { dataTransfer: handle });
await page.locator('#t').dispatchEvent('drop', { dataTransfer: handle });
console.log('drop', await page.evaluate(() => window.__got));
await browser.close();
