/**
 * TC-23: image unavailable (ui-component) — a ready image that fails to load.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, act } from '@testing-library/react';
import { renderApp, windowPaste, imageFile, imageSlices } from './appHarness';
import { markImageReady } from '../../src/shared/objects/image';

afterEach(cleanup);

async function settle() {
  await act(async () => {});
}

const KEY = 'a'.repeat(22) + '/' + 'b'.repeat(22);

describe('TC-23: image unavailable (ui-component)', () => {
  it('a ready image that fires an error → "Image unavailable" box at the same size', async () => {
    const app = await renderApp();

    windowPaste([imageFile('a.png', 'image/png', { width: 120, height: 60 })]);
    await settle();
    const id = imageSlices(app.doc)[0].id;

    act(() => {
      markImageReady(app.doc, id, KEY);
    });
    const ready = screen.getByTestId('image-ready');
    expect(ready.getAttribute('src')).toBe(`/api/assets/${KEY}`);

    act(() => {
      ready.dispatchEvent(new Event('error'));
    });

    const box = screen.getByTestId('image-unavailable');
    expect(box).toBeTruthy();
    // The unavailable box is the same size as the image object.
    expect(box.style.width).toBe('120px');
    expect(box.style.height).toBe('60px');
    // The broken image is no longer in the DOM.
    expect(screen.queryByTestId('image-ready')).toBeNull();
  });
});
