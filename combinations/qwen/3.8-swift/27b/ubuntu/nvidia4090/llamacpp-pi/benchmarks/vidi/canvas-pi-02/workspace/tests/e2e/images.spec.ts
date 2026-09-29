// Story 12 (image.*) e2e: TC-21 to TC-25.
//
// Runs against the real serving path (wrangler dev + R2 bucket in miniflare
// memory mode) in test mode (window.__vidi6 hooks). The camera helper
// (helpers/board) pins the camera to (0,0,1) after the initial load
// centring, so screen == world coordinates.
//
// Drop is driven with Playwright's dispatchEvent carrying a real
// DataTransfer (React's onDrop needs a genuine DragEvent). Paste is
// dispatched as a plain Event with a clipboardData object on document
// (the app only reads .files, and the window-level native listener
// receives it). The picker uses the real file chooser.

import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { openBoard, setCamera } from './helpers/board';

const FIXTURE_DIR = 'tests/fixtures/images';
const SCREENSHOT = `${FIXTURE_DIR}/screenshot.png`; // 1440×900 PNG

/** Reads a fixture as base64 (injected into the browser as a File). */
function fixtureB64(path: string): string {
  return readFileSync(path, { encoding: 'base64' });
}

type P = import('@playwright/test').Page;

async function resetCamera(page: P): Promise<void> {
  await setCamera(page, 0, 0, 1);
}

async function images(page: P): Promise<
  Array<{ id: string; x: number; y: number; width: number; height: number }>
> {
  return page.evaluate(() =>
    (window.__vidi6?.getAllObjects() ?? [])
      .filter((o) => o.type === 'image')
      .map((o) => ({ id: o.id, x: o.x, y: o.y, width: o.width!, height: o.height! })),
  );
}

/** Counts rendered image objects with the given data-status. */
async function statusCount(page: P, status: string): Promise<number> {
  return page.locator(`[data-testid="image-object"][data-status="${status}"]`).count();
}

/** Waits until exactly `n` images report `status` (uploads complete).
 *  DOM-based: only counts RENDERED images (off-screen ones are culled by
 *  the visibility filter). */
async function waitForStatus(page: P, n: number, status: string): Promise<void> {
  await expect
    .poll(async () => statusCount(page, status), { timeout: 15_000 })
    .toBe(n);
}

/** Waits until the DOC holds exactly `n` images with `status` — unlike
 *  waitForStatus this sees off-screen (visibility-culled) images too. */
interface YLikeEntry {
  get(key: string): unknown;
}
interface YLikeMap {
  values(): Iterable<YLikeEntry>;
}

async function waitForDocStatus(page: P, n: number, status: string): Promise<void> {
  const docStatus = (): Promise<[number, number]> =>
    page.evaluate((st: string) => {
      const doc = (window as unknown as { __vidi6Doc: { getMap: (k: string) => YLikeMap } }).__vidi6Doc;
      const map = doc.getMap('objects');
      let total = 0;
      let matches = 0;
      for (const entry of map.values()) {
        if (entry.get('type') !== 'image') continue;
        total += 1;
        if (entry.get('status') === st) matches += 1;
      }
      return [total, matches] as [number, number];
    }, status);
  await expect.poll(docStatus, { timeout: 15_000 }).toEqual([n, n]);
}

/** Stores a File in the page as window.__file (from base64 bytes). */
async function makeFile(page: P, b64: string, name: string, type: string): Promise<void> {
  await page.evaluate(
    ([b, n, t]) => {
      const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
      (window as unknown as Record<string, File>).__file = new File([bytes], n, { type: t });
    },
    [b64, name, type],
  );
}

/** Stores `n` DISTINCT copies of window.__file as window.__files (browsers
 *  create a new File per dropped item, so the app's by-identity upload
 *  dedup never sees duplicates). */
async function setBatch(page: P, n: number): Promise<void> {
  await page.evaluate((count) => {
    const f = (window as unknown as Record<string, File>).__file;
    const copies: File[] = [];
    for (let i = 0; i < count; i++) {
      // Fresh bytes + fresh File per copy (like real dropped items).
      const buf = f.slice(0, f.size);
      const dot = f.name.lastIndexOf('.');
      const name = `${f.name.slice(0, dot)}-${i + 1}${f.name.slice(dot)}`;
      copies.push(new File([buf], name, { type: f.type }));
    }
    (window as unknown as Record<string, File[]>).__files = copies;
  }, n);
}

/** Dispatches a real drag-drop of window.__files on the board viewport. */
async function dropFiles(page: P): Promise<void> {
  const dt = await page.evaluateHandle(() => {
    const files = (window as unknown as Record<string, File[]>).__files;
    const d = new DataTransfer();
    for (const f of files) d.items.add(f);
    return d;
  });
  await page.locator('[data-testid="board-viewport"]').dispatchEvent('drop', {
    dataTransfer: dt,
  });
  await dt.dispose();
}

/** Dispatches a paste of window.__files on the document (bubbles to the
 *  window listener). */
async function pasteFiles(page: P): Promise<void> {
  await page.evaluate(() => {
    const files = (window as unknown as Record<string, File[]>).__files;
    const e = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(e, 'clipboardData', { value: { files } });
    document.dispatchEvent(e);
  });
}

test.beforeEach(async ({ page }) => {
  await openBoard(page);
  await resetCamera(page);
});

test('TC-21: a dropped PNG uploads to R2 and renders as a ready <img> at the asset URL; a pasted PNG does the same', async ({ page }) => {
  await makeFile(page, fixtureB64(SCREENSHOT), 'screenshot.png', 'image/png');
  await setBatch(page, 1);

  const uploads: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && req.url().includes('/assets')) uploads.push(req.url());
  });

  await dropFiles(page);
  await waitForStatus(page, 1, 'ready');
  const img = page.locator('[data-testid="image-object"][data-status="ready"] img');
  await expect(img).toHaveAttribute('src', /^\/api\/assets\//);
  // The uploaded asset is served back (real R2 round-trip).
  const src = (await img.getAttribute('src'))!;
  const res = await page.request.get(src);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toBe('image/png');
  expect(uploads).toHaveLength(1);

  // Paste: same flow.
  await pasteFiles(page);
  await waitForStatus(page, 2, 'ready');
  expect(await images(page)).toHaveLength(2);
});

test('TC-22: dropping a valid image plus a text file and an oversized file creates one image and toasts the rejections', async ({ page }) => {
  await makeFile(page, fixtureB64(SCREENSHOT), 'screenshot.png', 'image/png');
  await page.evaluate(() => {
    const good = (window as unknown as Record<string, File>).__file;
    const bad = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    // A valid IMAGE type that is over the 10 MB limit → the 'size' toast.
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.png', {
      type: 'image/png',
    });
    (window as unknown as Record<string, File[]>).__files = [good, bad, big];
  });
  await dropFiles(page);
  // Toasts appear synchronously with the drop (4 s TTL) — assert NOW, before
  // the upload poll. Exact PRD wording, one toast per reason (image.types /
  // image.size_limit).
  await expect(page.getByTestId('toast')).toHaveCount(2);
  await expect(page.getByText('Only PNG, JPEG, GIF and WebP images can be added.')).toBeVisible();
  await expect(page.getByText('Images must be 10 MB or smaller.')).toBeVisible();
  await waitForStatus(page, 1, 'ready');
});

test('TC-23: three dropped images land in a single row: same y, x strictly increasing, sizes from the natural aspect', async ({ page }) => {
  await makeFile(page, fixtureB64(SCREENSHOT), 'screenshot.png', 'image/png');
  await setBatch(page, 3);
  await dropFiles(page);

  // The 2448-wide row outruns the 1280-px viewport at zoom 1, so the last
  // image is visibility-culled: count ready states on the DOC, not the DOM.
  await waitForDocStatus(page, 3, 'ready');
  const all = await images(page);
  expect(all).toHaveLength(3);
  const sorted = [...all].sort((a, b) => a.x - b.x);
  // One row: equal y, strictly increasing x.
  expect(sorted[1].y).toBeCloseTo(sorted[0].y, 3);
  expect(sorted[2].y).toBeCloseTo(sorted[0].y, 3);
  expect(sorted[0].x).toBeLessThan(sorted[1].x);
  expect(sorted[1].x).toBeLessThan(sorted[2].x);
  // Uniform placement from the 8:5 natural size (1440×900): width > height,
  // all identical.
  expect(sorted[0].width).toBe(sorted[1].width);
  expect(sorted[1].width).toBe(sorted[2].width);
  expect(sorted[0].height).toBe(sorted[1].height);
  for (const o of sorted) {
    expect(o.width).toBeGreaterThan(o.height);
  }
});

test('TC-24: the toolbar image button opens the picker; a chosen file uploads and renders', async ({ page }) => {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Image (I)' }).click(),
  ]);
  await chooser.setFiles(SCREENSHOT);

  await waitForStatus(page, 1, 'ready');
  const img = page.locator('[data-testid="image-object"][data-status="ready"] img');
  await expect(img).toHaveAttribute('src', /^\/api\/assets\//);
});

test('TC-25: removing a placeholder is one undo step; a failed upload shows Retry to the uploader and retry succeeds', async ({ page }) => {
  await makeFile(page, fixtureB64(SCREENSHOT), 'screenshot.png', 'image/png');
  await setBatch(page, 1);

  // First upload attempt 415s (simulated via route interception), then the
  // real server answers.
  let blocked = false;
  await page.route('**/api/boards/*/assets', async (route) => {
    if (!blocked) {
      blocked = true;
      await route.fulfill({
        status: 415,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'unsupported_type' }),
      });
      return;
    }
    await route.continue();
  });

  await dropFiles(page);
  await waitForStatus(page, 1, 'failed');
  expect(page.getByText('Image unavailable')).toBeVisible();

  // Retry (uploader is this client) → the upload succeeds.
  await page.getByTestId('image-retry').click();
  await waitForStatus(page, 1, 'ready');
  expect(await page.locator('[data-status="ready"] img').count()).toBe(1);

  // Undo: the placeholder creation is ONE undo step → the image disappears.
  await page.keyboard.press('Control+z');
  expect(await images(page)).toHaveLength(0);
});
