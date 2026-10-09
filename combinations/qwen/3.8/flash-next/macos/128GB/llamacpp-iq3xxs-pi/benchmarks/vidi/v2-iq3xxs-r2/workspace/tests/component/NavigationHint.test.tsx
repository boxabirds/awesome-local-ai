import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { NavigationHint, NAVIGATION_HINT_TEXT } from '../../src/client/canvas/NavigationHint';
import { ZOOM_MAX_PERCENT } from '../../src/client/canvas/camera';
import { PERCENT_PER_ZOOM, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import {
  buttonByLabel,
  expectCameraCloseTo,
  flushFrames,
  readCamera,
  renderBoard,
  waitForCamera,
  zoomLabel,
} from './fixtures/board';

function hint(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-testid="navigation-hint"]');
}

describe('NavigationHint (presentational)', () => {
  it('renders the exact hint text when visible and nothing when hidden', () => {
    const { unmount } = render(<NavigationHint visible />);
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);
    unmount();
    const { container } = render(<NavigationHint visible={false} />);
    expect(container.textContent).toBe('');
    expect(hint()).toBeNull();
  });
});

describe('first-use navigation hint (TC-22)', () => {
  it('is visible on load, hides on the first camera change and stays hidden after the second', async () => {
    await renderBoard();
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);

    buttonByLabel('Zoom in').click();
    await waitForCamera((cam) => cam.zoom === ZOOM_STEP_FACTOR);
    expect(hint()).toBeNull();

    buttonByLabel('Zoom in').click();
    await waitForCamera((cam) => cam.zoom === ZOOM_STEP_FACTOR ** 2);
    expect(hint()).toBeNull();
    // 1.5625 shows as 156%, matching TC-21 through the real app.
    expect(zoomLabel().textContent).toBe(
      `${Math.round(ZOOM_STEP_FACTOR ** 2 * PERCENT_PER_ZOOM)}%`,
    );
  });

  it('is not dismissed by a camera update that changed nothing (TC-29)', async () => {
    await renderBoard();
    // Jump straight to the maximum zoom: another zoom in returns the same camera object.
    window.__vidi6?.setCamera({ x: -640, y: -400, zoom: ZOOM_MAX });
    const atMax = await waitForCamera((cam) => cam.zoom === ZOOM_MAX);
    expect(zoomLabel().textContent).toBe(`${ZOOM_MAX_PERCENT}%`);
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);

    const zoomOut = buttonByLabel('Zoom out');
    const zoomIn = buttonByLabel('Zoom in');
    expect(zoomIn.disabled).toBe(true);
    zoomIn.click();
    await flushFrames(3);
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);
    expectCameraCloseTo(readCamera(), atMax);

    zoomOut.click();
    await waitForCamera((cam) => cam.zoom !== ZOOM_MAX);
    expect(hint()).toBeNull();
  });
});
