import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../../src/client/App';
import { NAVIGATION_HINT_TEXT, NavigationHint } from '../../src/client/canvas/NavigationHint';
import {
  byTestId,
  fireKey,
  firePointer,
  flushCameraFrame,
  stubResizeObserver,
  stubViewportGeometry,
  viewportElement
} from './harness';

beforeEach(() => {
  vi.useFakeTimers();
  stubViewportGeometry();
  stubResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('NavigationHint (nav.hint)', () => {
  it('shows the navigation hint text and nothing else', () => {
    const { container } = render(<NavigationHint visible />);
    expect(byTestId(container, 'navigation-hint')?.textContent).toBe(NAVIGATION_HINT_TEXT);
    cleanup();
    const hidden = render(<NavigationHint visible={false} />);
    expect(byTestId(hidden.container, 'navigation-hint')).toBeNull();
  });

  it('TC-22: visible at first, hidden after the first camera change, still hidden after another', async () => {
    const { container } = render(<App />);
    await flushCameraFrame();
    const viewport = viewportElement(container);

    expect(byTestId(container, 'navigation-hint')).not.toBeNull();

    // First navigation: one drag.
    firePointer(viewport, 'pointerdown', 400, 300);
    firePointer(viewport, 'pointermove', 520, 380);
    firePointer(viewport, 'pointerup', 520, 380);
    await flushCameraFrame();

    expect(byTestId(container, 'navigation-hint')).toBeNull();

    // Second navigation of a different kind: it does not come back.
    fireKey('=', { ctrlKey: true });
    await flushCameraFrame();
    expect(byTestId(container, 'navigation-hint')).toBeNull();
  });

  it('stays hidden for the whole visit, whatever the user does next', async () => {
    const { container } = render(<App />);
    await flushCameraFrame();

    fireKey('0', { ctrlKey: true }); // reset counts as navigating
    await flushCameraFrame();
    expect(byTestId(container, 'navigation-hint')).toBeNull();

    fireKey('-', { metaKey: true });
    await flushCameraFrame();
    expect(byTestId(container, 'navigation-hint')).toBeNull();
  });

  it('TC-29: a click without movement does not dismiss the hint', async () => {
    const { container } = render(<App />);
    await flushCameraFrame();
    const viewport = viewportElement(container);

    firePointer(viewport, 'pointerdown', 300, 300);
    firePointer(viewport, 'pointerup', 300, 300);
    await flushCameraFrame();

    expect(byTestId(container, 'navigation-hint')).not.toBeNull();
  });

  it('is shown again on a fresh visit (reload), because it is not persisted', async () => {
    const first = render(<App />);
    await flushCameraFrame();
    fireKey('=', { ctrlKey: true });
    await flushCameraFrame();
    expect(byTestId(first.container, 'navigation-hint')).toBeNull();
    cleanup();

    const second = render(<App />);
    await flushCameraFrame();
    expect(byTestId(second.container, 'navigation-hint')).not.toBeNull();
  });
});
