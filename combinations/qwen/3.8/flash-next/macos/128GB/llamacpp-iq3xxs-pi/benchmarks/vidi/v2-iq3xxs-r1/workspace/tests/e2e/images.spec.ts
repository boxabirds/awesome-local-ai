import { expect, test } from '@playwright/test';
import {
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { IMAGE_STATUS_TEXT } from '../../src/client/objects/ImageObject';
import { closeScreens, gotoNewBoard, openScreen, waitForSynced } from './helpers/sync';
import { dragHandle } from './helpers/shapes';
import {
  breakUploads,
  dropImages,
  dropImagesAtWorld,
  fixUploads,
  imagePayload,
  imagePayloads,
  imageSnaps,
  loadedPictures,
  oversizeJpegPayload,
  pasteImages,
  pickImages,
  slowUploads,
  statusTexts,
  toastTexts,
  uploadProgress,
  waitForDisplayStatus,
  waitForImages,
  waitForLoadedPictures,
} from './helpers/images';

/**
 * Story 12 — images in the browser (TC-25 to TC-28).
 *
 * Everything here is the real path: real files carried into a real `DataTransfer`, a
 * real upload to real storage, real pictures decoded by the browser that asked for
 * them, and — where a second person matters — a second browser context that can only
 * hear about it through the room. The states in between are watched from the other
 * screen with uploads deliberately held open, because "everyone sees the same
 * placeholder" is a claim about a moment that a fast local server would otherwise
 * blink through.
 */

test('TC-25: three dropped screenshots show up on the other screen as placeholders, then as pictures', async ({
  page,
}) => {
  const pages = [page];
  try {
    const id = await gotoNewBoard(page);
    const sam = await openScreen(page, new URL(`/b/${id}`, page.url()).toString());
    pages.push(sam);
    await waitForSynced(page);
    await waitForSynced(sam);

    expect(await imageSnaps(sam)).toHaveLength(0);

    // Held open long enough for the other screen to see the in-between state. The
    // request still goes to real storage afterwards.
    await slowUploads(page, 1_500);

    const files = await imagePayloads('screenshot.png', 'photo.png', 'photo.webp');
    const droppedAt = Date.now();
    await dropImagesAtWorld(page, files, { x: -300, y: -80 });

    // Dana's screen: three placeholders, each one already the size its picture will be.
    const danaImages = await waitForImages(page, 3);
    expect(danaImages.map((image) => image.status)).toEqual(['uploading', 'uploading', 'uploading']);
    expect(danaImages.map((image) => [image.width, image.height])).toEqual([
      [IMAGE_MAX_PLACE_SIZE_WORLD, (900 / 1440) * IMAGE_MAX_PLACE_SIZE_WORLD],
      [120, 90],
      [640, 480],
    ]);

    // Sam's screen: the same three objects, still placeholders, before any byte of
    // picture has arrived there (PRD image.shared).
    const samSawThemAt = Date.now();
    const samImages = await waitForImages(sam, 3);
    expect(samImages.map((image) => image.id).sort()).toEqual(danaImages.map((image) => image.id).sort());
    await expect.poll(async () => (await statusTexts(sam)).filter((text) => text.startsWith('Uploading')).length, {
      timeout: 10_000,
    }).toBe(3);
    // Progress is the sender's: Sam has no bar filling in, only the fact of uploading
    // (the numbers themselves are the sender's own, see TC-17's component test).
    expect(await uploadProgress(sam)).toHaveLength(0);
    expect((await statusTexts(page)).filter((text) => text.startsWith('Uploading')).length).toBe(3);

    // And then the pictures themselves, decoded by the browser that fetched them.
    await waitForLoadedPictures(page, 3);
    await waitForLoadedPictures(sam, 3);
    const visible = await loadedPictures(sam);
    expect(visible.map((picture) => [picture.naturalWidth, picture.naturalHeight]).sort()).toEqual(
      [
        [120, 90],
        [1440, 900],
        [640, 480],
      ].sort(),
    );

    // How long the other screen took to hear about the drop, through the room. Logged,
    // not asserted (design "Not covered"): on a shared machine a slow room is a complaint
    // about the machine, not about the board. Measured to the placeholder rather than to
    // the finished picture, because the picture's own upload was delayed on purpose.
    console.log(
      `TC-25 drop-to-placeholder on the other screen: ${samSawThemAt - droppedAt} ms ` +
        `(budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms)`,
    );

    // A paste — the door with no mouse in it — reaches Sam the same way.
    await pasteImages(page, await imagePayloads('photo.webp'));
    await waitForImages(sam, 4);
    await waitForLoadedPictures(sam, 4);
  } finally {
    await closeScreens(pages);
  }
});

test('TC-26: a picker batch of a good file, a renamed PDF and an 11 MB JPEG adds one image and explains the rest', async ({
  page,
}) => {
  await gotoNewBoard(page);

  // `I`, as the design drives it, and the file dialog the app's input opened is answered
  // with three files at once.
  const good = await imagePayload('photo.png');
  const disguised = await imagePayload('fake.png'); // PDF bytes, .png name
  const tooBig = await oversizeJpegPayload(); // one byte past the limit, still a JPEG
  await pickImages(page, [good, disguised, tooBig], { via: 'key' });

  const images = await waitForImages(page, 1);
  expect(images[0]!.type).toBe('image');
  await waitForLoadedPictures(page, 1);

  // One sentence for the file that was not a picture, one for the one that was too big.
  const toasts = await toastTexts(page);
  expect(toasts).toContain(REJECTION_MESSAGES.type);
  expect(toasts).toContain(REJECTION_MESSAGES.size);
  expect(toasts).toHaveLength(2);
});

test('TC-27: an image keeps its proportions when it is resized, and comes back that way to the next visitor', async ({
  page,
}) => {
  const pages = [page];
  try {
    const id = await gotoNewBoard(page);
    await pickImages(page, [await imagePayload('photo.png')]);
    const [image] = await waitForImages(page, 1);
    await waitForLoadedPictures(page, 1);
    const box = page.locator(`[data-image-id="${image!.id}"]`);
    await expect(box).toBeVisible();
    const before = (await imageSnaps(page)).find((i) => i.id === image!.id)!;
    expect([before.width, before.height]).toEqual([120, 90]); // under the placement limit, so as saved

    // Selecting it offers the corner handles; pulling one out grows the picture.
    await box.click();
    await expect(page.getByTestId('handle-se')).toHaveCount(1);
    await dragHandle(page, 'se', 60, 40);

    const grown = (await imageSnaps(page)).find((i) => i.id === image!.id)!;
    expect(grown.width).toBeGreaterThan(before.width);
    expect(grown.x).toBeCloseTo(before.x, 6); // the far corner stayed where it was
    expect(grown.y).toBeCloseTo(before.y, 6);
    const natural = before.naturalWidth / before.naturalHeight;
    expect(Math.abs(grown.width / grown.height / natural - 1)).toBeLessThan(0.01);

    // A drag far past nothing stops at the minimum, and still does not distort.
    await dragHandle(page, 'se', -2000, -2000);
    const smallest = (await imageSnaps(page)).find((i) => i.id === image!.id)!;
    expect(Math.min(smallest.width, smallest.height)).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    expect(Math.abs(smallest.width / smallest.height / natural - 1)).toBeLessThan(0.01);

    // A later visitor, in a context that never saw any of it, reads the same size.
    const later = await openScreen(page, new URL(`/b/${id}`, page.url()).toString());
    pages.push(later);
    await waitForSynced(later);
    const revisited = await waitForImages(later, 1);
    expect(revisited[0]!.width).toBeCloseTo(smallest.width, 6);
    expect(revisited[0]!.height).toBeCloseTo(smallest.height, 6);
    await waitForLoadedPictures(later, 1);
  } finally {
    await closeScreens(pages);
  }
});

test('TC-28: a refused upload says Upload failed, and Retry sends the same picture through', async ({
  page,
}) => {
  await gotoNewBoard(page);

  // The network refuses, so the placeholder is all the board can show.
  await breakUploads(page);
  await dropImages(page, await imagePayloads('photo.png'), {
    ...(await page.viewportSize()!),
  } as never);
  const [image] = await waitForImages(page, 1);
  await waitForDisplayStatus(page, 'failed');
  expect(await statusTexts(page)).toEqual([IMAGE_STATUS_TEXT.failed]);
  await expect(page.getByTestId('image-retry')).toHaveCount(1);

  // The network comes back; the file is still held by this tab, so Retry sends it.
  await fixUploads(page);
  const whileFailed = (await imageSnaps(page)).find((i) => i.id === image!.id)!;
  expect(whileFailed.status).toBe('failed');
  await page.getByTestId('image-retry').click();
  await waitForDisplayStatus(page, 'ready');
  // The picture is the one it was meant to be: same bytes, fetched and decoded.
  await waitForLoadedPictures(page, 1);
  expect((await loadedPictures(page))[0]!.naturalWidth).toBe(120);
});
