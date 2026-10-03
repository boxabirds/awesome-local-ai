// Reading the pictures on a board the way a person's screen shows them (story 12 e2e).
//
// Two reads, and the difference between them is the point. `imagesOn` is the *document*: what the
// shared model holds for this client, including a placeholder nobody has drawn yet. `paintedOf` is the
// *screen*: the box as it is laid out, the words inside it as they are worded, the address of the
// picture as it was asked for. A story about states is a story about the second of those, and a story
// about a shared document is a story about the first; a test that only reads one of them cannot tell a
// working board from a board that stopped painting.

import { expect, type Page } from '@playwright/test';
import type { ImageSnap } from '../../../src/shared/objects/image';

/** Every picture on this client's board, in document order, in whichever state it is in. */
export async function imagesOn(page: Page): Promise<ImageSnap[]> {
  return page.evaluate(() => {
    const api = window.__vidi6TestBoard;
    if (!api) throw new Error('window.__vidi6TestBoard missing');
    // Sorted by id so two clients' lists can be compared without the order they happen to arrive in
    // being part of an assertion.
    return [...api.images()].sort((a, b) => (a.id < b.id ? -1 : 1));
  });
}

export async function imageIdsOn(page: Page): Promise<string[]> {
  return (await imagesOn(page)).map((image) => image.id);
}

/** One picture's model, by id. */
export async function imageOf(page: Page, id: string): Promise<ImageSnap> {
  const found = (await imagesOn(page)).find((image) => image.id === id);
  if (!found) throw new Error(`no image ${id} on this board`);
  return found;
}

/** What one picture's box says on this screen right now. */
export interface PaintedImage {
  /** The state the box is painted as, from `data-image-status`, or null when it is not painted. */
  status: string | null;
  /** The words inside the box: 'Uploading…', 'Upload failed', 'Image unavailable', … */
  stateText: string;
  /** The address the picture is being asked for, or null when nothing is being asked for. */
  src: string | null;
  /** 'self' when this screen offers a Retry, 'other' when it does not. */
  uploader: string | null;
  /** Painted box, in screen pixels. */
  box: { x: number; y: number; width: number; height: number } | null;
  /** Whether a Retry button is on screen on this box. */
  retry: boolean;
  /** Whether a Remove button is on screen on this box. */
  remove: boolean;
}

/** The box as this person's screen draws it, words and all. */
export async function paintedOf(page: Page, id: string): Promise<PaintedImage> {
  return page.evaluate((objectId) => {
    const el = document.querySelector<HTMLElement>(`[data-testid="image-object-${objectId}"]`);
    const img = document.querySelector<HTMLImageElement>(`[data-testid="image-${objectId}"]`);
    const rect = el?.getBoundingClientRect();
    return {
      status: el?.getAttribute('data-image-status') ?? null,
      stateText:
        document.querySelector(`[data-testid="image-state-${objectId}"]`)?.textContent?.trim() ?? '',
      src: img?.getAttribute('src') ?? null,
      uploader: el?.getAttribute('data-image-uploader') ?? null,
      box: rect
        ? {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
        : null,
      retry: Boolean(document.querySelector(`[data-testid="image-retry-${objectId}"]`)),
      remove: Boolean(document.querySelector(`[data-testid="image-remove-${objectId}"]`)),
    };
  }, id);
}

/** The picture's own progress, as the uploader's screen shows it: 'Uploading 40%' or null. */
export async function paintedProgress(page: Page, id: string): Promise<string | null> {
  const words = await page.evaluate((objectId) => {
    const box = document.querySelector<HTMLElement>(`[data-testid="image-object-${objectId}"]`);
    return box?.textContent ?? '';
  }, id);
  const match = words.match(/Uploading \d+%/) ?? words.match(/Uploading…/);
  return match ? match[0] : null;
}

/**
 * What the bar says, when this screen was given a bar at all: the percentage, or null.
 *
 * Read separately from the words above, because only the person who is waiting on the file is allowed
 * a number (image.placeholder_other) — a helper that returns null for "no bar" and null for "no words"
 * tells a test nothing about which of the two it is looking at.
 */
export async function progressBarOn(page: Page, id: string): Promise<number | null> {
  return page.evaluate((objectId) => {
    const bar = document.querySelector(`[data-testid="image-progress-${objectId}"]`);
    const now = bar?.getAttribute('aria-valuenow');
    return now === null || now === undefined ? null : Number(now);
  }, id);
}

/**
 * Wait until this screen shows a picture whose painted state is `status`.
 *
 * The state is read from the screen and not from the document on purpose: `image.object` is a story
 * about which box is drawn, and a board that has the right document and the wrong screen is exactly
 * the bug this would miss.
 */
export async function waitForPainted(
  page: Page,
  id: string,
  status: string,
  timeout = 15_000,
): Promise<PaintedImage> {
  let latest: PaintedImage | undefined;
  await expect
    .poll(
      async () => {
        latest = await paintedOf(page, id);
        return latest.status === status;
      },
      { timeout, message: `the box never became ${status}` },
    )
    .toBe(true);
  return latest as PaintedImage;
}

/** The pictures on this screen, as the document this client holds says they are. */
export async function waitForImageCount(
  page: Page,
  count: number,
  timeout = 15_000,
): Promise<ImageSnap[]> {
  let latest: ImageSnap[] = [];
  await expect
    .poll(
      async () => {
        latest = await imagesOn(page);
        return latest.length === count;
      },
      { timeout, message: `expected ${count} pictures on the board` },
    )
    .toBe(true);
  return latest;
}

/** Press a picture where it is drawn: selects it, in whichever state it is in. */
export async function clickImage(page: Page, id: string): Promise<void> {
  await page.keyboard.press('Escape');
  await page.getByTestId(`image-hit-${id}`).click();
}

/** A picture's box on this screen, in screen pixels. */
export async function imageScreenBox(
  page: Page,
  id: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await page.getByTestId(`image-hit-${id}`).boundingBox();
  if (!box) throw new Error(`image ${id} is not on screen`);
  return box;
}

/**
 * The toasts on this screen, by their exact words, oldest first.
 *
 * Read from `data-toast-text` rather than `textContent`, because a toast also contains the word on its
 * dismiss button and a test that compares wording has to compare the wording and nothing else.
 */
export async function toastsOn(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="toast"]')).map(
      (el) => el.getAttribute('data-toast-text') ?? '',
    ),
  );
}

/** Wait until a toast with these exact words is on screen. */
export async function waitForToast(page: Page, text: string, timeout = 10_000): Promise<void> {
  await expect
    .poll(async () => (await toastsOn(page)).includes(text), { timeout, message: text })
    .toBe(true);
}

/** The picture's address, as the person's screen asked for it. */
export async function imageSrc(page: Page, id: string): Promise<string | null> {
  return page.evaluate((objectId) => {
    const img = document.querySelector<HTMLImageElement>(`[data-testid="image-${objectId}"]`);
    return img?.getAttribute('src') ?? null;
  }, id);
}

/**
 * How many of this board's pictures this screen has actually drawn.
 *
 * `complete && naturalWidth` and not merely "an `<img>` exists": an image element is in the document
 * the moment its address is, and a picture that never arrived is exactly the thing this story is about.
 * It is also what a `loading="lazy"` picture does — one that is off screen is not drawn, which is why
 * the tests put their camera where their pictures are.
 */
export async function drawnCount(page: Page): Promise<number> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>('img[data-testid^="image-"]')).filter(
      (img) => img.complete && img.naturalWidth > 0,
    ).length,
  );
}

/** Wait until this screen has drawn `count` pictures. */
export async function waitForDrawnCount(
  page: Page,
  count: number,
  timeout = 15_000,
): Promise<number> {
  await expect
    .poll(async () => drawnCount(page), { timeout, message: `expected ${count} drawn pictures` })
    .toBe(count);
  return count;
}
