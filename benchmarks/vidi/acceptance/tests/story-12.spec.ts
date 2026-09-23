// Story 12 — Drop images onto the board.
import { test, expect, requires, openBoard, joinBoard, box, shot, mod } from './fixtures';
import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';

const LIVE_MS = 2_000;
const UPLOAD_MS = 15_000;
const PIXEL_TOLERANCE = 2;
const IMAGE_MAX_PLACE_SIZE_WORLD = 800;
const IMAGE_LAYOUT_GAP_WORLD = 24;
const WIDE_W = 1600, WIDE_H = 800;     // scales to 800 × 400
const SMALL_W = 200, SMALL_H = 100;    // placed at natural size
const RGBA = 4;
const FILL = 0x7f;

function pngBytes(w: number, h: number): Buffer {
  const png = new PNG({ width: w, height: h });
  png.data.fill(FILL);
  for (let i = 3; i < png.data.length; i += RGBA) png.data[i] = 0xff;
  return PNG.sync.write(png);
}
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

const images = (p: Page) => p.locator('img[alt="Image"]');
const toast = (p: Page, text: string) => p.getByText(text);

async function pick(p: Page, files: { name: string; mimeType: string; buffer: Buffer }[]) {
  const chooser = p.waitForEvent('filechooser');
  await p.keyboard.press('i');
  await (await chooser).setFiles(files);
}

// Synthesise an OS file drop at a screen point.
async function dropFiles(p: Page, at: { x: number; y: number }, files: { name: string; type: string; b64: string }[]) {
  await p.evaluate(({ at, files }) => {
    const dt = new DataTransfer();
    for (const f of files) {
      const bin = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bin], f.name, { type: f.type }));
    }
    const target = document.elementFromPoint(at.x, at.y) ?? document.body;
    for (const type of ['dragenter', 'dragover', 'drop']) {
      target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, dataTransfer: dt }));
    }
  }, { at, files });
}

test.describe('story 12 @s12', () => {
  test.beforeEach(() => requires(12));

  test('Image tool picks a file; it uploads and appears for everyone @ref prd:image.picker prd:image.everyone', async ({ newPerson }) => {
    const leo = await newPerson();
    const colleague = await newPerson();
    const url = await openBoard(leo);
    await joinBoard(colleague, url);
    await pick(leo, [{ name: 'small.png', mimeType: 'image/png', buffer: pngBytes(SMALL_W, SMALL_H) }]);
    await expect(images(leo)).toHaveCount(1, { timeout: UPLOAD_MS });
    await expect(images(colleague)).toHaveCount(1, { timeout: UPLOAD_MS + LIVE_MS });
    const b = await box(images(leo).first());
    expect(Math.abs(b.width - SMALL_W)).toBeLessThan(PIXEL_TOLERANCE);
    expect(Math.abs(b.height - SMALL_H)).toBeLessThan(PIXEL_TOLERANCE);
    await shot(leo, 's12-picked');
  });

  test('large image is scaled so its longest side is 800 units @ref prd:image.size', async ({ page }) => {
    await openBoard(page);
    await page.getByRole('button', { name: 'Zoom out' }).click();
    await page.getByRole('button', { name: 'Zoom out' }).click();
    const zoom = Number((await page.getByText(/^\d+%$/).first().innerText()).replace('%', '')) / 100;
    await pick(page, [{ name: 'wide.png', mimeType: 'image/png', buffer: pngBytes(WIDE_W, WIDE_H) }]);
    await expect(images(page)).toHaveCount(1, { timeout: UPLOAD_MS });
    const b = await box(images(page).first());
    expect(Math.abs(b.width - IMAGE_MAX_PLACE_SIZE_WORLD * zoom)).toBeLessThan(PIXEL_TOLERANCE);
    expect(Math.abs(b.height - (IMAGE_MAX_PLACE_SIZE_WORLD / 2) * zoom)).toBeLessThan(PIXEL_TOLERANCE);
  });

  test('dropped files are placed left to right from the drop point @ref prd:image.drop', async ({ page }) => {
    await openBoard(page);
    const b64 = pngBytes(SMALL_W, SMALL_H).toString('base64');
    const at = { x: 300, y: 300 };
    await dropFiles(page, at, [
      { name: 'a.png', type: 'image/png', b64 },
      { name: 'b.png', type: 'image/png', b64 },
    ]);
    await expect(images(page)).toHaveCount(2, { timeout: UPLOAD_MS });
    const boxes = (await Promise.all([0, 1].map((i) => box(images(page).nth(i))))).sort((p, q) => p.x - q.x);
    expect(Math.abs(boxes[0].x - at.x)).toBeLessThan(PIXEL_TOLERANCE);
    expect(Math.abs(boxes[0].y - at.y)).toBeLessThan(PIXEL_TOLERANCE);
    expect(Math.abs(boxes[1].x - (boxes[0].x + SMALL_W + IMAGE_LAYOUT_GAP_WORLD))).toBeLessThan(PIXEL_TOLERANCE);
  });

  test('unsupported content is refused by content, supported sibling still added @ref prd:image.types', async ({ page }) => {
    await openBoard(page);
    await pick(page, [
      { name: 'fake.png', mimeType: 'image/png', buffer: PDF_BYTES },
      { name: 'real.png', mimeType: 'image/png', buffer: pngBytes(SMALL_W, SMALL_H) },
    ]);
    await expect(toast(page, 'Only PNG, JPEG, GIF and WebP images can be added.')).toBeVisible();
    await expect(images(page)).toHaveCount(1, { timeout: UPLOAD_MS });
  });

  test('image persists after reload and undo removes insertion in one step @ref prd:image.persist prd:image.undo', async ({ page }) => {
    await openBoard(page);
    await pick(page, [{ name: 'keep.png', mimeType: 'image/png', buffer: pngBytes(SMALL_W, SMALL_H) }]);
    await expect(images(page)).toHaveCount(1, { timeout: UPLOAD_MS });
    await page.waitForTimeout(LIVE_MS);
    await page.reload();
    await expect(images(page)).toHaveCount(1, { timeout: UPLOAD_MS });
    await pick(page, [{ name: 'undo.png', mimeType: 'image/png', buffer: pngBytes(SMALL_W, SMALL_H) }]);
    await expect(images(page)).toHaveCount(2, { timeout: UPLOAD_MS });
    await page.mouse.click(1100, 700);
    await page.keyboard.press(`${mod}+KeyZ`);
    await expect(images(page)).toHaveCount(1);
  });
});
