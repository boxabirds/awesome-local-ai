import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ZoomControls, type ZoomControlsProps } from '../../src/client/canvas/ZoomControls';
import { zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

function renderControls(overrides: Partial<ZoomControlsProps> = {}): ZoomControlsProps {
  const props: ZoomControlsProps = {
    zoomPercent: 100,
    canZoomIn: true,
    canZoomOut: true,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  render(<ZoomControls {...props} />);
  return props;
}

function at(zoom: number): Camera {
  return { x: 0, y: 0, zoom };
}

function zoomOutButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Zoom out' });
}

function zoomInButton(): HTMLButtonElement {
  return screen.getByRole('button', { name: 'Zoom in' });
}

function label(): HTMLElement {
  return screen.getByTestId('zoom-percent');
}

describe('ZoomControls', () => {
  it('TC-19: at ZOOM_MIN the Zoom out button is disabled and the label reads 10%', () => {
    renderControls({
      zoomPercent: zoomPercent(at(ZOOM_MIN)),
      canZoomOut: false,
      canZoomIn: true,
    });
    expect(zoomOutButton()).toBeDisabled();
    expect(zoomInButton()).toBeEnabled();
    expect(label().textContent).toBe(`${Math.round(ZOOM_MIN * 100)}%`);
  });

  it('TC-20: at ZOOM_MAX the Zoom in button is disabled and the label reads 400%', () => {
    renderControls({
      zoomPercent: zoomPercent(at(ZOOM_MAX)),
      canZoomOut: true,
      canZoomIn: false,
    });
    expect(zoomInButton()).toBeDisabled();
    expect(zoomOutButton()).toBeEnabled();
    expect(label().textContent).toBe(`${Math.round(ZOOM_MAX * 100)}%`);
  });

  it('TC-21: shows the zoom rounded to a whole percent', () => {
    renderControls({ zoomPercent: zoomPercent(at(1.5625)) });
    expect(label().textContent).toBe('156%');
  });

  it('TC-32: a disabled button does not call its callback; an enabled one does', () => {
    const props = renderControls({ canZoomIn: false, canZoomOut: false });
    fireEvent.click(zoomInButton());
    fireEvent.click(zoomOutButton());
    expect(props.onZoomIn).not.toHaveBeenCalled();
    expect(props.onZoomOut).not.toHaveBeenCalled();
  });

  it('calls the callbacks when enabled, once per click', async () => {
    const user = userEvent.setup();
    const props = renderControls();
    await user.click(zoomInButton());
    await user.click(zoomOutButton());
    await user.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('renders the label with an accessible live region and keeps buttons focusable', () => {
    renderControls();
    expect(label()).toHaveAttribute('aria-live', 'polite');
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      button.focus();
      expect(document.activeElement).toBe(button);
    }
  });
});
