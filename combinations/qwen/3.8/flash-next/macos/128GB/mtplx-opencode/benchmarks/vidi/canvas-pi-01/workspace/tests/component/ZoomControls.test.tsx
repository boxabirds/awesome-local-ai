/**
 * Story 1 · task 6 — component tests for the zoom control
 * (TC-19, TC-20, TC-21, TC-32).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { BoardShell } from '../../src/client/App';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';

beforeEach(() => {
  cleanup();
});

function zoomLabel(): HTMLElement {
  return screen.getByTestId('zoom-label');
}

describe('rendered states (TC-19, TC-20, TC-21)', () => {
  it('TC-19: at ZOOM_MIN the zoom-out button is disabled and the label reads 10%', () => {
    render(
      <ZoomControls
        zoomPercent={Math.round(ZOOM_MIN * 100)}
        canZoomIn
        canZoomOut={false}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
      />,
    );

    const zoomOut = screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
    expect(zoomOut.disabled).toBe(true);
    expect(zoomOut.hasAttribute('disabled')).toBe(true);
    expect(zoomIn.disabled).toBe(false);
    expect(zoomLabel().textContent).toBe('10%');
  });

  it('TC-20: at ZOOM_MAX the zoom-in button is disabled and the label reads 400%', () => {
    render(
      <ZoomControls
        zoomPercent={Math.round(ZOOM_MAX * 100)}
        canZoomIn={false}
        canZoomOut
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
      />,
    );

    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
    expect(zoomIn.disabled).toBe(true);
    expect(zoomOut.disabled).toBe(false);
    expect(zoomLabel().textContent).toBe('400%');
  });

  it('TC-21: a zoom of 1.5625 is shown rounded, as 156%', () => {
    const zoom = ZOOM_STEP_FACTOR * ZOOM_STEP_FACTOR; // 1.5625
    render(
      <ZoomControls
        zoomPercent={Math.round(zoom * 100)}
        canZoomIn
        canZoomOut
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
      />,
    );
    expect(zoom).toBeCloseTo(1.5625, 10);
    expect(zoomLabel().textContent).toBe('156%');
  });

  it('announces the zoom level', () => {
    render(
      <ZoomControls
        zoomPercent={100}
        canZoomIn
        canZoomOut
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
      />,
    );
    const label = zoomLabel();
    expect(label.tagName).toBe('OUTPUT');
    expect(label.getAttribute('aria-live')).toBe('polite');
  });
});

describe('interaction (TC-32)', () => {
  it('clicking an enabled button calls its callback', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();
    render(
      <ZoomControls
        zoomPercent={100}
        canZoomIn
        canZoomOut
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={onReset}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));

    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-32: a click on a disabled button does not call its callback', () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    render(
      <ZoomControls
        zoomPercent={Math.round(ZOOM_MAX * 100)}
        canZoomIn={false}
        canZoomOut
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));

    expect(onZoomIn).not.toHaveBeenCalled(); // disabled: no zoom past 400%
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('TC-32 (whole board): at ZOOM_MAX the zoom-in button is disabled and the camera cannot move', async () => {
    render(<BoardShell viewport={{ width: 800, height: 600 }} />);

    // The test-only hook jumps straight to the maximum zoom.
    window.__vidi6?.setCamera({ x: 0, y: 0, zoom: ZOOM_MAX });
    await waitFor(() => {
      expect(zoomLabel().textContent).toBe('400%');
    });

    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
    expect(zoomIn.disabled).toBe(true);
    fireEvent.click(zoomIn);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const camera = (screen.getByTestId('world-layer') as HTMLElement).dataset.camera;
    expect(camera).toBe(`0,0,${ZOOM_MAX}`);
  });
});
