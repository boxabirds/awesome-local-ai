/**
 * One mouse at a time, while every session stays live.
 *
 * Playwright's `page.mouse` is per page, but when one worker points at several
 * pages of the same browser *at the same time*, the pointer streams do not all
 * arrive where they were sent. Measured on Firefox with five editors each dragging
 * a note of their own: awaited one page after another, every note ended exactly
 * where its editor pointed it; run in `Promise.all`, three of the five drags landed
 * somewhere else (a ten-step move arrived as two steps at the wrong distance, or
 * never began at all). Chromium delivers them correctly, but a test that only
 * passes in one browser is not a test.
 *
 * `withInputLock` therefore serialises *pointing*, not the work: the sessions stay
 * connected and keep changing while another page is being dragged, so a gesture
 * still has to survive its colleagues' updates arriving underneath it - which is
 * the part of the product these tests are about.
 */
let tail: Promise<unknown> = Promise.resolve();

export async function withInputLock<T>(run: () => Promise<T>): Promise<T> {
  const result = tail.then(run, run);
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
