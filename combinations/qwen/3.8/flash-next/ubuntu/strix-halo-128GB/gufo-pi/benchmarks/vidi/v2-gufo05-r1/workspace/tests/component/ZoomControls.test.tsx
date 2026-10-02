import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

function renderControls(overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const props = {
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

describe('zoom level shown (zoom.indicator)', () => {
  // TC-21
  it('TC-21 shows the zoom rounded to a whole percent', () => {
    renderControls({ zoomPercent: Math.round(1.5625 * 100) });
    expect(screen.getByTestId('zoom-level')).toHaveTextContent('156%');
  });

  it('shows 100% at the standard view', () => {
    renderControls({ zoomPercent: 100 });
    expect(screen.getByTestId('zoom-level')).toHaveTextContent('100%');
  });

  it('is announced politely to screen readers', () => {
    renderControls();
    expect(screen.getByTestId('zoom-level')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('zoom limits (zoom.limits)', () => {
  // TC-19
  it('TC-19 disables Zoom out at ZOOM_MIN and shows 10%', () => {
    renderControls({ zoomPercent: Math.round(ZOOM_MIN * 100), canZoomOut: false, canZoomIn: true });
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    expect(screen.getByTestId('zoom-level')).toHaveTextContent('10%');
  });

  // TC-20
  it('TC-20 disables Zoom in at ZOOM_MAX and shows 400%', () => {
    renderControls({ zoomPercent: Math.round(ZOOM_MAX * 100), canZoomIn: false, canZoomOut: true });
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByTestId('zoom-level')).toHaveTextContent('400%');
  });

  it('enables both buttons between the limits', () => {
    renderControls();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
  });
});

describe('buttons (zoom.step, view.reset)', () => {
  it('calls the callbacks when clicked', () => {
    const props = renderControls();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('has accessible names and is keyboard focusable', () => {
    renderControls();
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    zoomIn.focus();
    expect(zoomIn).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(screen.getByRole('group', { name: 'Zoom controls' })).toBeInTheDocument();
  });

  // TC-32
  it('TC-32 does not call the callback of a disabled button', () => {
    const props = renderControls({ canZoomIn: false, canZoomOut: false });
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(props.onZoomIn).not.toHaveBeenCalled();
    expect(props.onZoomOut).not.toHaveBeenCalled();
    expect(props.onReset).not.toHaveBeenCalled();
  });
});

describe('the controls are not the board', () => {
  it('stops wheel propagation so the board never sees it', () => {
    renderControls();
    const controls = screen.getByTestId('zoom-controls');
    let seenByWindow = false;
    const listener = () => {
      seenByWindow = true;
    };
    window.addEventListener('wheel', listener);
    const event = new WheelEvent('wheel', {
      deltaY: -120,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    controls.dispatchEvent(event);
    window.removeEventListener('wheel', listener);
    // The browser keeps its own behaviour over the controls...
    expect(event.defaultPrevented).toBe(false);
    // ...and the event does not bubble out to the page.
    expect(seenByWindow).toBe(false);
  });
});
