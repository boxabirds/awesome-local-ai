/**
 * Story 1 · task 6 — component tests for the first-use navigation hint
 * (TC-22, TC-29).
 *
 * The hint is driven by `hasNavigated`, a ref-backed latch that flips only on
 * a camera change producing a *new* camera object: a click without movement,
 * or a zoom already at a limit, must not dismiss it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { BoardShell } from '../../src/client/App';
import {
  NAVIGATION_HINT_TEXT,
  NavigationHint,
} from '../../src/client/canvas/NavigationHint';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import { CameraApiContext, useCamera, type CameraApi } from '../../src/client/canvas/useCamera';
import { ZOOM_MAX } from '../../src/shared/config';

beforeEach(() => {
  cleanup();
  testApi = null;
});

function hint(): HTMLElement | null {
  return screen.queryByTestId('navigation-hint');
}

/** Hook handle for the harness below (component tests drive the hook directly). */
let testApi: CameraApi | null = null;

function Harness({ children }: { children?: ReactNode }) {
  const api = useCamera({ width: 800, height: 600 });
  testApi = api;
  return (
    <CameraApiContext.Provider value={api}>
      <BoardViewport />
      <NavigationHint visible={!api.hasNavigated} />
      {children}
    </CameraApiContext.Provider>
  );
}

describe('NavigationHint', () => {
  it('renders the exact PRD copy when visible, and nothing when not', () => {
    const { unmount } = render(<NavigationHint visible />);
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);
    unmount();

    render(<NavigationHint visible={false} />);
    expect(hint()).toBeNull();
  });

  it('TC-22: visible on first render, hidden after the first camera change, still hidden after the second', async () => {
    render(<BoardShell viewport={{ width: 800, height: 600 }} />);
    const surface = screen.getByTestId('board-viewport');
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);

    // First camera change: a plain scroll.
    fireEvent(
      surface,
      new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, deltaMode: 0 }),
    );
    await waitFor(() => {
      expect(hint()).toBeNull();
    });

    // A second change does not bring it back during the visit.
    fireEvent(
      surface,
      new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, deltaMode: 0 }),
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(hint()).toBeNull();
  });

  it('TC-29 (hint): a drag with no movement leaves the hint up', async () => {
    render(<BoardShell viewport={{ width: 800, height: 600 }} />);
    const surface = screen.getByTestId('board-viewport');

    const down = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 200,
      button: 0,
    });
    const up = new MouseEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 200,
      button: 0,
    });
    fireEvent(surface, down);
    fireEvent(surface, up);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);
  });

  it('a zero-delta wheel is a no-op and does not dismiss the hint', async () => {
    render(<Harness />);
    const api = testApi;
    expect(api).not.toBeNull();
    if (!api) return;

    api.wheel({ deltaX: 0, deltaY: 0, ctrlOrMeta: false, point: { x: 0, y: 0 } });
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);
  });

  it('a zoom already at the maximum is a no-op: the hint does not come back', async () => {
    render(<Harness />);
    const api = testApi;
    if (!api) throw new Error('harness did not expose the camera api');

    // Jump to the maximum zoom: a real change, so the hint goes away.
    api.setCamera({ x: 0, y: 0, zoom: ZOOM_MAX });
    await waitFor(() => {
      expect(hint()).toBeNull();
    });

    // Zooming further past the limit changes nothing at all, and the hint
    // stays hidden for the rest of the visit.
    api.zoomStep('in');
    api.wheel({ deltaX: 0, deltaY: -240, ctrlOrMeta: true, point: { x: 400, y: 300 } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(hint()).toBeNull();
  });

  it('is shown again on a fresh mount: the dismissal is not persisted', async () => {
    const first = render(<Harness />);
    const api = testApi;
    expect(hint()).not.toBeNull();
    api?.wheel({ deltaX: 0, deltaY: 120, ctrlOrMeta: false, point: { x: 0, y: 0 } });
    await waitFor(() => {
      expect(hint()).toBeNull();
    });
    first.unmount();

    // "Reload": a new mount starts with the hint again (PRD: not persisted).
    render(<Harness />);
    expect(hint()?.textContent).toBe(NAVIGATION_HINT_TEXT);
  });
});
