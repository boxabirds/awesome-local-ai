/**
 * TC-22: aspect-locked image resize (ui-component).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { cleanup, act } from '@testing-library/react';
import {
  renderApp,
  windowPaste,
  imageFile,
  imageSlices,
  imageEl,
  pointerEvent,
  dragHandle,
} from './appHarness';
import { IMAGE_MIN_SIZE_WORLD } from '../../src/shared/config';

afterEach(cleanup);

async function settle() {
  await act(async () => {});
}

function pressImage(id: string) {
  act(() => {
    pointerEvent(imageEl(id), 'pointerdown', 512, 384);
  });
}

describe('TC-22: aspect-locked image resize (ui-component)', () => {
  it('dragging the SE handle scales the height proportionally', async () => {
    const app = await renderApp();

    windowPaste([imageFile('a.png', 'image/png', { width: 200, height: 100 })]);
    await settle();
    const id = imageSlices(app.doc)[0].id;

    pressImage(id);
    dragHandle('se', 100, 50);

    const s = imageSlices(app.doc)[0];
    // 200×100 → 300×150 (aspect locked at 2:1).
    expect(s.width).toBeCloseTo(300, 3);
    expect(s.height).toBeCloseTo(150, 3);
  });

  it('resizing is clamped at the minimum size (proportions kept)', async () => {
    const app = await renderApp();

    // 400×200: the clamp kicks in at 200×100 (height = IMAGE_MIN_SIZE_WORLD).
    windowPaste([imageFile('a.png', 'image/png', { width: 400, height: 200 })]);
    await settle();
    const id = imageSlices(app.doc)[0].id;

    pressImage(id);
    // Drag far past the minimum (a 1000×1000 drag to the top-left).
    dragHandle('se', -1000, -1000);

    const s = imageSlices(app.doc)[0];
    expect(s.height).toBeCloseTo(IMAGE_MIN_SIZE_WORLD, 3);
    expect(s.width).toBeCloseTo(IMAGE_MIN_SIZE_WORLD * 2, 3); // 2:1 kept
  });
});
