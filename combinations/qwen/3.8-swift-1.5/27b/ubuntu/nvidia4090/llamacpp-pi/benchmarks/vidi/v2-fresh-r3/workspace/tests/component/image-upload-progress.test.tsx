/**
 * TC-20: XHR upload progress (ui-component).
 *
 * The XMLHttpRequest is replaced with a controllable fake so the test can
 * drive `upload.onprogress` and `onload`/`onerror` explicitly.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { screen, cleanup, act } from '@testing-library/react';
import { renderApp, windowPaste, imageFile, imageSlices, MockXHR } from './appHarness';

// This beforeEach is registered after the harness' (which installs a pending
// no-op XHR), so the controllable fake wins for this file.
beforeEach(() => {
  MockXHR.last = null;
  vi.stubGlobal('XMLHttpRequest', MockXHR);
});

afterEach(() => {
  cleanup();
  MockXHR.last = null;
});

function lastXhr(): MockXHR {
  if (!MockXHR.last) throw new Error('no XHR was sent');
  return MockXHR.last;
}

async function settle() {
  await act(async () => {});
}

const KEY = 'a'.repeat(22) + '/' + 'b'.repeat(22);

describe('TC-20: XHR upload progress (ui-component)', () => {
  it('progress events update the progress bar; 201 → ready with the assetKey', async () => {
    const app = await renderApp();

    windowPaste([imageFile('a.png', 'image/png', { width: 40, height: 30 })]);
    await settle();

    const imgs = imageSlices(app.doc);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].status).toBe('uploading');

    act(() => lastXhr().progress(30, 100));
    expect(screen.getByTestId('image-progress').textContent).toBe('30%');
    expect(screen.getByTestId('image-progress-bar').getAttribute('aria-valuenow')).toBe('30');

    act(() => lastXhr().progress(100, 100));
    expect(screen.getByTestId('image-progress').textContent).toBe('100%');

    act(() => lastXhr().load(201, JSON.stringify({ assetKey: KEY })));
    await settle();

    expect(screen.getByTestId('image-ready').getAttribute('src')).toBe(`/api/assets/${KEY}`);
    const ready = imageSlices(app.doc)[0];
    expect(ready.status).toBe('ready');
    expect(ready.assetKey).toBe(KEY);
  });

  it('network error → failed state for the uploader', async () => {
    const app = await renderApp();

    windowPaste([imageFile('a.png', 'image/png')]);
    await settle();
    expect(imageSlices(app.doc)[0].status).toBe('uploading');

    act(() => lastXhr().fail());
    await settle();

    expect(screen.getByTestId('image-failed')).toBeTruthy();
    expect(imageSlices(app.doc)[0].status).toBe('failed');
  });

  it('HTTP 500 → failed state', async () => {
    const app = await renderApp();

    windowPaste([imageFile('a.png', 'image/png')]);
    await settle();

    act(() => lastXhr().load(500, 'oops'));
    await settle();

    expect(screen.getByTestId('image-failed')).toBeTruthy();
    expect(imageSlices(app.doc)[0].status).toBe('failed');
  });
});
