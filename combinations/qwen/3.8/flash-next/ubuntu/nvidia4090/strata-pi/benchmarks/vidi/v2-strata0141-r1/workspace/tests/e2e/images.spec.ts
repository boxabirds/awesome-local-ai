import { expect, test } from '@playwright/test';
import {
  E2E_EVENTUAL_TIMEOUT_MS,
  IMAGE_LAYOUT_GAP_WORLD,
  IMAGE_MAX_PLACE_SIZE_WORLD,
  IMAGE_MIN_SIZE_WORLD,
  LIVE_UPDATE_LATENCY_BUDGET_MS,
} from '../../src/shared/config';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';
import { near, openBoard } from './helpers/board';
import { dragHandle, setFlatCamera } from './helpers/selection';
import { joinBoard, newLiveBoardId } from './helpers/live';
import {
  clickImageButton,
  clickImage,
  fixtureFile,
  imageSnapshot,
  imageSnapshots,
  imageToasts,
  oversizedImage,
  paintedImage,
  pickFiles,
  renamedPdf,
  startImageWatch,
  stateBoxText,
  statusesShown,
  dropFiles,
  waitForImage,
  waitForImageCount,
  waitForImageIds,
  waitForImageSelected,
  waitForRenderedStatus,
  waitForShownImage,
} from './helpers/images';

/**
 * Story 12 - images dropped onto the board, in real browsers (task 9).
 *
 * Anchors: `image.insert` (a drop, a paste, a pick), `image.uploading`,
 * `image.reject`, `image.object` (a placeholder that becomes a picture, and a
 * picture that can be moved and resized like anything else), `image.upload_failure`
 * (Retry sends the same file again) and `assets.api` (the bytes are stored once and
 * served to everybody).
 *
 * TC-25, TC-26, TC-27 and TC-28. Wall-clock delivery time is logged against
 * LIVE_UPDATE_LATENCY_BUDGET_MS and never asserted: on this machine the Worker, the
 * browsers and the Y.Doc all share the same cores.
 */

const PNG = () => fixtureFile('photo.png'); // 640x480
const JPEG = () => fixtureFile('photo.jpg'); // 640x480
const WEBP = () => fixtureFile('photo.webp');

test.describe('images brought onto a board', () => {
  test('TC-25: three dropped files become three images everybody sees', async ({ browser }) => {
    const boardId = newLiveBoardId();
    const samContext = await browser.newContext();
    const otherContext = await browser.newContext();
    const sam = await joinBoard(samContext, boardId);
    const other = await joinBoard(otherContext, boardId);

    // World units and screen pixels are the same numbers, so the drop point is a
    // fact about the board rather than about this camera.
    await setFlatCamera(sam);
    await startImageWatch(sam);
    await startImageWatch(other);

    const where = { x: 200, y: 140 };
    const droppedAt = Date.now();
    await dropFiles(sam, [PNG(), JPEG(), WEBP()], where);

    // The person who dropped them sees placeholders: three objects, in a row,
    // hanging from the point the files landed on.
    const placed = await waitForImageCount(sam, 3);
    const placeholdersAt = Date.now() - droppedAt;
    const ids = placed.map((image) => image.id);
    expect(placed.map((image) => image.type)).toEqual(['image', 'image', 'image']);

    const ordered = [...placed].sort((a, b) => a.x - b.x);
    const gaps = ordered.slice(1).map((image, index) => {
      const previous = ordered[index]!;
      return image.x - (previous.x + previous.width);
    });
    for (const gap of gaps) {
      expect(near(gap, IMAGE_LAYOUT_GAP_WORLD, 1)).toBe(true);
    }
    for (const image of ordered) {
      expect(near(image.y, where.y, 1)).toBe(true);
      expect(image.width).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD + 1);
      expect(image.height).toBeLessThanOrEqual(IMAGE_MAX_PLACE_SIZE_WORLD + 1);
    }
    // A placeholder is the size the finished image will be: this PNG is 640x480 and
    // its longest side is under the cap, so it is placed as it is.
    const png = placed.find((image) => near(image.width, 640, 1) && near(image.height, 480, 1));
    expect(png).toBeTruthy();

    // Somebody else on the board has the same three objects, without having dropped
    // anything: the placeholders are part of the board, not of this browser.
    const seenByOther = await waitForImageIds(other, ids);
    const otherPlaceholdersAt = Date.now() - droppedAt;
    expect(seenByOther.map((image) => image.id).sort()).toEqual([...ids].sort());

    // Every one of them becomes a picture, on both boards.
    for (const id of ids) {
      const onSam = await waitForShownImage(sam, id);
      expect(onSam.naturalWidth).toBeGreaterThan(0);
      expect(onSam.naturalHeight).toBeGreaterThan(0);
      expect(onSam.src).toContain(`/api/assets/`);
    }
    const allVisibleAt = Date.now() - droppedAt;
    for (const id of ids) {
      await waitForShownImage(other, id);
    }
    const otherVisibleAt = Date.now() - droppedAt;

    // The drop put a placeholder on this board before any of them was a picture:
    // the uploading state was rendered, not skipped.
    for (const id of ids) {
      const shown = await statusesShown(sam, id);
      expect(shown).toContain('uploading');
      expect(shown[shown.length - 1]).toBe('ready');
    }

    console.log(
      `TC-25 drop to placeholders: ${placeholdersAt} ms (budget ${LIVE_UPDATE_LATENCY_BUDGET_MS} ms, logged not asserted); ` +
        `drop to all three visible on the uploader's board: ${allVisibleAt} ms; ` +
        `on the other board: ${otherVisibleAt} ms (other saw placeholders at +${otherPlaceholdersAt} ms)`,
    );

    // The bytes are stored once: two browsers fetched the same key and got the same picture.
    const samAssetKeys = (await imageSnapshots(sam)).map((image) => image.assetKey).sort();
    const otherAssetKeys = (await imageSnapshots(other)).map((image) => image.assetKey).sort();
    expect(samAssetKeys).toEqual(otherAssetKeys);
    for (const key of samAssetKeys) {
      expect(key).not.toBeNull();
    }

    await samContext.close();
    await otherContext.close();
  });

  test('TC-26: the picker takes the image and says what it refused', async ({ page }) => {
    await openBoard(page);
    await setFlatCamera(page);

    // An image, a PDF wearing a PNG name, and a JPEG bigger than the limit - one
    // accepted, two refused, each for its own reason (`images.validate`, `image.reject`).
    await pickFiles(page, [PNG(), renamedPdf(), oversizedImage()]);

    const images = await waitForImageCount(page, 1);
    const shown = await waitForShownImage(page, images[0]!.id);
    expect(near(shown.naturalWidth, 640, 1)).toBe(true);
    expect(near(shown.naturalHeight, 480, 1)).toBe(true);

    const toasts = await imageToasts(page);
    expect(toasts).toContain(REJECTION_MESSAGES.type);
    expect(toasts).toContain(REJECTION_MESSAGES.size);
    expect(toasts).toHaveLength(2);
  });

  test('TC-27: a resized image keeps its shape, has a floor, and is there on revisit', async ({
    browser,
  }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    const boardId = await openBoard(page);
    await setFlatCamera(page);

    // A picked image lands at the centre of the view, not under the pointer. Here the
    // picker is opened from the toolbar button (`image.pick`).
    await pickFiles(page, [PNG()], 'button');
    const image = (await waitForImageCount(page, 1))[0]!;
    await waitForShownImage(page, image.id);
    const ratio = image.width / image.height;
    expect(near(image.width, 640, 1)).toBe(true);
    expect(near(image.height, 480, 1)).toBe(true);

    await clickImage(page, image);
    await waitForImageSelected(page, image.id);

    // A corner drag: both sides move by the same factor (`image.aspect_resize`).
    await dragHandle(page, 'se', 140, 105);
    const resized = await waitForImage(
      page,
      image.id,
      (entry) => near(entry.width, image.width + 140, 2),
      'bigger by the drag',
    );
    expect(Math.abs(resized.width / resized.height / ratio - 1)).toBeLessThan(0.01);
    const paintedAfterResize = await paintedImage(page, image.id);
    expect(paintedAfterResize).toBeTruthy();
    expect(Math.abs(paintedAfterResize!.width / paintedAfterResize!.height / ratio - 1)).toBeLessThan(0.01);

    // The floor: the same corner dragged past the opposite one stops at the smallest
    // size a board allows (`sel.size_limits`). The drag ends near the top-left of the
    // viewport, which is well past this image's north-west corner.
    await dragHandle(page, 'se', -1_080, -725);
    const clamped = await waitForImage(
      page,
      image.id,
      (entry) => entry.width <= resized.width - 100,
      'as small as the drag asked for',
    );
    expect(clamped.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    expect(clamped.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD);
    expect(Math.abs(clamped.width / clamped.height / ratio - 1)).toBeLessThan(0.02);

    await context.close();

    // A person arriving later, in a browser that never saw the drop or the upload,
    // gets the same picture at the same size (`assets.api`, `image.ready`).
    const later = await browser.newContext();
    const laterPage = await joinBoard(later, boardId);
    const again = (await waitForImageCount(laterPage, 1))[0]!;
    expect(again.id).toBe(image.id);
    expect(again.status).toBe('ready');
    expect(near(again.width, clamped.width, 1)).toBe(true);
    expect(near(again.height, clamped.height, 1)).toBe(true);
    const shown = await waitForShownImage(laterPage, image.id);
    expect(shown.naturalWidth).toBeGreaterThan(0);
    expect(shown.complete).toBe(true);

    await later.close();
  });

  test('TC-28: an upload that does not arrive is retried', async ({ page }) => {
    const context = page.context();
    await openBoard(page);
    await setFlatCamera(page);

    // The way this harness can cut the wire for uploads: the board is already open
    // over its own connection, which offline emulation leaves alone, while a new
    // request from the page cannot go out. (Playwright cannot intercept the upload
    // itself - its body is a stream - so the whole context loses the network for a
    // moment; see NOTES.md.)
    await context.setOffline(true);

    await startImageWatch(page);
    await dropFiles(page, [PNG()], { x: 220, y: 160 });
    const image = (await waitForImageCount(page, 1))[0]!;

    // The person who dropped it is told in the place they are looking (`image.upload_failure`).
    await waitForRenderedStatus(page, image.id, 'failed');
    expect(await stateBoxText(page, image.id)).toContain('Upload failed');
    await expect(page.getByTestId(`image-retry-${image.id}`)).toBeVisible();
    await expect(page.getByTestId(`image-remove-${image.id}`)).toBeVisible();
    const stored = await imageSnapshot(page, image.id);
    expect(stored?.assetKey).toBeNull();

    // The wire comes back, and Retry sends the same file: the object is filled in,
    // not replaced (`image.retry`).
    await context.setOffline(false);
    await clickImageButton(page, `image-retry-${image.id}`);
    // Retry puts the placeholder back under the way, visibly (`image.uploading` again).
    await expect
      .poll(async () => (await statusesShown(page, image.id)).includes('uploading'), {
        timeout: E2E_EVENTUAL_TIMEOUT_MS,
        message: 'the retry never showed the image as uploading',
      })
      .toBe(true);
    const shown = await waitForShownImage(page, image.id);
    expect(near(shown.naturalWidth, 640, 1)).toBe(true);

    const ready = await imageSnapshot(page, image.id);
    expect(ready?.status).toBe('ready');
    expect(ready?.assetKey).not.toBeNull();
    expect(ready?.id).toBe(image.id);

    // The served bytes are the picture, not a copy of a placeholder.
    const assetKey = ready!.assetKey!;
    const response = await page.request.fetch(`/api/assets/${assetKey}`);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/png');
    expect(Number(response.headers()['content-length'])).toBeGreaterThan(0);
  });
});
