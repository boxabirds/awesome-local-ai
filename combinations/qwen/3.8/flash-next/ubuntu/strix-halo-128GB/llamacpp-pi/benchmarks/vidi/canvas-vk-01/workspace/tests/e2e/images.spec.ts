import { expect, test, type Browser, type Page } from '@playwright/test';

import {
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_BYTES,
  IMAGE_MIN_SIZE_WORLD,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import { joinBoard, startBoard } from './helpers/live';

import {
  breakUploads,
  chooseFilesWithPicker,
  dropFilesOnBoard,
  fixtureFile,
  holdUploads,
  imageBox,
  imageDecoded,
  imageIds,
  imageObject,
  imageObjects,
  letUploadsThrough,
  toastTexts,
  watchAssetResponses,
} from './helpers/drop-files';

/**
 * Story 12 — "Drop images onto the board", end to end.
 *
 * These run against `wrangler dev` with its local R2, so a picture really is
 * stored, really comes back over HTTP with the headers that make it safe to cache
 * forever, and really survives a reload of the page. Where a test needs to catch
 * an upload in mid-flight it delays the request rather than the assertion: the
 * uploading state is only interesting while it is still true.
 */

const VIEWPORT = { width: 1280, height: 800 };

/** Where the first image of a drop starts: clear of the toolbar and the zoom controls. */
const DROP_POINT = { x: 150, y: 150 };

const TYPE_MESSAGE = 'Only PNG, JPEG, GIF and WebP images can be added.';
const SIZE_MESSAGE = 'Images must be 10 MB or smaller.';
const UPLOAD_FAILED = 'Upload failed';

interface Duo {
  leo: Page;
  sam: Page;
  boardId: string;
  close(): Promise<void>;
}

/** Two isolated clients on one fresh board, both in sync. */
async function openDuo(browser: Browser): Promise<Duo> {
  const leoContext = await browser.newContext({ viewport: VIEWPORT });
  const leo = await leoContext.newPage();
  const boardId = await startBoard(leo);
  const samContext = await browser.newContext({ viewport: VIEWPORT });
  const sam = await samContext.newPage();
  await joinBoard(sam, boardId);
  return {
    leo,
    sam,
    boardId,
    close: async () => {
      await leoContext.close();
      await samContext.close();
    },
  };
}

/**
 * Drag one of the selection handles by `delta`, in screen pixels. Copied in shape
 * from the multi-select suite: the handles are the board's own resize affordance,
 * and an image is resized through nothing else.
 */
async function dragHandleBy(
  page: Page,
  handle: string,
  delta: { x: number; y: number },
): Promise<void> {
  const box = await page.getByTestId(`resize-handle-${handle}`).boundingBox();
  if (box === null) throw new Error(`handle ${handle} has no box`);
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + delta.x / 2, from.y + delta.y / 2, { steps: 5 });
  await page.mouse.move(from.x + delta.x, from.y + delta.y, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}

/** Every image of a drop, decoded, on this client. */
async function expectPictures(page: Page, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    await expect
      .poll(() => imageDecoded(page, id), { timeout: 15_000, message: `image ${id} did not load` })
      .toBe(true);
  }
}

test('TC-25: a moodboard built in front of a colleague', async ({ browser }) => {
  const duo = await openDuo(browser);
  test.setTimeout(90_000);
  try {
    // The uploads are held open so that "still arriving" is a state both clients
    // can be shown, rather than something that finished before the assertion ran.
    await holdUploads(duo.leo, 1_500);
    const served = watchAssetResponses(duo.sam);

    const files = [
      fixtureFile('screenshot-800x600.png'),
      fixtureFile('photo-640x480.webp'),
      fixtureFile('animation.gif'),
    ];
    const dropped = Date.now();
    await dropFilesOnBoard(duo.leo, DROP_POINT, files);

    // Sam sees the same three placeholders, unasked, within the live budget.
    await expect(imageObjects(duo.sam)).toHaveCount(3, { timeout: 5_000 });
    expect(Date.now() - dropped).toBeLessThanOrEqual(LIVE_UPDATE_LATENCY_BUDGET_MS);

    const ids = await imageIds(duo.sam);
    expect(ids).toHaveLength(3);
    // A viewer sees that the picture is on its way, and not a percentage that is
    // somebody else's business (`image.uploading`).
    await expect(duo.sam.getByText('Uploading…')).toHaveCount(3);
    for (const id of ids) {
      await expect(imageObject(duo.sam, id)).toHaveAttribute('data-status', 'uploading');
    }
    // The uploader's own view carries the same boxes, in the same places, in a row
    // with the agreed gap (`image.place_size`).
    // The three boxes form one row: the same top edge, and the named gap between
    // each pair. Ordered by x rather than by object id, because the row is the
    // arrangement the user sees and ids are random.
    const boxes = (await Promise.all(ids.map((id) => imageBox(duo.leo, id)))).sort(
      (a, b) => a.x - b.x,
    );
    expect(boxes[0]!.x).toBeCloseTo(DROP_POINT.x, 0);
    expect(boxes[1]!.x).toBeCloseTo(boxes[0]!.x + boxes[0]!.width + IMAGE_LAYOUT_GAP_WORLD, 0);
    expect(boxes[2]!.x).toBeCloseTo(boxes[1]!.x + boxes[1]!.width + IMAGE_LAYOUT_GAP_WORLD, 0);
    for (const box of boxes) expect(box.y).toBeCloseTo(DROP_POINT.y, 0);

    // The bytes finish, and the pictures arrive on both screens.
    await expectPictures(duo.leo, ids);
    await expectPictures(duo.sam, ids);
    for (const id of ids) {
      await expect(imageObject(duo.sam, id)).toHaveAttribute('data-status', 'ready');
    }
    // Alt text so the board is not silent for somebody using a reader.
    await expect(imageObject(duo.sam, ids[0]!)).toHaveAttribute('alt', 'Image');

    // And what was served was served to be kept: immutable, not sniffed, no scripts.
    const responses = served.responses();
    expect(responses.length).toBeGreaterThanOrEqual(3);
    for (const response of responses) {
      expect(response.status).toBe(200);
      expect(response.cacheControl).toBe('public, max-age=31536000, immutable');
      expect(response.nosniff).toBe('nosniff');
      expect(response.csp).toBe("default-src 'none'");
    }
  } finally {
    await duo.close();
  }
});

test('TC-26: a batch that is only partly pictures', async ({ page }) => {
  test.setTimeout(60_000);
  await startBoard(page);

  await chooseFilesWithPicker(page, [
    fixtureFile('screenshot-800x600.png'),
    { name: 'quarterly-report.pdf', type: 'application/pdf', bytes: fixtureFile('document-as-png.png').bytes },
    { name: 'enormous.jpg', type: 'image/jpeg', bytes: new Uint8Array(IMAGE_MAX_BYTES + 1) },
  ]);

  // One picture, one message for the wrong kind of file and one for the oversize
  // one — each reason said once, whatever the number of files behind it.
  await expect(imageObjects(page)).toHaveCount(1);
  await expect
    .poll(() => toastTexts(page), { timeout: 5_000 })
    .toEqual(expect.arrayContaining([TYPE_MESSAGE, SIZE_MESSAGE]));
  const toasts = await toastTexts(page);
  expect(toasts.filter((text) => text === TYPE_MESSAGE)).toHaveLength(1);
  expect(toasts.filter((text) => text === SIZE_MESSAGE)).toHaveLength(1);
  // Nothing was refused that could be added, and nothing else was added.
  expect((await imageIds(page))[0]).toBeTruthy();
  await expectPictures(page, await imageIds(page));
});

test('TC-27: resizing keeps the shape, and the board remembers it', async ({ browser, page }) => {
  test.setTimeout(90_000);
  const boardId = await startBoard(page);

  await dropFilesOnBoard(page, DROP_POINT, [fixtureFile('screenshot-800x600.png')]);
  await expect(imageObjects(page)).toHaveCount(1);
  const id = (await imageIds(page))[0]!;
  await expectPictures(page, [id]);

  const before = await imageBox(page, id);
  const ratioBefore = before.width / before.height;

  await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2);
  await expect(page.getByTestId('resize-handle-se')).toBeVisible();

  // Drag the corner well past the opposite one: the shape must hold, and the size
  // must stop at the floor rather than turning into a dot (`image.aspect_resize`).
  await dragHandleBy(page, 'se', { x: -before.width - 200, y: -before.height - 200 });

  const after = await imageBox(page, id);
  const ratioAfter = after.width / after.height;
  expect(Math.abs(ratioAfter - ratioBefore) / ratioBefore).toBeLessThan(0.01);
  expect(after.width).toBeLessThan(before.width * 0.25);
  // The floor: the box stops at the agreed minimum instead of shrinking away…
  const longest = Math.max(after.width, after.height);
  expect(longest).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 1);
  expect(longest).toBeLessThanOrEqual(IMAGE_MIN_SIZE_WORLD + 1);
  // …and pushing further does nothing at all.
  await dragHandleBy(page, 'se', { x: -60, y: -60 });
  const stuck = await imageBox(page, id);
  expect(stuck.width).toBeCloseTo(after.width, 0);
  expect(stuck.height).toBeCloseTo(after.height, 0);

  // A stranger arriving afterwards sees the same picture at the same size, drawn
  // from storage and not from anybody's memory (`image.shared`).
  const later = await browser.newContext({ viewport: VIEWPORT });
  const revisited = await later.newPage();
  try {
    await joinBoard(revisited, boardId);
    await expect(imageIds(revisited)).resolves.toContain(id);
    await expectPictures(revisited, [id]);
    const seen = await imageBox(revisited, id);
    expect(seen.width).toBeCloseTo(after.width, 0);
    expect(seen.height).toBeCloseTo(after.height, 0);
  } finally {
    await later.close();
  }
});

test('TC-28: an upload that fails, and the retry that does not', async ({ browser }) => {
  const duo = await openDuo(browser);
  test.setTimeout(90_000);
  try {
    await breakUploads(duo.leo);
    await dropFilesOnBoard(duo.leo, DROP_POINT, [fixtureFile('screenshot-800x600.png')]);

    await expect(imageObjects(duo.leo)).toHaveCount(1);
    const id = (await imageIds(duo.leo))[0]!;
    await expect(imageObject(duo.leo, id)).toHaveAttribute('data-status', 'failed', {
      timeout: 10_000,
    });
    // The uploader is told it failed and is given the bytes back; everyone else is
    // told the picture is not there, without being handed a button that could not
    // work (`image.upload_failure`).
    await expect(imageObject(duo.leo, id).getByText(UPLOAD_FAILED)).toBeVisible();
    await expect(imageObject(duo.leo, id).getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(imageObject(duo.leo, id).getByRole('button', { name: 'Remove' })).toBeVisible();

    await expect(imageObject(duo.sam, id)).toHaveAttribute('data-status', 'failed', {
      timeout: 10_000,
    });
    await expect(imageObject(duo.sam, id).getByText('Image unavailable')).toBeVisible();
    await expect(imageObject(duo.sam, id).getByRole('button', { name: 'Retry' })).toHaveCount(0);

    // The network comes back; the same bytes go again without being asked for.
    await letUploadsThrough(duo.leo);
    await imageObject(duo.leo, id).getByRole('button', { name: 'Retry' }).click();

    await expect(imageObject(duo.leo, id)).toHaveAttribute('data-status', 'ready', {
      timeout: 15_000,
    });
    await expectPictures(duo.leo, [id]);
    await expect(imageObject(duo.sam, id)).toHaveAttribute('data-status', 'ready', {
      timeout: 15_000,
    });
    await expectPictures(duo.sam, [id]);
  } finally {
    await duo.close();
  }
});
