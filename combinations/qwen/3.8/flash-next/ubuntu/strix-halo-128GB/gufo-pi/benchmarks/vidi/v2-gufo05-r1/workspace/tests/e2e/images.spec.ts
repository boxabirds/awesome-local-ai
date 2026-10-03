/**
 * Dropping images onto the board, in a browser (story 12).
 *
 * What a browser adds over the component suite is the three things a picture actually needs:
 * a drag with files in it, a decoder that either paints or does not, and an HTTP response with
 * headers on it. So these four tests drop real fixtures through real `DataTransfer`s, answer a
 * real file dialog, measure a real corner drag against the picture's own ratio, and read the
 * `Cache-Control` a colleague's browser will obey for a year.
 *
 * TC-25 Leo drops three screenshots into a shared moodboard: Sam sees the placeholders, then the
 *      pictures, and the bytes are served immutably
 * TC-26 one Image-tool batch of a valid PNG, a PDF and an 11 MB JPEG: one image, two toasts, in
 *      all three engines
 * TC-27 a corner drag keeps the picture's ratio, a second one stops at the floor, and a reload
 *      shows the resized picture again
 * TC-28 the network drops the upload: "Upload failed" and Retry for Leo, "Image unavailable" for
 *      Sam, and the retry lands on both screens
 *
 * The latency from a drop to a colleague's screen is measured and logged against
 * `LIVE_UPDATE_LATENCY_BUDGET_MS`, never asserted, for the reason given in
 * `helpers/participants.ts`: five browsers and a Worker on one machine is a fact about the
 * machine.
 */
import { expect, test, type Page } from '@playwright/test';

import { IMAGE_MIN_SIZE_WORLD, LIVE_UPDATE_LATENCY_BUDGET_MS } from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { setCamera, openFreshBoard } from './helpers/board';
import {
  blockUploads,
  chooseFiles,
  delayUploads,
  decodedSize,
  DROP_HIGHLIGHT,
  dragFilesOver,
  dropFiles,
  fixturePayload,
  imageCount,
  imageText,
  oversizedJpegPayload,
  readImages,
  REMOVE_BUTTON,
  RETRY_BUTTON,
  watchAssetRequests,
  waitForToasts,
  wrongTypePayload,
} from './helpers/images';
import {
  logLatencyReport,
  openBoard,
  waitForChange,
  type Participant,
} from './helpers/participants';
import { dragHandle } from './helpers/selection';

/**
 * Look at a known patch of empty board, and only once this browser is in sync with the room.
 *
 * The sync wait is not politeness: an image is uploaded straight away, and a board that is still
 * `connecting` refuses the file rather than queueing it (`image.offline`).
 */
async function parkCamera(page: Page, camera = { x: 0, y: 0, zoom: 1 }): Promise<void> {
  await page.waitForFunction(() => window.__vidi6?.connectionState === 'connected', undefined, {
    timeout: 20_000,
  });
  await setCamera(page, camera);
}

/** The middle of the view, which is where a drop puts the middle of a row (`image.row`). */
const DROP_POINT = { x: 640, y: 400 };

/**
 * A view both people are looking at, wide enough for three screenshots in a row.
 *
 * Zoomed out on purpose. A picture is fetched lazily — nobody downloads what they cannot see —
 * so a test that means to check that a colleague's pixels arrived has to make sure its
 * colleague can see them: three 800-unit boxes are 2 448 units, and a viewport is 1 280.
 */
const ROW_CAMERA = { x: -960, y: -500, zoom: 0.4 };

test.describe('image.drop: three screenshots onto a shared moodboard', () => {
  test('TC-25 Leo drops three screenshots; Sam sees placeholders then pictures', async ({
    browser,
  }) => {
    const session = await openBoard(browser, 2);
    const leo = session.participants[0] as Participant;
    const sam = session.participants[1] as Participant;
    const served = watchAssetRequests(sam.page);
    // Slow enough that the in-between state is something the test can look at rather than
    // hope to catch: the placeholders have to be visible before the uploads land.
    const stopDelay = await delayUploads(leo.page, 1500);

    await parkCamera(leo.page, ROW_CAMERA);
    await setCamera(sam.page, ROW_CAMERA);
    const files = [
      fixturePayload('screenshot.png'),
      fixturePayload('screenshot-alt.png'),
      fixturePayload('screenshot-third.png'),
    ];

    // The board says it is ready for what is being carried, before anything is let go.
    await dragFilesOver(leo.page, files, DROP_POINT);
    await expect(leo.page.locator(DROP_HIGHLIGHT)).toBeVisible();
    const droppedAt = Date.now();
    await dropFiles(leo.page, files, DROP_POINT);
    await expect(leo.page.locator(DROP_HIGHLIGHT)).toHaveCount(0);

    // Three objects on Leo's screen at once, each a box of the screenshot's own shape.
    await expect.poll(() => imageCount(leo.page), { timeout: 15_000 }).toBe(3);
    const placed = await readImages(leo.page);
    for (const image of placed) {
      expect(image.width).toBeCloseTo(800, 1);
      expect(image.height).toBeCloseTo(500, 1);
    }
    // In a row, so no two of them land on top of each other.
    expect(new Set(placed.map((image) => Math.round(image.x))).size).toBe(3);

    // Sam sees the same three, and while Leo is still uploading, says so.
    await waitForChange('drop → three placeholders on Sam', async () => {
      return (await imageCount(sam.page)) === 3;
    });
    const seeing = Date.now() - droppedAt;
    const samTexts = await Promise.all(
      (await readImages(sam.page)).map((image) => imageText(sam.page, image.id)),
    );
    expect(samTexts.some((text) => text.includes('Uploading'))).toBe(true);
    console.log(
      `[latency] images appeared on Sam's board ${String(seeing)} ms after the drop ` +
        `(budget ${String(LIVE_UPDATE_LATENCY_BUDGET_MS)} ms, reported not asserted)`,
    );

    // And then the pictures themselves, on both screens: the browser's own `naturalWidth` is
    // the proof that the bytes arrived and decoded.
    await waitForChange('uploads land as decoded pictures on both screens', async () => {
      for (const person of [leo, sam]) {
        const images = await readImages(person.page);
        if (images.length !== 3) return false;
        if (images.some((image) => image.status !== 'ready' || image.key === '')) return false;
        for (const image of images) {
          const decoded = await decodedSize(person.page, image.id);
          if (decoded === null || decoded.width !== 1440 || decoded.height !== 900) return false;
        }
      }
      return true;
    });
    logLatencyReport('image.drop');

    // Served as immutable picture bytes: this is the response a browser will keep for a year.
    expect(served.length).toBeGreaterThan(0);
    for (const response of served) {
      expect(response.status).toBe(200);
      expect(response.contentType).toBe('image/png');
      expect(response.cacheControl).toBe('public, max-age=31536000, immutable');
      expect(response.nosniff).toBe('nosniff');
      expect(response.contentSecurityPolicy).toBe("default-src 'none'");
    }

    await stopDelay();
    await session.close();
  });
});

test.describe('image.add: one batch through the file dialog', () => {
  test('TC-26 a valid PNG, a PDF and an 11 MB JPEG arrive together', async ({ page }) => {
    await openFreshBoard(page);
    await parkCamera(page);

    await chooseFiles(page, () => page.keyboard.press('i'), [
      fixturePayload('small.png'),
      wrongTypePayload(),
      oversizedJpegPayload(),
    ]);

    // Exactly one object appears, and it is the PNG.
    await expect.poll(() => imageCount(page), { timeout: 15_000 }).toBe(1);
    const [only] = await readImages(page);
    expect(only).toBeDefined();
    expect(only!.width).toBeCloseTo(300, 1);
    expect(only!.height).toBeCloseTo(200, 1);

    // Both refusals, in the PRD's words, and nothing else: the accepted file is not refused,
    // and the two refused ones say exactly what was wrong with them.
    await waitForToasts(page, [REJECTION_MESSAGES.type, REJECTION_MESSAGES.size]);
    await expect(page.getByTestId('toast')).toHaveCount(2);

    // The one that was accepted is uploaded and painted.
    await expect
      .poll(() => decodedSize(page, only!.id).then((size) => size?.width ?? 0), {
        timeout: 20_000,
      })
      .toBe(300);
  });
});

test.describe("image.resize: the picture's own shape, and the floor", () => {
  test('TC-27 a corner drag keeps the ratio, a second stops, a reload remembers', async ({
    page,
    browser,
  }) => {
    const boardId = await openFreshBoard(page);
    await parkCamera(page);
    await dropFiles(page, [fixturePayload('small.png')], DROP_POINT);
    await expect.poll(() => imageCount(page), { timeout: 15_000 }).toBe(1);
    const added = (await readImages(page))[0]!;

    // Wait for the picture, because a ratio is only meaningful once the box is the picture's.
    await expect
      .poll(() => decodedSize(page, added.id).then((size) => size?.width ?? 0), { timeout: 20_000 })
      .toBe(300);

    const before = (await readImages(page))[0]!;
    const ratio = before.width / before.height;

    // Select it, then pull the south-east corner out and to the side: the extra height the
    // pointer moved has to come back out of the width, because the picture keeps its shape.
    await page.mouse.click(DROP_POINT.x, DROP_POINT.y);
    await expect(page.getByTestId('selection-handle')).toHaveCount(8);
    await dragHandle(page, 'se', { x: 150, y: 20 });

    const grown = (await readImages(page))[0]!;
    expect(grown.width).toBeGreaterThan(before.width);
    expect(grown.height).toBeGreaterThan(before.height);
    expect(Math.abs(grown.width / grown.height - ratio) / ratio).toBeLessThan(0.01);
    // The other corner stayed put: this is a resize, not a move.
    expect(grown.x).toBeCloseTo(before.x, 0);
    expect(grown.y).toBeCloseTo(before.y, 0);

    // Shrink it far past the floor, twice: the second drag has nowhere left to go.
    await dragHandle(page, 'nw', { x: 4000, y: 4000 });
    const floored = (await readImages(page))[0]!;
    expect(floored.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.5);
    expect(floored.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.5);
    expect(Math.min(floored.width, floored.height)).toBeCloseTo(IMAGE_MIN_SIZE_WORLD, 0);
    await dragHandle(page, 'nw', { x: 4000, y: 4000 });
    const again = (await readImages(page))[0]!;
    expect(again.width).toBeCloseTo(floored.width, 1);
    expect(again.height).toBeCloseTo(floored.height, 1);

    // Reload: the same picture, at the size it was resized to.
    const context = await browser.newContext();
    const reloaded = await context.newPage();
    await reloaded.goto(`/b/${boardId}`, { waitUntil: 'domcontentloaded' });
    await reloaded.waitForFunction(() => window.__vidi6?.connectionState === 'connected', undefined, {
      timeout: 30_000,
    });
    await parkCamera(reloaded);
    await expect.poll(() => imageCount(reloaded), { timeout: 15_000 }).toBe(1);
    const after = (await readImages(reloaded))[0]!;
    expect(after.id).toBe(added.id);
    expect(after.key).toBe(floored.key);
    expect(after.width).toBeCloseTo(floored.width, 1);
    expect(after.height).toBeCloseTo(floored.height, 1);
    await expect
      .poll(() => decodedSize(reloaded, after.id).then((size) => size?.width ?? 0), { timeout: 20_000 })
      .toBe(300);
    await context.close();
  });
});

test.describe('image.retry: the upload fails and is asked for again', () => {
  test('TC-28 a dropped upload says so, and the retry lands on both screens', async ({
    browser,
  }) => {
    const session = await openBoard(browser, 2);
    const leo = session.participants[0] as Participant;
    const sam = session.participants[1] as Participant;
    const refuse = await blockUploads(leo.page);

    await parkCamera(leo.page);
    await dropFiles(leo.page, [fixturePayload('photo-small.jpg')], DROP_POINT);
    await expect.poll(() => imageCount(leo.page), { timeout: 15_000 }).toBe(1);
    const failed = (await readImages(leo.page))[0]!;

    // Leo, who owns the upload, is offered the way out.
    await expect(leo.page.locator(RETRY_BUTTON)).toBeVisible();
    await expect(leo.page.locator(REMOVE_BUTTON)).toBeVisible();
    await expect
      .poll(() => imageText(leo.page, failed.id), { timeout: 20_000 })
      .toContain('Upload failed');

    // Sam was never the uploader, so Sam is told the picture is not there, not offered a retry.
    await waitForChange('failure reaches Sam', async () => {
      const images = await readImages(sam.page);
      return images.length === 1 && images[0]!.status === 'failed';
    });
    expect(await imageText(sam.page, failed.id)).toContain('Image unavailable');
    await expect(sam.page.locator(RETRY_BUTTON)).toHaveCount(0);

    // The network comes back, and the one button Leo has left is pressed.
    await refuse();
    await leo.page.locator(RETRY_BUTTON).click();
    await waitForChange('retry paints the picture on both screens', async () => {
      for (const person of [leo, sam]) {
        const images = await readImages(person.page);
        if (images.length !== 1 || images[0]!.status !== 'ready') return false;
        const decoded = await decodedSize(person.page, failed.id);
        if (decoded === null || decoded.width !== 640) return false;
      }
      return true;
    });
    logLatencyReport('image.retry');

    // And the retry wrote the key once: a shared document with two answers to one upload.
    const leoImages = await readImages(leo.page);
    const samImages = await readImages(sam.page);
    expect(leoImages[0]!.key).not.toBe('');
    expect(samImages[0]!.key).toBe(leoImages[0]!.key);

    await session.close();
  });
});
