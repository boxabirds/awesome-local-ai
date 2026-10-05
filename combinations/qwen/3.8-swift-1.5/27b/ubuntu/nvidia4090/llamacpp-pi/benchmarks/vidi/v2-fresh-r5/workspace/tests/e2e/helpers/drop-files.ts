/**
 * Helper for simulating file drag-and-drop in e2e tests (story 12).
 * Builds a DataTransfer from fixture file content and dispatches
 * dragenter/dragover/drop events at a board point.
 */
import type { Page } from '@playwright/test';

/**
 * Drop files onto the board at the given screen coordinates.
 * The files are specified as { name, type, content (base64) }.
 */
export async function dropFiles(
  page: Page,
  files: Array<{ name: string; type: string; content: string }>,
  x: number,
  y: number,
): Promise<void> {
  await page.evaluate(
    ({ files, x, y }) => {
      const dt = new DataTransfer();
      for (const f of files) {
        const bytes = Uint8Array.from(atob(f.content), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: f.type });
        const file = new File([blob], f.name, { type: f.type });
        dt.items.add(file);
      }

      const target = document.querySelector('.board-viewport')!;

      const dragEnter = new DragEvent('dragenter', {
        bubbles: true,
        clientX: x,
        clientY: y,
        dataTransfer: dt,
      });
      target.dispatchEvent(dragEnter);

      const dragOver = new DragEvent('dragover', {
        bubbles: true,
        clientX: x,
        clientY: y,
        dataTransfer: dt,
      });
      target.dispatchEvent(dragOver);

      const drop = new DragEvent('drop', {
        bubbles: true,
        clientX: x,
        clientY: y,
        dataTransfer: dt,
      });
      target.dispatchEvent(drop);
    },
    { files, x, y },
  );
}

/**
 * A minimal valid 1x1 PNG as base64 (for unit/integration tests).
 */
export const MINIMAL_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * Generate a PNG of the given size using a canvas in the browser.
 * Returns the PNG as a base64 string (without the data: prefix).
 */
export async function generatePngBase64(page: Page, width: number, height: number, color = '#3498db'): Promise<string> {
  return page.evaluate(({ w, h, c }) => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, w, h);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { w: width, h: height, c: color });
}

/**
 * A minimal valid 1x1 JPEG as base64.
 */
export const MINIMAL_JPEG_BASE64 =
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

/**
 * A small valid GIF (1x1 red pixel) as base64.
 */
export const MINIMAL_GIF_BASE64 =
  'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

/**
 * A minimal valid WebP (1x1) as base64.
 */
export const MINIMAL_WEBP_BASE64 =
  'UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';
