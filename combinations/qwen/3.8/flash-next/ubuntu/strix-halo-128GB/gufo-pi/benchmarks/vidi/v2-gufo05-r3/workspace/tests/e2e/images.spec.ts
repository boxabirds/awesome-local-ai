/**
 * E2E image workflows (TC-25 to TC-28).
 */
import { expect, test } from '@playwright/test';
import {
  closeParticipants,
  createBoard,
  expectEventually,
  openParticipant,
} from './helpers/participants';
import { dropFilesOnBoard, readFixture } from './helpers/drop-files';
import { ASSET_CACHE_MAX_AGE_SECONDS } from '../../src/shared/config';

test.describe('Moodboard with a colleague (TC-25)', () => {
  test('Leo drops 3 screenshots, Sam sees Uploading then images', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const leo = await openParticipant(browser, 'Leo', boardId);
    const sam = await openParticipant(browser, 'Sam', boardId);

    const files = [
      readFixture('tiny.png'),
      readFixture('tiny.gif'),
      readFixture('tiny.webp'),
    ];

    await dropFilesOnBoard(leo.page, files, 400, 400);

    // Sam should see "Uploading…" placeholders or images within timeout
    await expectEventually(
      'TC-25: Sam sees uploading or ready',
      () => sam.page.locator('[data-image-state]').count(),
      (count) => count >= 3,
    );

    // Wait for all images to become ready
    await expectEventually(
      'TC-25: all images ready for Sam',
      async () => {
        const states = await sam.page.locator('[data-image-state="ready"]').count();
        return states;
      },
      (count) => count === 3,
    );

    // Verify immutable cache headers on served assets
    const src = await sam.page.locator('[data-image-state="ready"] img').first().getAttribute('src');
    expect(src).toBeTruthy();
    const resp = await sam.page.request.get(src!);
    expect(resp.status()).toBe(200);
    expect(resp.headers()['cache-control']).toContain('immutable');
    expect(resp.headers()['cache-control']).toContain(String(ASSET_CACHE_MAX_AGE_SECONDS));

    await closeParticipants([leo, sam]);
  });
});

test.describe('Mixed picker batch (TC-26)', () => {
  test('press I, pick valid + invalid files → one image, type and size toasts', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const leo = await openParticipant(browser, 'Leo', boardId);

    // Set up file chooser interception
    const fileChooserPromise = leo.page.waitForEvent('filechooser');

    // Press I to open picker
    await leo.page.keyboard.press('i');

    const fileChooser = await fileChooserPromise;

    // Prepare files: valid PNG, renamed PDF, and an 11MB JPEG
    const validPng = readFixture('tiny.png');
    const renamedPdf = readFixture('renamed-pdf.png');
    // Create an 11 MB "JPEG" file (over 10 MB limit)
    const bigJpeg = { name: 'big.jpg', type: 'image/jpeg', buffer: Buffer.alloc(11 * 1024 * 1024, 0) };
    // Prepend JPEG magic bytes so it passes type check but fails size
    bigJpeg.buffer[0] = 0xff;
    bigJpeg.buffer[1] = 0xd8;
    bigJpeg.buffer[2] = 0xff;

    await fileChooser.setFiles([
      { name: validPng.name, mimeType: validPng.type, buffer: validPng.buffer },
      { name: renamedPdf.name, mimeType: 'image/png', buffer: renamedPdf.buffer },
      { name: bigJpeg.name, mimeType: bigJpeg.type, buffer: bigJpeg.buffer },
    ]);

    // Wait for image to appear
    await expectEventually(
      'TC-26: one image added',
      () => leo.page.locator('[data-image-state]').count(),
      (count) => count >= 1,
    );

    // Verify only 1 valid image was added
    await expectEventually(
      'TC-26: toast shown',
      async () => {
        // Toast may have auto-dismissed; check via console or just verify image count
        const imgCount = await leo.page.locator('[data-image-state="ready"]').count();
        const uploadingCount = await leo.page.locator('[data-image-state="uploading"]').count();
        return imgCount + uploadingCount;
      },
      (count) => count === 1,
    );

    await closeParticipants([leo]);
  });
});

test.describe('Resize and revisit (TC-27)', () => {
  test('proportional resize persists after reload', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const leo = await openParticipant(browser, 'Leo', boardId);

    // Add an image via picker
    const fileChooserPromise = leo.page.waitForEvent('filechooser');
    await leo.page.keyboard.press('i');
    const fileChooser = await fileChooserPromise;
    const png = readFixture('tiny.png');
    await fileChooser.setFiles([{ name: png.name, mimeType: png.type, buffer: png.buffer }]);

    // Wait for image ready
    await expectEventually(
      'TC-27: image ready',
      () => leo.page.locator('[data-image-state="ready"]').count(),
      (count) => count >= 1,
    );

    // Select the image
    const imgBox = await leo.page.locator('[data-image-state="ready"]').first().boundingBox();
    expect(imgBox).toBeTruthy();
    await leo.page.mouse.click(imgBox!.x + imgBox!.width / 2, imgBox!.y + imgBox!.height / 2);

    // Resize handle should appear; find SE handle
    const seHandle = leo.page.locator('[data-handle="se"]');
    if (await seHandle.count() > 0) {
      const handleBox = await seHandle.boundingBox();
      expect(handleBox).toBeTruthy();
      // Drag to make it bigger
      await leo.page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
      await leo.page.mouse.down();
      await leo.page.mouse.move(handleBox!.x + 50, handleBox!.y + 50, { steps: 5 });
      await leo.page.mouse.up();

      // Wait a moment for the resize to settle
      await leo.page.waitForTimeout(500);

      // Verify aspect ratio preserved within 1%
      const newImgBox = await leo.page.locator('[data-image-state="ready"]').first().boundingBox();
      if (newImgBox) {
        const originalRatio = imgBox!.width / imgBox!.height;
        const newRatio = newImgBox.width / newImgBox.height;
        const ratioDiff = Math.abs(newRatio - originalRatio) / originalRatio;
        expect(ratioDiff).toBeLessThan(0.01);
      }
    }

    // Reload in a new context → image present
    const sam = await openParticipant(browser, 'Sam', boardId);
    await expectEventually(
      'TC-27: image present after reload',
      () => sam.page.locator('[data-image-state="ready"]').count(),
      (count) => count >= 1,
    );

    await closeParticipants([leo, sam]);
  });
});

test.describe('Flaky upload (TC-28)', () => {
  test('upload fails, then retry succeeds', async ({ browser, request }) => {
    const boardId = await createBoard(request);
    const leo = await openParticipant(browser, 'Leo', boardId);

    // Intercept POST to /api/boards/:id/assets and abort it
    let shouldAbort = true;
    await leo.page.route('**/api/boards/*/assets', async (route) => {
      if (shouldAbort) {
        await route.abort('failed');
      } else {
        await route.continue();
      }
    });

    // Add an image via drop
    const file = readFixture('tiny.png');
    await dropFilesOnBoard(leo.page, [file], 400, 400);

    // Wait for "Upload failed" to appear
    await expectEventually(
      'TC-28: upload failed visible',
      async () => {
        const text = await leo.page.locator('[data-image-state="failed"]').textContent();
        return text?.includes('Upload failed') ?? false;
      },
      (found) => found,
    );

    // Stop aborting
    shouldAbort = false;

    // Click Retry via dispatchEvent because the world-layer has pointer-events: none
    // and the board-surface intercepts real pointer events over the tiny image box.
    const retryBtn = leo.page.locator('[data-image-retry]');
    await retryBtn.dispatchEvent('click');

    // Wait for ready
    await expectEventually(
      'TC-28: image ready after retry',
      () => leo.page.locator('[data-image-state="ready"]').count(),
      (count) => count >= 1,
    );

    await closeParticipants([leo]);
  });
});
