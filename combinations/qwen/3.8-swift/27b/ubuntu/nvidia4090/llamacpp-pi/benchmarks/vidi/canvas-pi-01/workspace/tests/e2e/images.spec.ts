// Story 12 e2e: images (TC-25 to TC-28).
//
// Runs against `wrangler dev` (see playwright.config.ts): real R2, real
// y-websocket BoardRoom, real XHR uploads. Fixture images are the
// base64-embedded files from tests/fixtures/images (magic bytes are real,
// so the worker's sniff accepts them).

import { expect, test, type Page } from '@playwright/test';
import { dropFiles } from './helpers/drop-files';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ANIMATED_GIF,
  PHOTO_PNG,
  RENAMED_PDF,
  SCREENSHOT_PNG,
  WIDE_PNG,
} from '../fixtures/images';
import {
  closeParticipant,
  createFreshBoard,
  expectWithin,
  openParticipant,
} from './helpers/participants';
import { IMAGE_MIN_SIZE_WORLD, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';

const FIXTURES = {
  screenshot: { name: SCREENSHOT_PNG.name, type: SCREENSHOT_PNG.type, b64: Buffer.from(SCREENSHOT_PNG.bytes).toString('base64') },
  photo: { name: PHOTO_PNG.name, type: PHOTO_PNG.type, b64: Buffer.from(PHOTO_PNG.bytes).toString('base64') },
  wide: { name: WIDE_PNG.name, type: WIDE_PNG.type, b64: Buffer.from(WIDE_PNG.bytes).toString('base64') },
  gif: { name: ANIMATED_GIF.name, type: ANIMATED_GIF.type, b64: Buffer.from(ANIMATED_GIF.bytes).toString('base64') },
} as const;

interface WorldImage {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: string;
  assetKey: string | null;
}

/** The image objects in the page's Y.Doc (world state). */
async function worldImages(page: Page): Promise<WorldImage[]> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (hook === undefined) throw new Error('window.__vidi6 test hook is not available');
    const objects = hook.getDoc().getMap('objects');
    const out: WorldImage[] = [];
    for (const key of objects.keys()) {
      const o = objects.get(key) as import('yjs').Map<unknown>;
      if (o.get('type') !== 'image') continue;
      out.push({
        id: String(key),
        x: o.get('x') as number,
        y: o.get('y') as number,
        width: o.get('width') as number,
        height: o.get('height') as number,
        status: String(o.get('status')),
        assetKey: (o.get('assetKey') as string | null) ?? null,
      });
    }
    return out;
  });
}

/** Real drag-and-drop of the named fixtures onto the viewport at (x, y). */
async function dropFixtures(page: Page, names: (keyof typeof FIXTURES)[], x: number, y: number): Promise<void> {
  await dropFiles(page, names.map((n) => FIXTURES[n]), x, y);
}

/** The toasts currently visible. */
async function toastTexts(page: Page): Promise<string[]> {
  return page.locator('[data-testid="toast"]').allTextContents();
}

test('TC-25 drop three images: uploader and peer see placeholders, then loaded images within budget', async ({ browser, request }) => {
  const boardId = await createFreshBoard(request);
  const sam = await openParticipant(browser, boardId);
  const jo = await openParticipant(browser, boardId);
  try {
    await dropFixtures(sam.page, ['screenshot', 'photo', 'wide'], 300, 200);

    // Sam: three uploading placeholders immediately.
    await expectWithin(async () => (await worldImages(sam.page)).length === 3);
    for (const img of await worldImages(sam.page)) {
      expect(img.status).toBe('uploading');
    }

    // Jo (peer): the same placeholders arrive, with "Uploading…" text.
    await expectWithin(async () => (await worldImages(jo.page)).length === 3);
    await expect(jo.page.locator('[data-testid="image-uploading"]').first()).toBeVisible();

    // Both clients: uploads finish and the images load within budget.
    await expect.poll(
      async () => (await worldImages(sam.page)).every((i) => i.status === 'ready'),
      { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 3, intervals: [25] },
    ).toBeTruthy();
    await expect(sam.page.locator('[data-testid="image-img"]')).toHaveCount(3);
    await expect.poll(
      async () => (await worldImages(jo.page)).every((i) => i.status === 'ready'),
      { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 3, intervals: [25] },
    ).toBeTruthy();
    await expect(jo.page.locator('[data-testid="image-img"]')).toHaveCount(3);

    // The served bytes are the fixture bytes (R2 round trip).
    const assetKey = (await worldImages(sam.page))[0]!.assetKey;
    expect(assetKey).not.toBeNull();
    const resp = await sam.page.request.get(`/api/assets/${assetKey}`);
    expect(resp.status()).toBe(200);
    expect(resp.headers()['cache-control']).toContain('immutable');
    expect(Buffer.from(await resp.body()).subarray(0, 8)).toEqual(
      Buffer.from(SCREENSHOT_PNG.bytes).subarray(0, 8),
    );
  } finally {
    await closeParticipant(sam);
    await closeParticipant(jo);
  }
});

test('TC-26 picker: valid image added, renamed PDF and 11 MB file rejected with toasts', async ({ browser, request }) => {
  const boardId = await createFreshBoard(request);
  const sam = await openParticipant(browser, boardId);
  try {
    // Press I → the (hidden) file input appears.
    await sam.page.keyboard.press('i');
    const input = sam.page.locator('input[type="file"]');
    await expect(input).toBeAttached();

    // The 11 MB file is written to a temp path (Playwright serves it to the
    // browser for setInputFiles).
    const bigPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vidi6-big-')), 'big.png');
    // PNG header + enough filler to exceed 10 MB.
    const head = Buffer.from(PHOTO_PNG.bytes).subarray(0, 8);
    const filler = Buffer.alloc(11 * 1024 * 1024 - head.length, 0);
    fs.writeFileSync(bigPath, Buffer.concat([head, filler]));

    const pdfPath = path.join(path.dirname(bigPath), 'renamed.pdf.png');
    fs.writeFileSync(pdfPath, RENAMED_PDF.bytes);
    const photoPath = path.join(path.dirname(bigPath), PHOTO_PNG.name);
    fs.writeFileSync(photoPath, PHOTO_PNG.bytes);

    await input.setInputFiles([photoPath, pdfPath, bigPath]);

    // Exactly one image object, created ready (upload of the small file).
    await expect.poll(
      async () => {
        const imgs = await worldImages(sam.page);
        return imgs.length === 1 && imgs[0]!.status === 'ready';
      },
      { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 3, intervals: [25] },
    ).toBeTruthy();

    const texts = await toastTexts(sam.page);
    expect(texts).toContain(REJECTION_MESSAGES.type);
    expect(texts).toContain(REJECTION_MESSAGES.size);
  } finally {
    await closeParticipant(sam);
  }
});

test('TC-27 resize keeps aspect ratio and floor; the image survives a reload', async ({ browser, request }) => {
  const boardId = await createFreshBoard(request);
  const sam = await openParticipant(browser, boardId);
  {
    await dropFixtures(sam.page, ['photo'], 300, 200);
    await expect.poll(
      async () => (await worldImages(sam.page))[0]?.status === 'ready',
      { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 3, intervals: [25] },
    ).toBeTruthy();

    const before = (await worldImages(sam.page))[0]!;
    const ratioBefore = before.width / before.height;

    // Select the image and drag the SE corner handle far out.
    await sam.page.locator('[data-testid="image-object"]').click();
    const handle = sam.page.locator('[data-handle="se"]');
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    if (box === null) throw new Error('no handle box');
    await sam.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sam.page.mouse.down();
    await sam.page.mouse.move(box.x + 300, box.y + 300, { steps: 10 });
    await sam.page.mouse.up();

    const after = (await worldImages(sam.page))[0]!;
    const ratioAfter = after.width / after.height;
    // Aspect ratio preserved within 1%.
    expect(Math.abs(ratioAfter - ratioBefore) / ratioBefore).toBeLessThan(0.01);
    // Grew.
    expect(after.width).toBeGreaterThan(before.width);

    // Shrink below the floor: the floor (IMAGE_MIN_SIZE_WORLD) holds.
    const box2 = await handle.boundingBox();
    if (box2 === null) throw new Error('no handle box (2)');
    await sam.page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
    await sam.page.mouse.down();
    await sam.page.mouse.move(box2.x - 500, box2.y - 500, { steps: 10 });
    await sam.page.mouse.up();
    const shrunk = (await worldImages(sam.page))[0]!;
    expect(shrunk.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    expect(shrunk.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);

    // Reload in a fresh context: the object and its asset persist.
    await closeParticipant(sam);
    const reloaded = await openParticipant(browser, boardId);
    try {
      await expect.poll(
        async () => (await worldImages(reloaded.page)).length,
        { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 3, intervals: [25] },
      ).toBe(1);
      const imgs = await worldImages(reloaded.page);
      expect(imgs[0]!.status).toBe('ready');
      expect(imgs[0]!.width).toBe(shrunk.width);
      await expect(reloaded.page.locator('[data-testid="image-img"]')).toHaveCount(1);
      const img = reloaded.page.locator('[data-testid="image-img"]');
      await expect(img).toHaveAttribute('src', `/api/assets/${imgs[0]!.assetKey}`);
    } finally {
      await closeParticipant(reloaded);
    }
  }
});


test('TC-28 aborted upload fails, then Retry succeeds when the route is restored', async ({ browser, request }) => {
  const boardId = await createFreshBoard(request);
  const sam = await openParticipant(browser, boardId);
  try {
    // Break the upload route.
    await sam.page.route('**/api/boards/*/assets', (route) => route.abort());

    await dropFixtures(sam.page, ['screenshot'], 300, 200);
    await expect(sam.page.locator('[data-testid="image-failed"]')).toBeVisible();
    expect(await toastTexts(sam.page)).toHaveLength(0); // no toast for network failure

    // Restore the route and Retry.
    await sam.page.unroute('**/api/boards/*/assets');
    await sam.page.locator('[data-testid="image-retry"]').click();
    await expect(sam.page.locator('[data-testid="image-img"]')).toBeVisible();
    await expect.poll(
      async () => (await worldImages(sam.page))[0]?.status === 'ready',
      { timeout: LIVE_UPDATE_LATENCY_BUDGET_MS * 3, intervals: [25] },
    ).toBeTruthy();
  } finally {
    await closeParticipant(sam);
  }
});
