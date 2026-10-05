/**
 * TC-24: unfinished upload (ui-component) — the uploader left before the
 * upload completed; the placeholder shows "Image upload didn't finish" with a
 * working Remove.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, act } from '@testing-library/react';
import { renderApp, windowPaste, imageFile, imageSlices } from './appHarness';

afterEach(cleanup);

async function settle() {
  await act(async () => {});
}

describe('TC-24: unfinished upload (ui-component)', () => {
  it('an upload older than the stale window → unfinished message + Remove', async () => {
    const app = await renderApp();

    windowPaste([imageFile('a.png', 'image/png')]);
    await settle();
    const id = imageSlices(app.doc)[0].id;
    expect(imageSlices(app.doc)[0].status).toBe('uploading');

    // Simulate the uploader having reloaded: the upload started just past
    // the 5-minute stale window (IMAGE_UPLOAD_STALE_MS).
    act(() => {
      const obj = app.doc.getMap('objects').get(id) as import('yjs').Map<unknown>;
      obj.set('uploadStartedAt', Date.now() - 301_000);
    });

    expect(screen.getByTestId('image-unfinished')).toBeTruthy();
    expect(screen.getByText("Image upload didn't finish")).toBeTruthy();

    // Remove works and deletes the placeholder.
    act(() => {
      screen.getByLabelText('Remove').click();
    });
    expect(imageSlices(app.doc)).toHaveLength(0);
    expect(screen.queryByTestId('image-unfinished')).toBeNull();
  });

  it('a fresh upload (within the stale window) stays "uploading"', async () => {
    const app = await renderApp();

    windowPaste([imageFile('a.png', 'image/png')]);
    await settle();

    // 10 s ago — still fresh.
    const id = imageSlices(app.doc)[0].id;
    act(() => {
      const obj = app.doc.getMap('objects').get(id) as import('yjs').Map<unknown>;
      obj.set('uploadStartedAt', Date.now() - 10_000);
    });

    expect(screen.queryByTestId('image-unfinished')).toBeNull();
    expect(screen.getByTestId('image-uploading')).toBeTruthy();
  });
});
