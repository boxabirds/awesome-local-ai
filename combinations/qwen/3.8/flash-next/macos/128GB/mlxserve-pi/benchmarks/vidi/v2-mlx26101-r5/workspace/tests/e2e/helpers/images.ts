/**
 * Reading a board's pictures from the outside.
 *
 * An image is the only object on this board that is not completely inside the document: the bytes live in a
 * bucket behind a second endpoint, and whether a person can see the picture depends on a request that the
 * document knows nothing about. So the questions a test asks about a picture are not the questions it asks
 * about a sticky note. `data-status` answers "what has this board decided this object is", which is a fact
 * in the shared document and the same on every screen; `img.naturalWidth` answers "and did the picture
 * actually arrive in this browser", which is a fact about one browser and is the one thing that cannot be
 * read from the document at all. Both are below, deliberately apart, because the gap between them — a board
 * that says *ready* over a picture that never loaded — is a state no other object on this board can be in.
 *
 * The upload controls at the bottom of the file are the browser's own network layer, used for exactly two
 * things no local fake can do: holding a request open so that the *uploading* state lasts long enough for a
 * second person to be looking at it, and refusing one so that the failure is a real one. Both are the
 * browser declining to do what it was asked, which is precisely what a flaky network is; neither rewrites the
 * board's behaviour, and neither is needed for the board's own decisions, which are made from the response
 * whatever took so long to give it.
 */

import { expect, type Locator, type Page, type Response } from '@playwright/test';

/** One picture's box, wherever it came from. */
export const imageObject = (page: Page, id: string): Locator => page.locator(`[data-object-id="${id}"]`);

/** The picture inside the box, which exists only once the bytes have arrived in *this* browser. */
export const imageElement = (page: Page, id: string): Locator =>
  page.locator(`[data-object-id="${id}"] img`);

/** The uploader's own two buttons, inside one box. */
export const imageRetryButton = (page: Page, id: string): Locator =>
  imageObject(page, id).getByTestId('image-retry');
export const imageRemoveButton = (page: Page, id: string): Locator =>
  imageObject(page, id).getByTestId('image-remove');

/** The uploader's progress readout: `Uploading… 40 %` while a fraction is arriving. */
export const imageProgressText = (page: Page, id: string): Locator =>
  imageObject(page, id).getByTestId('image-progress-text');

/** Every image object on the board, in document order. */
export async function imageIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-testid="image-object"]')).map(
      (element) => element.dataset.objectId as string,
    ),
  );
}

export async function imageCount(page: Page): Promise<number> {
  return (await imageIds(page)).length;
}

/** Waits for the board to hold this many image objects, and hands back their ids. */
export async function expectImageCount(page: Page, count: number): Promise<string[]> {
  await expect
    .poll(() => imageCount(page), { timeout: 15_000, message: `waiting for ${count} image(s)` })
    .toBe(count);
  return imageIds(page);
}

/**
 * What the shared document says this object is: `uploading`, `ready`, `failed`, `unfinished` or
 * `unavailable`. Null when there is no such object.
 *
 * This is read out of the DOM rather than out of the document because a test cannot hold the document — it
 * is behind the app's own connection — and because the attribute *is* the rendering of `displayStatus`, so
 * reading it is reading the state as the person sees it.
 */
export async function imageStatus(page: Page, id: string): Promise<string | null> {
  return page.evaluate((objectId) => {
    const element = document.querySelector<HTMLElement>(`[data-object-id="${objectId}"]`);
    return element?.dataset.status ?? null;
  }, id);
}

/** What a person can read inside one box: "Upload failed", "Uploading…", and so on. */
export async function imageText(page: Page, id: string): Promise<string> {
  return page.evaluate((objectId) => {
    const element = document.querySelector<HTMLElement>(`[data-object-id="${objectId}"]`);
    return element?.textContent?.trim() ?? '';
  }, id);
}

/** Every box on the board, as the person sees it: which state, and what it says. */
export interface ImageOnScreen {
  id: string;
  status: string | null;
  text: string;
}

export async function imagesOnScreen(page: Page): Promise<ImageOnScreen[]> {
  const ids = await imageIds(page);
  const boxes: ImageOnScreen[] = [];
  for (const id of ids) boxes.push({ id, status: await imageStatus(page, id), text: await imageText(page, id) });
  return boxes;
}

/** How many boxes on this screen are holding a picture that this browser has actually decoded. */
export async function picturesVisible(page: Page): Promise<number> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLImageElement>('[data-object-id] img')).filter(
      (img) => img.complete && img.naturalWidth > 0,
    ).length,
  );
}

/** The address a box is fetching from — `<boardId>/<assetId>` — and what this browser knows about it. */
export async function pictureSource(page: Page, id: string): Promise<string | null> {
  return page.evaluate((objectId) => {
    const img = document.querySelector<HTMLImageElement>(`[data-object-id="${objectId}"] img`);
    return img?.getAttribute('src') ?? null;
  }, id);
}

/** What this browser decoded: the file's own pixel size, which the board never stores in the DOM. */
export async function decodedSize(page: Page, id: string): Promise<{ width: number; height: number }> {
  return page.evaluate((objectId) => {
    const img = document.querySelector<HTMLImageElement>(`[data-object-id="${objectId}"] img`);
    return { width: img?.naturalWidth ?? 0, height: img?.naturalHeight ?? 0 };
  }, id);
}

/**
 * Keep every asset upload waiting for a while before letting the server answer it.
 *
 * An upload of a six-kilobyte screenshot to a server on the same machine is over in a few milliseconds, and
 * "Uploading…" is a state that exists for that long — which is not a fact about the board but a fact about
 * the network between the test and itself. What a test needs is not a slower board but a longer wait, and
 * the browser can arrange that: hold the response, and every state downstream of it — placeholder, progress
 * bar, the second person's placeholder — lasts exactly as long as the hold and is otherwise entirely real.
 *
 * Nothing about the request is changed, and the server still decides the outcome.
 *
 * What it cannot arrange is *progress*. A request that has been intercepted has not been sent, and a request
 * that has not been sent has no bytes sent to report: `upload.onprogress` is a fact about a transfer under
 * way, and an interception stops the transfer rather than slowing it. That is what {@link slowUploads} is for,
 * and it is why both are here: hold a request to look at a state, slow a network to look at a percentage.
 */
export async function delayUploads(page: Page, ms: number): Promise<void> {
  await page.route('**/api/boards/*/assets', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await route.continue();
  });
}

/** How a page came to be slow, and how to stop it. */
export interface SlowUploads {
  /**
   * Whether this browser was made slow at the layer where bytes are counted, which is the only layer from
   * which `XMLHttpRequest`'s upload progress can be observed: true in Chromium, where the devtools protocol
   * has a bandwidth dial, and false where it does not and the upload is slow because the answer is being held
   * rather than because it is crawling.
   *
   * Reported rather than assumed, because a test that asserted a percentage in a browser that never measured
   * one would be asserting that a number it made up appeared on a screen. Where this is false the test asserts
   * the states a slow upload passes through — most of the story, and the part that belongs to the board — and
   * leaves the percentage to the browser that can be asked for one.
   */
  readonly reportsProgress: boolean;
  /** Put this browser's network back the way it was. */
  restore(): Promise<void>;
}

/**
 * Bytes per second the uploader's own link is limited to. Three screenshots total about thirty kilobytes,
 * which at this rate keeps them on their way for the better part of ten seconds — long enough for a test to
 * read the state of all three, on two screens, without racing a request that finishes in a millisecond.
 */
const UPLOAD_BANDWIDTH = 3_000;

/**
 * Make this page's uploads take measurable time by turning its own bandwidth down.
 *
 * This is a browser pretending to be on a bad connection, which is the only honest way to watch an upload
 * happen: every number the board then shows comes from a real `progress` event on a real request that was
 * really taking that long, and the server still decides how it ends. Nothing is intercepted and no response is
 * written by the test.
 *
 * Only the upload side is squeezed. This page still has to fetch the pictures it uploaded and still has a live
 * update line to keep fed, so the download side is left at about half a megabyte a second — slow enough to be
 * a bad connection, fast enough that a six-kilobyte screenshot is a few frames.
 */
export async function slowUploads(page: Page): Promise<SlowUploads> {
  const session = await page.context().newCDPSession(page).catch(() => null);
  if (session === null) {
    // No devtools protocol — Firefox and WebKit. Those browsers' Playwright drivers have no bandwidth dial,
    // so the request is held instead: the states are still real, the percentage is not observable.
    await delayUploads(page, 4_000);
    return { reportsProgress: false, restore: () => page.unroute('**/api/boards/*/assets') };
  }
  const conditions = (upload: number, download: number): Promise<unknown> =>
    session.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: download,
      uploadThroughput: upload,
    });
  await conditions(UPLOAD_BANDWIDTH, 400_000);
  return {
    reportsProgress: true,
    restore: async () => {
      await conditions(-1, -1);
      await session.detach();
    },
  };
}

/** Make every asset upload fail in the browser, before it reaches the server. */
export async function failUploads(page: Page): Promise<void> {
  await page.route('**/api/boards/*/assets', (route) => route.abort('failed'));
}

/** Take the failure away. Retry after this is a retry against a network that works again. */
export async function letUploadsThrough(page: Page): Promise<void> {
  await page.unroute('**/api/boards/*/assets');
}

/** One response the browser got for a picture, kept for the assertions about its headers. */
export interface PictureResponse {
  url: string;
  status: number;
  cacheControl: string;
  contentType: string;
  etag: string;
  contentTypeOptions: string;
  contentSecurityPolicy: string;
}

/**
 * Watch this page's picture requests from now on. Call it before the pictures are expected — a response that
 * has already happened cannot be listened to afterwards, and a test that missed it would pass on nothing.
 */
export function watchPictureRequests(page: Page): {
  responses: () => PictureResponse[];
  /** The first response for a picture, waiting for one if none has happened yet. */
  first: () => Promise<PictureResponse>;
} {
  const seen: PictureResponse[] = [];
  const waiters: ((response: PictureResponse) => void)[] = [];
  const listener = (response: Response): void => {
    if (!/\/api\/assets\//.test(response.url())) return;
    const headers = response.headers();
    const record: PictureResponse = {
      url: response.url(),
      status: response.status(),
      cacheControl: headers['cache-control'] ?? '',
      contentType: headers['content-type'] ?? '',
      etag: headers['etag'] ?? '',
      contentTypeOptions: headers['x-content-type-options'] ?? '',
      contentSecurityPolicy: headers['content-security-policy'] ?? '',
    };
    seen.push(record);
    waiters.shift()?.(record);
  };
  page.on('response', listener);
  return {
    responses: () => seen,
    first: () =>
      seen[0] === undefined
        ? new Promise<PictureResponse>((resolve) => {
            waiters.push(resolve);
          })
        : Promise.resolve(seen[0]),
  };
}
