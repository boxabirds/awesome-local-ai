/**
 * TC-18: paste (ui-component) — Ctrl/Cmd+V image files.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, act } from '@testing-library/react';
import { renderApp, windowPaste, imageFile, imageSlices } from './appHarness';

afterEach(cleanup);

async function settle() {
  await act(async () => {});
}

describe('TC-18: paste (ui-component)', () => {
  it('paste of an image file → placeholder centred in the view', async () => {
    const app = await renderApp();

    windowPaste([imageFile('clip.png', 'image/png', { width: 64, height: 48 })]);
    await settle();

    const imgs = imageSlices(app.doc);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].status).toBe('uploading');
    // Centred on the view (jsdom window is 1024×768 → centre 512,384):
    // the 64×48 image spans 480..544 × 360..408.
    expect(imgs[0].x).toBe(480);
    expect(imgs[0].y).toBe(360);
  });

  it('paste of text (no files) → nothing added', async () => {
    const app = await renderApp();

    windowPaste([]);
    await settle();

    expect(imageSlices(app.doc)).toHaveLength(0);
  });

  it('paste while a text input has focus → nothing added (default behaviour kept)', async () => {
    const app = await renderApp();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    windowPaste([imageFile('clip.png', 'image/png')]);
    await settle();

    expect(imageSlices(app.doc)).toHaveLength(0);
  });
});
