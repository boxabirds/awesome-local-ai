/**
 * E2E helpers for image tests (story 12).
 */
import { expect, type Page } from '@playwright/test';

import { E2E_EVENTUAL_TIMEOUT_MS } from '../../../src/shared/config';

/**
 * Drop files onto the board at the given viewport coordinates.
 * Uses page.evaluate to create a synthetic DataTransfer with files.
 */
export async function dropFilesOnBoard(
  page: Page,
  files: { name: string; mimeType: string; bytes: number[] }[],
  x: number,
  y: number,
): Promise<void> {
  // Dispatch dragover first (preventDefault needed), then drop
  await page.evaluate(
    ({ files, x, y }) => {
      const target = document.elementFromPoint(x, y);
      if (!target) throw new Error('No element at point');

      // Build File objects in the browser context
      const fileList = files.map((f) => new File([new Uint8Array(f.bytes)], f.name, { type: f.mimeType }));

      const dt = new DataTransfer();
      for (const f of fileList) dt.items.add(f);

      const dragOverEvt = new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      });
      Object.defineProperty(dragOverEvt, 'dataTransfer', { value: dt });
      target.dispatchEvent(dragOverEvt);

      const dropEvt = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
      });
      Object.defineProperty(dropEvt, 'dataTransfer', { value: dt });
      target.dispatchEvent(dropEvt);
    },
    { files, x, y },
  );
}

/**
 * Wait for N image objects to appear in the Y.Doc.
 */
export async function waitForImagesCount(page: Page, count: number, timeout?: number): Promise<void> {
  await expect
    .poll(
      async () => {
        return page.evaluate(() => {
          const objects = document.querySelectorAll('[data-testid^="image-"][data-image-status]');
          return objects.length;
        });
      },
      { timeout: timeout ?? E2E_EVENTUAL_TIMEOUT_MS },
    )
    .toBe(count);
}

/**
 * Wait for an image to reach 'ready' status.
 */
export async function waitForImageReady(page: Page, timeout?: number): Promise<void> {
  await expect
    .poll(
      async () => {
        return page.evaluate(() => {
          const images = document.querySelectorAll('[data-testid^="image-"][data-image-status]');
          for (const el of images) {
            const status = el.getAttribute('data-image-status');
            if (status === 'ready') return true;
          }
          return false;
        });
      },
      { timeout: timeout ?? E2E_EVENTUAL_TIMEOUT_MS },
    )
    .toBe(true);
}

/**
 * Get image statuses from the DOM.
 */
export async function getImageStatuses(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const images = document.querySelectorAll('[data-testid^="image-"][data-image-status]');
    return Array.from(images).map((el) => el.getAttribute('data-image-status') ?? 'unknown');
  });
}

/**
 * Get the screen bounding rect of an image by index.
 */
export async function getImageScreenRect(page: Page, index: number): Promise<{ x: number; y: number; width: number; height: number }> {
  return page.evaluate((idx) => {
    const images = document.querySelectorAll('[data-testid^="image-"][data-image-status]');
    const el = images[idx];
    if (!el) throw new Error(`No image at index ${idx}`);
    const rect = el.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, index);
}

/** Minimal valid 1x1 red PNG (67 bytes) */
export function pngFileBytes(_size?: number): number[] {
  // Real valid 1x1 PNG that createImageBitmap can decode
  return [137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,0,1,0,0,0,1,8,2,0,0,0,144,119,83,222,0,0,0,12,73,68,65,84,120,156,99,248,207,192,0,0,3,1,1,0,201,254,146,239,0,0,0,0,73,69,78,68,174,66,96,130];
}

/** Minimal valid 1x1 JPEG */
export function jpegFileBytes(_size?: number): number[] {
  // Minimal valid JPEG (1x1 white pixel) - 125 bytes
  return [0xff,0xd8,0xff,0xe0,0x00,0x10,0x4a,0x46,0x49,0x46,0x00,0x01,0x01,0x00,0x00,0x01,0x00,0x01,0x00,0x00,0xff,0xdb,0x00,0x43,0x00,0x08,0x06,0x06,0x07,0x06,0x05,0x08,0x07,0x07,0x07,0x09,0x09,0x08,0x0a,0x0c,0x14,0x0d,0x0c,0x0b,0x0b,0x0c,0x19,0x12,0x13,0x0f,0x14,0x1d,0x1a,0x1f,0x1e,0x1d,0x1a,0x1c,0x1c,0x20,0x24,0x2e,0x27,0x20,0x22,0x2c,0x23,0x1c,0x1c,0x28,0x37,0x29,0x2c,0x30,0x31,0x34,0x34,0x34,0x1f,0x27,0x39,0x3d,0x38,0x32,0x3c,0x2e,0x33,0x34,0x32,0xff,0xc0,0x00,0x0b,0x08,0x00,0x01,0x00,0x01,0x01,0x01,0x11,0x00,0xff,0xc4,0x00,0x1f,0x00,0x00,0x01,0x05,0x01,0x01,0x01,0x01,0x01,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x02,0x03,0x04,0x05,0x06,0x07,0x08,0x09,0x0a,0x0b,0xff,0xc4,0x00,0xb5,0x10,0x00,0x02,0x01,0x03,0x03,0x02,0x04,0x03,0x05,0x05,0x04,0x04,0x00,0x00,0x01,0x7d,0x01,0x02,0x03,0x00,0x04,0x11,0x05,0x12,0x21,0x31,0x41,0x06,0x13,0x51,0x61,0x07,0x22,0x71,0x14,0x32,0x81,0x91,0xa1,0x08,0x23,0x42,0xb1,0xc1,0x15,0x52,0xd1,0xf0,0x24,0x33,0x62,0x72,0x82,0xff,0xda,0x00,0x08,0x01,0x01,0x00,0x00,0x3f,0x00,0xfb,0xfa,0x28,0x00,0x0a,0x28,0x03,0xff,0xd9];
}

/** PDF magic bytes */
export function pdfFileBytes(): number[] {
  return [0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0];
}
