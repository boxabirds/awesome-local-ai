import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

afterEach(cleanup);

const percentOf = (zoom: number) => Math.round(zoom * 100);

function setup(options: { zoom?: number } = {}) {
  const zoom = options.zoom ?? 1;
  const props = {
    zoomPercent: percentOf(zoom),
    canZoomIn: zoom < ZOOM_MAX,
    canZoomOut: zoom > ZOOM_MIN,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
  };
  render(<ZoomControls {...props} />);
  return props;
}

const zoomIn = () => screen.getByRole('button', { name: 'Zoom in' });
const zoomOut = () => screen.getByRole('button', { name: 'Zoom out' });
const reset = () => screen.getByRole('button', { name: 'Reset view' });
const label = () => screen.getByTestId('zoom-percent');

const expectDisabled = (element: HTMLElement) => expect(element.hasAttribute('disabled')).toBe(true);
const expectEnabled = (element: HTMLElement) => expect(element.hasAttribute('disabled')).toBe(false);

describe('ZoomControls rendering', () => {
  // TC-19
  it('TC-19 disables Zoom out and shows 10% at ZOOM_MIN', () => {
    setup({ zoom: ZOOM_MIN });

    expectDisabled(zoomOut());
    expectEnabled(zoomIn());
    expect(label().textContent).toBe('10%');
  });

  // TC-20
  it('TC-20 disables Zoom in and shows 400% at ZOOM_MAX', () => {
    setup({ zoom: ZOOM_MAX });

    expectDisabled(zoomIn());
    expectEnabled(zoomOut());
    expect(label().textContent).toBe('400%');
  });

  // TC-21
  it('TC-21 shows the zoom rounded to a whole percent (1.5625 -> 156%)', () => {
    setup({ zoom: 1.5625 });
    expect(label().textContent).toBe('156%');
  });

  it('announces the zoom level through a live region', () => {
    setup({ zoom: 1 });
    expect(label().tagName.toLowerCase()).toBe('output');
    expect(label().getAttribute('aria-live')).toBe('polite');
    expect(label().textContent).toBe('100%');
  });

  it('is keyboard focusable and labelled', () => {
    setup();
    expect(zoomOut().getAttribute('aria-label')).toBe('Zoom out');
    expect(zoomIn().getAttribute('aria-label')).toBe('Zoom in');
    expect(reset().textContent).toBe('Reset view');
    zoomOut().focus();
    expect(document.activeElement).toBe(zoomOut());
  });
});

describe('ZoomControls actions', () => {
  it('calls onZoomOut, onZoomIn and onReset', async () => {
    const props = setup();
    const user = userEvent.setup();

    await user.click(zoomOut());
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);

    await user.click(zoomIn());
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);

    await user.click(reset());
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  // TC-32
  it('TC-32 does nothing when a disabled zoom button is clicked', async () => {
    const props = setup({ zoom: ZOOM_MIN });

    await userEvent.setup().click(zoomOut());
    expect(props.onZoomOut).not.toHaveBeenCalled();
    expect(props.onZoomIn).not.toHaveBeenCalled();

    // Even a forced (non-user) click on a disabled button does not fire onClick.
    fireEvent.click(zoomOut());
    expect(props.onZoomOut).not.toHaveBeenCalled();
  });

  it('TC-32 at ZOOM_MAX the zoom-in button stays inert', async () => {
    const props = setup({ zoom: ZOOM_MAX });

    await userEvent.setup().click(zoomIn());
    expect(props.onZoomIn).not.toHaveBeenCalled();
    expect(props.onZoomOut).not.toHaveBeenCalled();
  });

  it('stops wheel events from reaching the board', () => {
    setup();
    const container = screen.getByTestId('zoom-controls');
    const seenByBoard = vi.fn();
    document.addEventListener('wheel', seenByBoard, { once: true });

    fireEvent.wheel(container, { deltaY: -100, ctrlKey: true });

    expect(seenByBoard).not.toHaveBeenCalled();
  });
});
