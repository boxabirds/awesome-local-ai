import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';

const noop = () => {};

const controlsAt = (zoom: number) => {
  const camera: Camera = { x: -100, y: -50, zoom };
  const props = {
    zoomPercent: zoomPercent(camera),
    canZoomIn: canZoomIn(camera),
    canZoomOut: canZoomOut(camera),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
  };
  render(<ZoomControls {...props} />);
  return props;
};

const zoomOutButton = () => screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
const zoomInButton = () => screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
const resetButton = () => screen.getByRole('button', { name: 'Reset view' });
const label = () => screen.getByTestId('zoom-percent');

describe('zoom.controls — limits and indicator', () => {
  it('TC-19 disables Zoom out at ZOOM_MIN and shows 10%', () => {
    controlsAt(ZOOM_MIN);

    expect(zoomOutButton().disabled).toBe(true);
    expect(zoomInButton().disabled).toBe(false);
    expect(label().textContent).toBe('10%');
  });

  it('TC-20 disables Zoom in at ZOOM_MAX and shows 400%', () => {
    controlsAt(ZOOM_MAX);

    expect(zoomInButton().disabled).toBe(true);
    expect(zoomOutButton().disabled).toBe(false);
    expect(label().textContent).toBe('400%');
  });

  it('TC-21 rounds the percentage to a whole number (1.5625 → 156%)', () => {
    controlsAt(ZOOM_STEP_FACTOR * ZOOM_STEP_FACTOR);

    expect(label().textContent).toBe('156%');
    expect(zoomInButton().disabled).toBe(false);
    expect(zoomOutButton().disabled).toBe(false);
  });

  it('shows 100% at the standard view with both buttons enabled', () => {
    controlsAt(1);

    expect(label().textContent).toBe('100%');
    expect(zoomInButton().disabled).toBe(false);
    expect(zoomOutButton().disabled).toBe(false);
  });

  it('TC-32 does not call a callback for a disabled button', () => {
    const props = controlsAt(ZOOM_MIN);

    fireEvent.click(zoomOutButton());

    expect(props.onZoomOut).not.toHaveBeenCalled();
    expect(props.onZoomIn).not.toHaveBeenCalled();
    expect(props.onReset).not.toHaveBeenCalled();
  });

  it('TC-32b does not call Zoom in at the maximum', () => {
    const props = controlsAt(ZOOM_MAX);

    fireEvent.click(zoomInButton());

    expect(props.onZoomIn).not.toHaveBeenCalled();
  });
});

describe('zoom.controls — actions and accessibility', () => {
  it('calls the zoom and reset callbacks when enabled', () => {
    const props = controlsAt(1);

    fireEvent.click(zoomInButton());
    fireEvent.click(zoomOutButton());
    fireEvent.click(resetButton());

    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('is keyboard focusable, in board order, and announces the zoom', () => {
    controlsAt(1);

    const buttons = [zoomOutButton(), zoomInButton(), resetButton()];
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.hasAttribute('disabled')).toBe(false);
      button.focus();
      expect(document.activeElement).toBe(button);
    }
    expect(label().tagName).toBe('OUTPUT');
    expect(label().getAttribute('aria-live')).toBe('polite');
  });

  it('renders the percentage with a percent sign for every zoom level', () => {
    const { rerender } = render(<div />);
    for (const [zoom, text] of [
      [ZOOM_MIN, '10%'],
      [1, '100%'],
      [ZOOM_STEP_FACTOR, '125%'],
      [ZOOM_MAX, '400%'],
    ] as const) {
      rerender(
        <ZoomControls
          zoomPercent={zoomPercent({ x: 0, y: 0, zoom })}
          canZoomIn={zoom < ZOOM_MAX}
          canZoomOut={zoom > ZOOM_MIN}
          onZoomIn={noop}
          onZoomOut={noop}
          onReset={noop}
        />,
      );
      expect(screen.getByTestId('zoom-percent').textContent).toBe(text);
    }
  });
});
