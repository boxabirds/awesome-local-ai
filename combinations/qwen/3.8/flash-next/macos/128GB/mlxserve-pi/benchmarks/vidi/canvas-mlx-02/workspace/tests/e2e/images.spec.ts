// Story 12 end-to-end: images onto the board - the drop, the picker, the resize, and
// the upload that failed and is retried. These use the real Worker asset storage and a
// real second browser, so they run against the same `wrangler dev` the other board
// specs use, and every assertion is something a person can see (PRD: "images are
// ordinary objects on the board", "the board does not lie").
import { test, expect, type Page } from '@playwright/test';
import { gotoBoard } from './helpers/board.ts';
import { newCollaborator, openBoard } from './helpers/room.ts';
import {
  dropFiles,
  fixture,
  imageBoxes,
  imageEls,
  pickFiles,
  setCamera,
  dragLocatorBy,
} from './helpers/images.ts';
import { IMAGE_MIN_SIZE_WORLD } from '../../src/shared/config.ts';

// zoom 1 so a world unit is a screen pixel and a dropped box can be read straight off
// the DOM; the camera is reset so the dropped point is on screen for every browser.
async function boardAtOrigin(page: Page): Promise<string> {
  const id = await gotoBoard(page);
  await setCamera(page, { x: 0, y: 0, zoom: 1 });
  return id;
}

const PHOTOS = ['photo.png', 'second.png', 'third.png'].map(fixture);

// TC-25: the drop, seen by both people.
test('TC-25 dropping three images shows the uploader a placeholder each then each image, and the colleague sees the same', async ({ page, browser }) => {
  const id = await boardAtOrigin(page);
  const sam = await newCollaborator(browser);
  await openBoard(sam, id);

  // The colleague must be connected before the drop, so the placeholders are seen arrive.
  await expect.poll(() => sam.evaluate(() => (window as unknown as { __vidi6?: { connectionState?: string } }).__vidi6?.connectionState)).toMatch(/connected|confirmed/);

  await dropFiles(page, PHOTOS, { x: 200, y: 150 });

  // The uploader sees a placeholder for each file arrive in the drop order, then each
  // becomes its own real image once the upload finishes (images.drop).
  await expect(imageEls(page)).toHaveCount(3);
  await expect(page.locator('[data-object-id][data-image-status="ready"]')).toHaveCount(3, { timeout: 15_000 });

  // The colleague saw the placeholders appear as the drop happened and now has the
  // images - collaboration through the room, not through the uploader's browser.
  await expect(imageEls(sam)).toHaveCount(3);
  await expect(sam.locator('[data-object-id][data-image-status="ready"]')).toHaveCount(3, { timeout: 15_000 });

  // A ready image renders as a real <img> from the asset address, and the bytes load.
  // (readiness only means the upload finished; give the browser a moment to fetch them)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const imgs = [...document.querySelectorAll('[data-testid^="image-bit-"]')] as HTMLImageElement[];
        return imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
      }),
    )
    .toBe(3);
  const srcs = await page.evaluate(() =>
    [...document.querySelectorAll('[data-testid^="image-bit-"]')].map((i) => i.getAttribute('src') ?? ''),
  );
  for (const src of srcs) expect(src).toContain('/api/assets/');
});

// TC-26: the picker takes the good and refuses the bad, with a toast for each kind.
test('TC-26 the Image button picker adds the valid file and toasts the wrong type and the too-large one', async ({ page }) => {
  await boardAtOrigin(page);
  // Open the picker the way a person does and choose three files.
  await page.click('[data-testid="tool-image"]');
  await pickFiles(page, [
    fixture('photo.png'), // 200x120 png: added
    fixture('notimage.txt'), // a document, not an image: refused, type toast
    fixture('huge.png'), // 11 MB: refused, size toast
  ]);

  // Exactly the photo became an object; the other two are nowhere on the board.
  await expect(imageEls(page)).toHaveCount(1);

  // Both problems are named in a toast, and the board did not pretend anything worked.
  await expect(page.locator('[data-testid="toast"]')).toBeVisible();
  const toast = await page.locator('[data-testid="toast-message"]').allInnerTexts();
  expect(toast.join(' | ')).toContain('Only PNG, JPEG, GIF and WebP images can be added.');
  expect(toast.join(' | ')).toContain('Images must be 10 MB or smaller.');

  // And the one accepted file is not a placeholder stuck forever - it becomes the image.
  await expect(page.locator('[data-object-id][data-image-status="ready"]')).toHaveCount(1, { timeout: 15_000 });
});

// TC-27: an image resizes by its proportions, never below the minimum, and stays.
test('TC-27 resizing keeps the proportions and the minimum, and the image is there after a reload', async ({ page }) => {
  await boardAtOrigin(page);
  await dropFiles(page, [fixture('wide.png')], { x: 100, y: 100 });
  await expect(page.locator('[data-object-id][data-image-status="ready"]')).toHaveCount(1, { timeout: 15_000 });

  // Select the image so its resize handles appear.
  await page.mouse.click(200, 150);
  const se = page.locator('[data-handle="se"]');
  await expect(se).toHaveCount(1);

  const before = (await imageBoxes(page))[0];
  const aspectBefore = before.width / before.height; // 640 x 160 -> 4

  // Drag the bottom-right handle outward: the box grows, and its proportions hold
  // within a percent (images.resize - an image never becomes a stretched one).
  await dragLocatorBy(page, se, 200, 0);
  const grown = (await imageBoxes(page))[0];
  expect(grown.width).toBeGreaterThan(before.width);
  expect(Math.abs(grown.width / grown.height - aspectBefore)).toBeLessThan(0.01 * aspectBefore);

  // Drag the same handle far back toward the anchor: the box shrinks but stops at the
  // product minimum, and its proportions hold throughout - an image is never squashed
  // to reach the floor. Dragging the east edge (a single axis) keeps the requested
  // scale uniform, which is the path a person shrinking a photo takes.
  const grownNow = (await imageBoxes(page))[0];
  await dragLocatorBy(page, page.locator('[data-handle="e"]'), -(grownNow.width - 4), 0);
  const shrunk = (await imageBoxes(page))[0];
  expect(shrunk.width).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.5);
  expect(shrunk.height).toBeGreaterThanOrEqual(IMAGE_MIN_SIZE_WORLD - 0.5);
  expect(Math.min(shrunk.width, shrunk.height)).toBeCloseTo(IMAGE_MIN_SIZE_WORLD, 0);
  expect(Math.abs(shrunk.width / shrunk.height - aspectBefore)).toBeLessThan(0.02 * aspectBefore);

  // Reload: the image is still there, with the same proportions - it is a real object.
  await page.reload();
  await page.waitForSelector('[data-testid="viewport"]');
  await expect(imageEls(page)).toHaveCount(1);
  const kept = (await imageBoxes(page))[0];
  expect(Math.abs(kept.width / kept.height - aspectBefore)).toBeLessThan(0.02 * aspectBefore);
});

// TC-28: the upload that failed, and the Retry that puts it right.
test('TC-28 a failed upload offers the uploader Retry and Remove, and Retry puts the image back', async ({ page }) => {
  await boardAtOrigin(page);

  // Cut the asset upload off, so the drop's upload cannot get through (images.failed).
  await page.route('**/api/boards/*/assets', (route) => route.abort());
  await dropFiles(page, [fixture('photo.png')], { x: 150, y: 150 });

  // The object is still there - the drop did not silently swallow it - and says so:
  // a failed image, with the uploader's own Retry and Remove.
  await expect(page.locator('[data-object-id][data-image-status="failed"]')).toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();

  // Restore the network and retry: the File is still held, so the image appears.
  await page.unroute('**/api/boards/*/assets');
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('[data-object-id][data-image-status="ready"]')).toHaveCount(1, { timeout: 15_000 });
});
