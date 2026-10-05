/**
 * TC-17: drop (ui-component) — drag files onto the board.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, act } from '@testing-library/react';
import {
  renderApp,
  viewportDrag,
  imageFile,
  imageSlices,
  setMockConnection,
} from './appHarness';
import { REJECTION_MESSAGES } from '../../src/client/images/validateFiles';

afterEach(cleanup);

/** Flushes the async createImageBitmap → placeholder pipeline. */
async function settle() {
  await act(async () => {});
}

describe('TC-17: drop (ui-component)', () => {
  it('dragover with files → highlight; drop → placeholder at the drop point (final size, uploading)', async () => {
    const app = await renderApp();

    viewportDrag('dragenter', [imageFile('a.png', 'image/png', { width: 120, height: 90 })]);
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();
    viewportDrag('dragover', [imageFile('a.png', 'image/png', { width: 120, height: 90 })]);
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();

    viewportDrag('drop', [imageFile('a.png', 'image/png', { width: 120, height: 90 })], {
      x: 300,
      y: 200,
    });
    await settle();

    // The highlight is gone after the drop.
    expect(screen.queryByTestId('drop-highlight')).toBeNull();

    const imgs = imageSlices(app.doc);
    expect(imgs).toHaveLength(1);
    expect(imgs[0].status).toBe('uploading');
    // Top-left at the drop point (identity camera: screen == world).
    expect(imgs[0].x).toBe(300);
    expect(imgs[0].y).toBe(200);
    // Final size: the natural size (120×90 < the 1000 cap → not enlarged).
    expect(imgs[0].width).toBe(120);
    expect(imgs[0].height).toBe(90);
    expect(imgs[0].contentType).toBe('image/png');
    // The placeholder renders in the DOM.
    expect(screen.getByTestId('image-uploading')).toBeTruthy();
  });

  it('drop while offline → offline message, nothing added; after reconnect → works', async () => {
    const app = await renderApp();

    setMockConnection('connecting');
    viewportDrag('drop', [imageFile('a.png', 'image/png')]);
    await settle();

    expect(imageSlices(app.doc)).toHaveLength(0);
    expect(screen.getByText(REJECTION_MESSAGES.offline)).toBeTruthy();

    setMockConnection('connected');
    viewportDrag('drop', [imageFile('a.png', 'image/png')]);
    await settle();

    expect(imageSlices(app.doc)).toHaveLength(1);
  });

  it('dragover with no files → no highlight, no drop', async () => {
    const app = await renderApp();

    viewportDrag('dragenter', []);
    viewportDrag('dragover', []);
    expect(screen.queryByTestId('drop-highlight')).toBeNull();

    viewportDrag('drop', []);
    await settle();
    expect(imageSlices(app.doc)).toHaveLength(0);
  });

  it('dragleave after dragenter → highlight cleared', async () => {
    await renderApp();

    viewportDrag('dragenter', [imageFile('a.png', 'image/png')]);
    expect(screen.getByTestId('drop-highlight')).toBeTruthy();
    viewportDrag('dragleave', [imageFile('a.png', 'image/png')]);
    expect(screen.queryByTestId('drop-highlight')).toBeNull();
  });
});
