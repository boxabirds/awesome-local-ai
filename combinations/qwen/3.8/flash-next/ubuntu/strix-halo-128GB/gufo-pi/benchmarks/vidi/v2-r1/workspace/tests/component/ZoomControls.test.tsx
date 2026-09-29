import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, type Mock } from 'vitest';

import { ZoomControls, type ZoomControlsProps } from '../../src/client/canvas/ZoomControls';
import { zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { PERCENT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';

type Mocks = {
  onZoomIn: Mock<() => void>;
  onZoomOut: Mock<() => void>;
  onReset: Mock<() => void>;
};

function atZoom(zoom: number): Camera {
  return { x: 0, y: 0, zoom };
}

function renderControls(
  overrides: Partial<Omit<ZoomControlsProps, keyof Mocks>> = {},
): ZoomControlsProps & Mocks {
  const mocks: Mocks = {
    onZoomIn: vi.fn<() => void>(),
    onZoomOut: vi.fn<() => void>(),
    onReset: vi.fn<() => void>(),
  };
  const props: ZoomControlsProps & Mocks = {
    zoomPercent: zoomPercent(atZoom(1)),
    canZoomIn: true,
    canZoomOut: true,
    ...mocks,
    ...overrides,
  };
  render(<ZoomControls {...props} />);
  return props;
}

function label(): HTMLElement {
  return screen.getByTestId('zoom-label');
}

describe('ZoomControls (TC-19, TC-20, TC-21, TC-32)', () => {
  it('shows the zoom as a whole-number percentage in a live region', () => {
    renderControls();
    expect(label().textContent).toBe(`${PERCENT}%`);
    expect(label().tagName).toBe('OUTPUT');
    expect(label().getAttribute('aria-live')).toBe('polite');
  });

  it('TC-19 disables zoom out at ZOOM_MIN and labels 10%', () => {
    renderControls({
      zoomPercent: zoomPercent(atZoom(ZOOM_MIN)),
      canZoomOut: false,
      canZoomIn: true,
    });
    expect(label().textContent).toBe('10%');
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('TC-20 disables zoom in at ZOOM_MAX and labels 400%', () => {
    renderControls({
      zoomPercent: zoomPercent(atZoom(ZOOM_MAX)),
      canZoomOut: true,
      canZoomIn: false,
    });
    expect(label().textContent).toBe('400%');
    expect((screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('TC-21 rounds an off-grid zoom of 1.5625 to 156%', () => {
    renderControls({ zoomPercent: zoomPercent(atZoom(ZOOM_STEP_FACTOR * ZOOM_STEP_FACTOR)) });
    expect(label().textContent).toBe('156%');
  });

  it('has accessible names for the zoom buttons and Reset view', () => {
    renderControls();
    expect(screen.getByRole('button', { name: 'Zoom out' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Zoom in' })).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Reset view' })).not.toBeNull();
  });

  it('calls the callbacks when the buttons are enabled', () => {
    const props = renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-32 does nothing when a disabled zoom button is clicked', () => {
    const props = renderControls({ canZoomIn: false, canZoomOut: false });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(props.onZoomIn).not.toHaveBeenCalled();
    expect(props.onZoomOut).not.toHaveBeenCalled();
    // Reset view stays available: it is how the user recovers
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('does not suppress the browser default for a wheel over the panel', () => {
    renderControls();
    const event = fireEvent.wheel(screen.getByTestId('zoom-controls'), {
      deltaY: -100,
      ctrlKey: true,
    });
    // Unlike over the board, the page is allowed to do its normal thing here.
    expect(event).toBe(true);
  });
});
