/**
 * story 12, end to end: images onto a board, from a real file to a real picture.
 *
 * Nothing here is played except the operating system's file list. The bytes go over a real
 * `XMLHttpRequest` to a real Worker, are sniffed and stored in a real local R2, come back through the
 * room to a second browser context, and are decoded by a second browser engine. The waits are the
 * story's own (`E2E_EVENTUAL_TIMEOUT_MS`), and the one thing a shared runner decides - how long a
 * picture took to reach somebody else - is logged rather than asserted.
 *
 * Where a test needs an upload to be *slow* rather than merely real, the route is delayed on purpose
 * and said so: a placeholder nobody can catch because the network was fast is not a tested state.
 */
import { test, expect, type Route } from '@playwright/test';
import type { ImageSnapshot } from '../../src/shared/board-model';
import { newBoardId } from '../../src/shared/board-id';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  IMAGE_MAX_BYTES,
  IMAGE_MIN_SIZE_WORLD,
} from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import {
  chooseFiles,
  dropFiles,
  imageBoxes,
  imageFixture,
  imageStates,
  imagesOf,
  loadedPictureWidths,
  oversizedJpeg,
  pdfNamedPng,
  toastMessages,
  waitForReadyImages,
} from './helpers/images';
import {
  closeParticipants,
  LatencyLog,
  openParticipants,
  personAt,
} from './helpers/participants';
import { drag } from './helpers/board';
import { boardUrl } from './helpers/participants';

test.use({ actionTimeout: 10_000 });

/** Where a file is let go: an ordinary spot on an empty board, clear of the toolbar. */
const DROP_POINT = { x: 560, y: 400 };

/** A route that stalls uploads long enough for the waiting state to be the thing on screen. */
const SLOW_UPLOAD_MS = 1_200;
const UPLOAD_ROUTE = '**/api/boards/*/assets';

test.describe('dropping files onto the board', () => {
  // A synthetic drop needs a `DataTransfer` built in the page, which is the case the design fixes to
  // Chromium; the paths every engine shares - the picker, the placeholder, the resize - are tested
  // everywhere.
  test.skip(({ browserName }) => browserName !== 'chromium', 'chromium is what the design asks for here');

test('TC-25 a moodboard: three images dropped by one person arrive for the other', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const participants = await openParticipants(browser, boardId, 2);
  const leo = personAt(participants, 0);
  const sam = personAt(participants, 1);
  const latency = new LatencyLog();

  try {
    // slow enough that "Uploading…" is a state the other person really sees, not a flicker
    await leo.page.route(UPLOAD_ROUTE, async (route: Route) => {
      if (route.request().method() === 'POST') await new Promise((done) => setTimeout(done, SLOW_UPLOAD_MS));
      await route.continue();
    });

    const files = [
      imageFixture('screenshot-1440x900.png'),
      imageFixture('drop-green-400x300.png'),
      imageFixture('animation.gif'),
    ];

    // the placeholders reach Sam first, with the word on them rather than a percentage: Sam is not
    // the one sending anything
    await latency.measure(
      'drop to Sam sees three boxes',
      () => dropFiles(leo.page, files, DROP_POINT),
      async () => (await imageBoxes(sam)).length === 3,
    );
    await expect
      .poll(() => imageStates(sam), {
        message: "Sam never saw the three images as uploading",
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toEqual(['uploading', 'uploading', 'uploading']);
    await expect(sam.page.locator('[data-testid="image-uploading"]')).toHaveText([
      'Uploading…',
      'Uploading…',
      'Uploading…',
    ]);
    // and no Retry on Sam's screen: Sam does not have those files
    await expect(sam.page.getByTestId('image-retry')).toHaveCount(0);

    await latency.measure(
      // this leg includes the deliberate stall above, so its number is over budget by design
      'drop to Sam sees the pictures (upload stalled 1.2s on purpose)',
      async () => {
        // the wait above already happened; this leg starts from here and times the pictures
        return Date.now();
      },
      async () => (await loadedPictureWidths(sam)).filter((width) => width > 0).length === 3,
    );

    const ready = await waitForReadyImages(leo, 3);
    expect(ready.every((image) => image.assetKey)).toBe(true);
    // each file kept its own shape, in the order they were dropped - the GIF as one frame of it,
    // which is the size the picture is drawn at
    expect(ready.map((image) => `${image.naturalWidth}x${image.naturalHeight}`)).toEqual([
      '1440x900',
      '400x300',
      '120x90',
    ]);

    // a stored picture is asked for by address, and the answer is said to never change
    const first = ready[0]!.assetKey!;
    const headers = await sam.page.evaluate(async (key: string) => {
      const response = await fetch(`/api/assets/${key}`);
      return {
        status: response.status,
        cacheControl: response.headers.get('cache-control'),
        contentType: response.headers.get('content-type'),
      };
    }, first);
    expect(headers.status).toBe(200);
    expect(headers.cacheControl).toBe('public, max-age=31536000, immutable');
    expect(headers.contentType).toBe('image/png');

    // Sam's board says the same thing Leo's does, pixels included
    await expect
      .poll(async () => JSON.stringify(await imageBoxes(sam)), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toBe(JSON.stringify(await imageBoxes(leo)));

    expect(leo.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
    latency.report('story 12 drop-to-colleague latency');
  } finally {
    await closeParticipants(participants);
  }
});

test('TC-26 the Image tool adds the file it can and says exactly what it refused', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const participants = await openParticipants(browser, boardId, 1);
  const kim = personAt(participants, 0);

  try {
    await chooseFiles(kim.page, [
      imageFixture('drop-green-400x300.png'),
      pdfNamedPng(),
      oversizedJpeg(IMAGE_MAX_BYTES + 1024 * 1024),
    ]);

    // one image went in; the other two were refused, each with its own reason
    await expect
      .poll(() => imagesOf(kim), {
        message: 'the accepted image was never added',
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toHaveLength(1);

    await expect
      .poll(() => toastMessages(kim), {
        message: 'the refusals were never said',
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
      })
      .toEqual([REJECTION_MESSAGES.type, REJECTION_MESSAGES.size]);
    await expect(kim.page.getByTestId('board-toast').locator('p')).toHaveText([
      REJECTION_MESSAGES.type,
      REJECTION_MESSAGES.size,
    ]);

    // the one that went in is the PNG, and it is a picture rather than a box
    const [added] = await imagesOf(kim);
    expect(added!.naturalWidth).toBe(400);
    expect(added!.naturalHeight).toBe(300);
    const ready = await waitForReadyImages(kim, 1);
    expect(ready[0]!.status).toBe('ready');
    await expect.poll(() => loadedPictureWidths(kim)).toEqual([400]);

    // the message is a courtesy: after its display time the board is clear of it
    await expect(kim.page.getByTestId('board-toast')).toHaveCount(0, { timeout: 12_000 });

    expect(kim.consoleErrors).toEqual([]);
  } finally {
    await closeParticipants(participants);
  }
});

test('TC-27 a picture is resized in proportion, has a floor, and is still there next time', async ({
  browser,
}) => {
  const boardId = newBoardId();
  const participants = await openParticipants(browser, boardId, 1);
  const alex = personAt(participants, 0);

  try {
    await chooseFiles(alex.page, [imageFixture('drop-green-400x300.png')]);
    await waitForReadyImages(alex, 1);

    // click it, and the handles come. The box comes from the page, so the camera transform is
    // already accounted for: an inline `left` is a world coordinate, and the pointer wants a screen one.
    const drawn = alex.page.locator('[data-image-object]');
    const box = await drawn.boundingBox();
    await alex.page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const handle = alex.page.locator('.selection-handle[data-handle="se"]');
    await expect(handle).toBeVisible();

    // the corner is dragged out: bigger, and the same picture rather than a stretched one
    const corner = await handle.boundingBox();
    await drag(
      alex.page,
      { x: corner!.x + corner!.width / 2, y: corner!.y + corner!.height / 2 },
      { x: corner!.x + corner!.width / 2 + 120, y: corner!.y + corner!.height / 2 + 30 },
    );
    let grown = (await imagesOf(alex))[0]!;
    expect(grown.width).toBeGreaterThan(400);
    expect(aspect(grown.width, grown.height)).toBeCloseTo(400 / 300, 2);

    // and dragged hard back in: it stops at the floor, still in proportion
    const movedCorner = await alex.page
      .locator('.selection-handle[data-handle="se"]')
      .boundingBox();
    await drag(
      alex.page,
      { x: movedCorner!.x + movedCorner!.width / 2, y: movedCorner!.y + movedCorner!.height / 2 },
      { x: -400, y: -400 },
    );
    const shrunk = (await imagesOf(alex))[0]!;
    expect(Math.min(shrunk.width, shrunk.height)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.5);
    expect(aspect(shrunk.width, shrunk.height)).toBeCloseTo(400 / 300, 2);

    // the same board, in another window: the image is where it was left, and it is still a picture
    const revisiting = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await revisiting.newPage();
    try {
      await page.goto(boardUrl(boardId));
      await page.waitForFunction(
        () => window.__vidi6 !== undefined && window.__vidi6.connectionState() === 'connected',
        undefined,
        { timeout: E2E_EVENTUAL_TIMEOUT_MS },
      );
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const first = window
                .__vidi6!.getObjects()
                .filter((object): object is ImageSnapshot => object.type === 'image')[0];
              return first ? { width: first.width, height: first.height, status: first.status } : null;
            }),
          { timeout: E2E_EVENTUAL_TIMEOUT_MS },
        )
        .toEqual({ width: shrunk.width, height: shrunk.height, status: 'ready' });
      await expect
        .poll(async () => {
          const widths = await page.$$eval(
            '[data-testid="image-picture"]',
            (elements) => (elements as HTMLImageElement[]).map((element) => element.naturalWidth),
          );
          return widths.length;
        })
        .toBe(1);
    } finally {
      await revisiting.close();
    }

    expect(alex.consoleErrors).toEqual([]);
  } finally {
    await closeParticipants(participants);
  }
});

test('TC-28 an upload that fails can be sent again', async ({ browser }) => {
  const boardId = newBoardId();
  const participants = await openParticipants(browser, boardId, 2);
  const lee = personAt(participants, 0);
  const sam = personAt(participants, 1);

  try {
    // the network refuses the transfer outright, the way a dead wifi does
    await lee.page.route(UPLOAD_ROUTE, async (route: Route) => {
      if (route.request().method() === 'POST') {
        await route.abort('failed');
        return;
      }
      await route.continue();
    });

    await dropFiles(lee.page, [imageFixture('drop-red-300x200.png')], DROP_POINT);

    // the person who sent it is told it failed, and given both ways out
    await expect(lee.page.getByTestId('image-failed')).toContainText('Upload failed', {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    await expect(lee.page.getByTestId('image-retry')).toBeVisible();
    await expect(lee.page.getByTestId('image-remove')).toBeVisible();

    // Sam's board holds the same fact in the only form Sam can have: there is no picture here
    await expect(sam.page.getByTestId('image-unavailable')).toHaveText('Image unavailable', {
      timeout: E2E_EVENTUAL_TIMEOUT_MS,
    });
    await expect(sam.page.getByTestId('image-retry')).toHaveCount(0);

    // the network comes back, and Retry sends the same image
    await lee.page.unroute(UPLOAD_ROUTE);
    await lee.page.getByTestId('image-retry').click();

    await waitForReadyImages(lee, 1);
    await waitForReadyImages(sam, 1);
    await expect
      .poll(() => loadedPictureWidths(sam), { timeout: E2E_EVENTUAL_TIMEOUT_MS })
      .toEqual([300]);
    await expect(lee.page.getByTestId('image-failed')).toHaveCount(0);

    expect(lee.consoleErrors).toEqual([]);
    expect(sam.consoleErrors).toEqual([]);
  } finally {
    await closeParticipants(participants);
  }
});

/** The ratio a resized picture has to keep. */
function aspect(width: number, height: number): number {
  return width / height;
}
});
