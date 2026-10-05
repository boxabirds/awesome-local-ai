import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

type Props = Parameters<typeof ZoomControls>[0];

/** Render the controls with the props App derives from a camera at `zoom`. */
function renderAtZoom(zoom: number, overrides: Partial<Props> = {}) {
  const camera: Camera = { x: 0, y: 0, zoom };
  const props: Props = {
    zoomPercent: zoomPercent(camera),
    canZoomIn: canZoomIn(camera),
    canZoomOut: canZoomOut(camera),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...overrides
  };
  render(<ZoomControls {...props} />);
  return props;
}

function zoomOutButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
}

function zoomInButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
}

function resetButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Reset view' }) as HTMLButtonElement;
}

function label(): HTMLElement {
  return screen.getByTestId('zoom-percent');
}

afterEach(() => {
  cleanup();
});

describe('zoom limits (zoom.limits)', () => {
  it('TC-19: at ZOOM_MIN zoom out is disabled, zoom in is enabled and the label reads 10%', () => {
    renderAtZoom(ZOOM_MIN);
    expect(zoomOutButton().disabled).toBe(true);
    expect(zoomInButton().disabled).toBe(false);
    expect(label().textContent).toBe('10%');
  });

  it('TC-20: at ZOOM_MAX zoom in is disabled and the label reads 400%', () => {
    renderAtZoom(ZOOM_MAX);
    expect(zoomInButton().disabled).toBe(true);
    expect(zoomOutButton().disabled).toBe(false);
    expect(label().textContent).toBe('400%');
  });

  it('TC-32: clicking a disabled button does nothing', async () => {
    const props = renderAtZoom(ZOOM_MIN);
    await userEvent.click(zoomOutButton());
    expect(props.onZoomOut).not.toHaveBeenCalled();
    expect(props.onZoomIn).not.toHaveBeenCalled();
    expect(props.onReset).not.toHaveBeenCalled();

    cleanup();
    const atMax = renderAtZoom(ZOOM_MAX);
    await userEvent.click(zoomInButton());
    expect(atMax.onZoomIn).not.toHaveBeenCalled();
  });

  it('calls back when the buttons are enabled', async () => {
    const props = renderAtZoom(1);
    await userEvent.click(zoomInButton());
    await userEvent.click(zoomOutButton());
    await userEvent.click(resetButton());
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('re-enables the other button when zooming back from a limit', async () => {
    renderAtZoom(ZOOM_MAX);
    expect(zoomInButton().disabled).toBe(true);
    cleanup();
    renderAtZoom(ZOOM_MAX / 1.25);
    expect(zoomInButton().disabled).toBe(false);
  });
});

describe('zoom level shown (zoom.indicator)', () => {
  it('TC-21: shows the zoom rounded to a whole percentage', () => {
    renderAtZoom(1.5625);
    expect(label().textContent).toBe('156%');
  });

  it('is announced politely and updates when the zoom changes', () => {
    const props: Props = {
      zoomPercent: 100,
      canZoomIn: true,
      canZoomOut: true,
      onZoomIn: () => {},
      onZoomOut: () => {},
      onReset: () => {}
    };
    const { rerender } = render(<ZoomControls {...props} />);
    expect(label().getAttribute('aria-live')).toBe('polite');
    expect(label().textContent).toBe('100%');

    rerender(<ZoomControls {...props} zoomPercent={125} />);
    expect(label().textContent).toBe('125%');
  });
});

describe('control chrome', () => {
  it('every control is a keyboard-focusable button with an accessible name', () => {
    renderAtZoom(1);
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      (button as HTMLButtonElement).focus();
      expect(document.activeElement).toBe(button);
    }
  });
});
