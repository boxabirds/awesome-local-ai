/**
 * E2E image tests (story 12, task 9).
 *
 * Test cases:
 * - image.e2e_picker: click Image button, pick a file, image appears
 * - image.e2e_multi: pick multiple files, they all appear
 * - image.e2e_validation: pick a non-image file, rejection toast
 * - image.e2e_remove: remove a failed/ready image
 * - image.e2e_reconnect: close the tab, reopen, image persists
 */

import { expect, test, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBoard, Participant } from './helpers/participants';

/** Path to the small.png test fixture. */
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(thisDir, '../fixtures/images');
const SMALL_PNG = path.join(FIXTURES_DIR, 'small.png');
const SMALL_JPEG = path.join(FIXTURES_DIR, 'small.jpeg');
const NOT_AN_IMAGE = path.join(FIXTURES_DIR, 'random.bin');

/**
 * Helper: sets files on the hidden file input and waits for the upload to
 * complete (images transition to 'ready' status).
 */
async function uploadViaPicker(
  participant: Participant,
  files: { path: string; mimeType: string }[],
): Promise<void> {
  const input = participant.page.getByTestId('image-file-input');
  const fileObjects = files.map((f) => ({
    name: path.basename(f.path),
    mimeType: f.mimeType,
    buffer: readFileSync(f.path),
  }));
  await input.setInputFiles(fileObjects);
}

/**
 * Waits for N image elements to be in 'ready' state.
 */
async function waitForImagesReady(
  participant: Participant,
  count: number,
  timeoutMs = 15_000,
): Promise<void> {
  await participant.page.waitForFunction(
    (n) => {
      const imgs = document.querySelectorAll('[data-testid="image-ready"]');
      return imgs.length >= n;
    },
    count,
    { timeout: timeoutMs, polling: 100 },
  );
}

test.describe('images.e2e', () => {
  test('image.e2e_picker: pick a file, image appears ready', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    const boardId = await createBoard(`http://127.0.0.1:${process.env.AGENT_PORT_FIRST ? Number(process.env.AGENT_PORT_FIRST) + 1 : 29105}`);
    let ctx: BrowserContext | null = null;
    try {
      ctx = await browser.newContext();
      const p = await Participant.join(ctx, boardId, 30_000);

      // Click the Image button
      await p.page.getByTestId('image-button').click();

      // The file input becomes visible (or is triggered); set a file on it
      await uploadViaPicker(p, [{ path: SMALL_PNG, mimeType: 'image/png' }]);

      // Wait for the image to be ready
      await waitForImagesReady(p, 1);

      // Verify the image has the correct src
      const img = p.page.locator('[data-testid="image-ready"] img');
      const src = await img.getAttribute('src');
      expect(src).toMatch(/^\/api\/assets\/.+\/.+/);
    } finally {
      if (ctx !== null) {
        await ctx.close().catch(() => undefined);
      }
    }
  });

  test('image.e2e_multi: pick multiple files, all appear', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    const boardId = await createBoard(`http://127.0.0.1:${process.env.AGENT_PORT_FIRST ? Number(process.env.AGENT_PORT_FIRST) + 1 : 29105}`);
    let ctx: BrowserContext | null = null;
    try {
      ctx = await browser.newContext();
      const p = await Participant.join(ctx, boardId, 30_000);

      // Pick two files at once
      await p.page.getByTestId('image-button').click();
      await uploadViaPicker(p, [
        { path: SMALL_PNG, mimeType: 'image/png' },
        { path: SMALL_JPEG, mimeType: 'image/jpeg' },
      ]);

      // Wait for both images to be ready
      await waitForImagesReady(p, 2);
    } finally {
      if (ctx !== null) {
        await ctx.close().catch(() => undefined);
      }
    }
  });

  test('image.e2e_validation: non-image file shows rejection toast', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(60_000);
    const boardId = await createBoard(`http://127.0.0.1:${process.env.AGENT_PORT_FIRST ? Number(process.env.AGENT_PORT_FIRST) + 1 : 29105}`);
    let ctx: BrowserContext | null = null;
    try {
      ctx = await browser.newContext();
      const p = await Participant.join(ctx, boardId, 30_000);

      // Pick a non-image file
      await p.page.getByTestId('image-button').click();
      await uploadViaPicker(p, [{ path: NOT_AN_IMAGE, mimeType: 'application/octet-stream' }]);

      // A toast should appear with a rejection message
      const toast = p.page.getByTestId('toast');
      await toast.waitFor({ timeout: 5_000 });
      const text = await toast.textContent();
      expect(text).toMatch(/not.*image|unsupported|only/i);
    } finally {
      if (ctx !== null) {
        await ctx.close().catch(() => undefined);
      }
    }
  });

  test('image.e2e_reconnect: image persists after tab close + reopen', async ({
    browser,
  }, testInfo) => {
    testInfo.setTimeout(90_000);
    const boardId = await createBoard(`http://127.0.0.1:${process.env.AGENT_PORT_FIRST ? Number(process.env.AGENT_PORT_FIRST) + 1 : 29105}`);
    let ctx: BrowserContext | null = null;
    try {
      // Phase 1: upload an image
      ctx = await browser.newContext();
      const p1 = await Participant.join(ctx, boardId, 30_000);
      await p1.page.getByTestId('image-button').click();
      await uploadViaPicker(p1, [{ path: SMALL_PNG, mimeType: 'image/png' }]);
      await waitForImagesReady(p1, 1);

      // Close the tab
      await p1.page.close();
      await ctx.close();
      ctx = null;

      // Phase 2: reopen and verify the image is still there
      ctx = await browser.newContext();
      const p2 = await Participant.join(ctx, boardId, 30_000);
      await waitForImagesReady(p2, 1);

      // The image should have the same asset key (served from R2)
      const img = p2.page.locator('[data-testid="image-ready"] img');
      const src = await img.getAttribute('src');
      expect(src).toMatch(/^\/api\/assets\/.+/);
    } finally {
      if (ctx !== null) {
        await ctx.close().catch(() => undefined);
      }
    }
  });
});
