// Regenerates the binary fixtures in this directory: `node tests/fixtures/images/generate.mjs`.
// PNG/JPEG/WebP come from a Chromium canvas (Playwright); GIF, SVG, the renamed PDF and the truncated PNG are written by hand.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();
const make = (w, h, mime) =>
  page.evaluate(
    async ([w, h, mime]) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, '#1e88e5');
      grad.addColorStop(1, '#fb8c00');
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#fff';
      g.fillRect(w * 0.1, h * 0.1, w * 0.3, h * 0.2);
      const blob = await new Promise((r) => c.toBlob(r, mime, 0.8));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    [w, h, mime],
  );
const png = Buffer.from(await make(1440, 900, 'image/png'));
writeFileSync(join(dir, 'screenshot.png'), png);
writeFileSync(join(dir, 'photo.jpg'), Buffer.from(await make(4032, 3024, 'image/jpeg')));
writeFileSync(join(dir, 'picture.webp'), Buffer.from(await make(640, 480, 'image/webp')));
writeFileSync(join(dir, 'small.png'), Buffer.from(await make(400, 300, 'image/png')));
writeFileSync(join(dir, 'truncated.png'), png.subarray(0, 200));
await browser.close();

// 2-frame animated GIF, 2x2 pixels.
const gif = Buffer.from(
  '47494638396102000200800100000000ffffff21ff0b4e45545343415045322e30030100000021f90401000000002c00000000020002000002024401' +
    '0021f90401000000002c00000000020002000002024c01003b',
  'hex',
);
writeFileSync(join(dir, 'animated.gif'), gif);
writeFileSync(join(dir, 'script.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>\n');
writeFileSync(join(dir, 'renamed-pdf.png'), '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n');
