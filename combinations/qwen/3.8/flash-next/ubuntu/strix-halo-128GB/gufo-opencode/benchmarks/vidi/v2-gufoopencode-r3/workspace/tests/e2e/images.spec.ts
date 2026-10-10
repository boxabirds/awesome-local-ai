import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURES = new URL('../fixtures/images/', import.meta.url);
import { expect, test, type Page } from '@playwright/test';
import { IMAGE_MAX_BYTES, IMAGE_MIN_SIZE_WORLD } from '../../src/shared/config';
import { openParticipants, LatencyRecorder } from './helpers/participants';
import { dragBy } from './helpers/board';

interface ImageState {
  id: string;
  status: string;
  assetKey: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

async function getImages(page: Page): Promise<ImageState[]> {
  return page.evaluate(() => {
    const hook = window.__vidi6;
    if (!hook) throw new Error('window.__vidi6 missing; run the test build (MODE=test)');
    return hook.getImages().map((s) => ({
      id: s.id,
      status: s.status,
      assetKey: s.assetKey,
      x: s.x,
      y: s.y,
      width: s.width!,
      height: s.height!,
      naturalWidth: s.naturalWidth,
      naturalHeight: s.naturalHeight
    }));
  });
}

function fixtureBase64(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, FIXTURES))).toString('base64');
}

// Chromium lets a page build a real DataTransfer with real Files, which is
// exactly what the drop handlers read; React's delegation picks the events
// up from .board-root like any real drag.
async function dropFiles(
  page: Page,
  files: { name: string; type: string; b64: string }[],
  x: number,
  y: number,
  phases: readonly string[] = ['dragenter', 'dragover', 'drop']
): Promise<void> {
  await page.evaluate(
    async ({ files, x, y, phases }) => {
      const root = document.querySelector('.board-root');
      if (root === null) throw new Error('no .board-root');
      const dt = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
        dt.items.add(new File([bytes], f.name, { type: f.type }));
      }
      for (const phase of phases) {
        root.dispatchEvent(
          new DragEvent(phase, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: dt })
        );
      }
    },
    { files, x, y, phases }
  );
}

function screenshotFixtures() {
  return [
    { name: 'screenshot.png', type: 'image/png', b64: fixtureBase64('screenshot.png') },
    { name: 'photo.webp', type: 'image/webp', b64: fixtureBase64('photo.webp') },
    { name: 'animation.gif', type: 'image/gif', b64: fixtureBase64('animation.gif') }
  ];
}

function imageEls(page: Page) {
  return page.locator('img.image-object-img');
}

test.describe('images', () => {
  // TC-25: drag three screenshots; colleague sees Uploading placeholders
  // then the images. Drop-to-visible latency is reported, never asserted.
  test('TC-25 drop three files, colleague sees placeholders then images', async ({
    browser
  }) => {
    const [leo, sam] = await openParticipants(browser, ['leo', 'sam']);
    // Hold uploads so the intermediate Uploading state is observable.
    await leo.page.route('**/api/boards/*/assets', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });

    const highlight = leo.page.getByTestId('drop-highlight');
    await dropFiles(leo.page, screenshotFixtures(), 500, 400, ['dragenter']);
    await expect(highlight).toBeVisible();

    const rec = new LatencyRecorder();
    await rec.measure(
      'drop three images → all visible on the colleague',
      async () => {
        await dropFiles(leo.page, screenshotFixtures(), 500, 400);
        // While the uploads are held open, each peer sees the right state:
        // the uploader a progress bar, the colleague Uploading placeholders.
        await expect(leo.page.locator('.image-object--uploading .image-progress-label')).toHaveCount(3);
        await expect(sam.page.getByText('Uploading…')).toHaveCount(3);
      },
      async () => (await imageEls(sam.page).count()) === 3
    );
    await expect(highlight).toBeHidden();

    // The uploader's own placeholders had a progress UI while uploads ran.
    await expect(imageEls(leo.page)).toHaveCount(3);
    await expect
      .poll(async () => (await getImages(leo.page)).filter((i) => i.status === 'ready').length)
      .toBe(3);
    expect(await getImages(sam.page)).toHaveLength(3);
    // Placeholders were side by side in a row: x in document order rises,
    // tops are aligned.
    const imgs = await getImages(sam.page);
    const xs = imgs.map((i) => i.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(imgs.map((i) => i.y)).size).toBe(1);
    await leo.context.close();
    await sam.context.close();
  });

  // TC-26: I opens the picker; mixed selection adds one image and toasts
  // the type and size refusals.
  test('TC-26 picker with one valid file, a renamed PDF and an 11 MB file', async ({
    browser
  }) => {
    const [leo] = await openParticipants(browser, ['leo']);
    const chooserPromise = leo.page.waitForEvent('filechooser');
    await leo.page.keyboard.press('i');
    const chooser = await chooserPromise;
    const big = Buffer.alloc(IMAGE_MAX_BYTES + 1, 7);
    await chooser.setFiles([
      { name: 'shot.png', mimeType: 'image/png', buffer: readFileSync(fileURLToPath(new URL('screenshot.png', FIXTURES))) },
      { name: 'report.png', mimeType: 'image/png', buffer: readFileSync(fileURLToPath(new URL('report.png', FIXTURES))) },
      { name: 'big.jpg', mimeType: 'image/jpeg', buffer: big }
    ]);
    await expect(leo.page.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeVisible();
    await expect(leo.page.getByText('Images must be 10 MB or smaller.')).toBeVisible();
    await expect.poll(async () => (await getImages(leo.page)).length).toBe(1);
    await expect(imageEls(leo.page)).toHaveCount(1);
    await leo.context.close();
  });

  // TC-27: aspect-locked corner resize with a minimum size; the image
  // survives a reload in a fresh context.
  test('TC-27 corner resize keeps the aspect ratio; image persists', async ({
    browser
  }) => {
    const [leo] = await openParticipants(browser, ['leo']);
    const chooserPromise = leo.page.waitForEvent('filechooser');
    await leo.page.keyboard.press('i');
    const chooser = await chooserPromise;
    await chooser.setFiles(pathFixture('animation.gif'));
    await expect(imageEls(leo.page)).toHaveCount(1);
    const [before] = await getImages(leo.page);

    await leo.page.locator('[data-testid=image-object-view]').click();
    const handle = leo.page.getByLabel('Resize bottom-right');
    const box = await handle.boundingBox();
    if (box === null) throw new Error('resize handle has no box');
    await dragBy(leo.page, { x: box.x + 4, y: box.y + 4 }, 80, 60);
    const grown = (await getImages(leo.page))[0]!;
    const natural = before!.naturalWidth / before!.naturalHeight;
    expect(Math.abs(grown.width / grown.height - natural) / natural).toBeLessThan(0.01);
    expect(grown.width).toBeGreaterThan(before!.width);

    // Shrink past the minimum: the width stops at IMAGE_MIN_SIZE_WORLD.
    const box2 = await leo.page.getByLabel('Resize bottom-right').boundingBox();
    await dragBy(leo.page, { x: box2!.x + 4, y: box2!.y + 4 }, -5000, -4000);
    const shrunk = (await getImages(leo.page))[0]!;
    expect(shrunk.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.5);
    expect(Math.abs(shrunk.width / shrunk.height - natural) / natural).toBeLessThan(0.01);

    // Fresh context: image loads from R2 after reload.
    const boardId = new URL(leo.page.url()).pathname.split('/')[2];
    await leo.context.close();
    const later = await browser.newContext();
    const page2 = await later.newPage();
    await page2.goto(`/b/${boardId}`);
    await expect(page2.getByTestId('board-viewport')).toBeVisible();
    await expect.poll(async () => (await getImages(page2)).filter((i) => i.status === 'ready').length).toBe(1);
    await expect(imageEls(page2)).toHaveCount(1);
    await later.close();
  });

  // TC-28: a failed upload shows Upload failed + Retry; retrying with the
  // route restored completes the image.
  test('TC-28 upload failure → Retry → ready', async ({ browser }) => {
    const [leo] = await openParticipants(browser, ['leo']);
    await leo.page.route('**/api/boards/*/assets', (route) => void route.abort('failed'));
    await dropFiles(leo.page, [screenshotFixtures()[0]!], 500, 400);
    await expect(leo.page.getByText('Upload failed')).toBeVisible();
    await expect(leo.page.getByRole('button', { name: 'Retry' })).toBeVisible();

    await leo.page.unroute('**/api/boards/*/assets');
    await leo.page.getByRole('button', { name: 'Retry' }).click();
    await expect(imageEls(leo.page)).toHaveCount(1);
    await expect
      .poll(async () => (await getImages(leo.page))[0]!.status)
      .toBe('ready');
    await leo.context.close();
  });
});

function pathFixture(name: string): { name: string; mimeType: string; buffer: Buffer } {
  const ext = name.slice(name.lastIndexOf('.') + 1);
  return {
    name,
    mimeType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
    buffer: readFileSync(fileURLToPath(new URL(name, FIXTURES)))
  };
}
