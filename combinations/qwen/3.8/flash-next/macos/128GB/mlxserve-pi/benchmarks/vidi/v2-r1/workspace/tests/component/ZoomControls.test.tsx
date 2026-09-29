import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';
import { zoomPercent } from '../../src/client/canvas/camera';

const noop = (): void => {};

const renderControls = (
  zoom: number,
  handlers: {
    onZoomIn?: () => void;
    onZoomOut?: () => void;
    onReset?: () => void;
  } = {},
) => {
  const onZoomIn = handlers.onZoomIn ?? vi.fn();
  const onZoomOut = handlers.onZoomOut ?? vi.fn();
  const onReset = handlers.onReset ?? vi.fn();
  render(
    <ZoomControls
      zoomPercent={zoomPercent({ x: 0, y: 0, zoom })}
      canZoomIn={zoom < ZOOM_MAX}
      canZoomOut={zoom > ZOOM_MIN}
      onZoomIn={onZoomIn}
      onZoomOut={onZoomOut}
      onReset={onReset}
    />,
  );
  return { onZoomIn, onZoomOut, onReset };
};

const button = (name: string): HTMLButtonElement =>
  screen.getByRole('button', { name }) as HTMLButtonElement;
const label = (): HTMLElement => screen.getByTestId('zoom-level');

describe('zoom limits (zoom.limits)', () => {
  // TC-19: at the minimum zoom, Zoom out is disabled and the label reads 10%.
  it('TC-19 disables Zoom out at the minimum zoom', () => {
    renderControls(ZOOM_MIN);
    expect(button('Zoom out').disabled).toBe(true);
    expect(button('Zoom in').disabled).toBe(false);
    expect(label().textContent).toBe('10%');
    expect(button('Reset view').disabled).toBe(false);
  });

  // TC-20: at the maximum zoom, Zoom in is disabled and the label reads 400%.
  it('TC-20 disables Zoom in at the maximum zoom', () => {
    renderControls(ZOOM_MAX);
    expect(button('Zoom in').disabled).toBe(true);
    expect(button('Zoom out').disabled).toBe(false);
    expect(label().textContent).toBe('400%');
  });

  it('enables both buttons in the middle of the range', () => {
    renderControls(1);
    expect(button('Zoom in').disabled).toBe(false);
    expect(button('Zoom out').disabled).toBe(false);
    expect(label().textContent).toBe('100%');
  });

  // TC-32: a disabled button never calls its callback.
  it('TC-32 does not call the callback of a disabled button', async () => {
    const user = userEvent.setup();
    const { onZoomOut, onZoomIn } = renderControls(ZOOM_MIN, {});
    await user.click(button('Zoom out'));
    expect(onZoomOut).not.toHaveBeenCalled();
    // A synthetic click dispatched straight at the disabled button is ignored
    // too (a real browser does not fire click events from disabled controls).
    fireEvent.click(button('Zoom out'));
    expect(onZoomOut).not.toHaveBeenCalled();
    // The enabled button still works.
    await user.click(button('Zoom in'));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });
});

describe('zoom level shown (zoom.indicator)', () => {
  // TC-21: the label is the zoom rounded to the nearest whole percent.
  it('TC-21 rounds the zoom to a whole percentage', () => {
    renderControls(1.5625);
    expect(label().textContent).toBe('156%');
  });

  it('announces changes politely', () => {
    renderControls(1);
    expect(label().tagName.toLowerCase()).toBe('output');
    expect(label().getAttribute('aria-live')).toBe('polite');
    expect(label().textContent).toBe('100%');
  });
});

describe('zoom buttons (zoom.step)', () => {
  it('calls onZoomIn, onZoomOut and onReset', () => {
    const { onZoomIn, onZoomOut, onReset } = renderControls(1);
    fireEvent.click(button('Zoom in'));
    fireEvent.click(button('Zoom out'));
    fireEvent.click(button('Reset view'));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('keeps the zoom label in sync with the zoom level', () => {
    const { rerender } = render(
      <ZoomControls
        zoomPercent={zoomPercent({ x: 0, y: 0, zoom: 1 })}
        canZoomIn
        canZoomOut
        onZoomIn={noop}
        onZoomOut={noop}
        onReset={noop}
      />,
    );
    expect(label().textContent).toBe('100%');
    rerender(
      <ZoomControls
        zoomPercent={zoomPercent({ x: 0, y: 0, zoom: 1.25 })}
        canZoomIn
        canZoomOut
        onZoomIn={noop}
        onZoomOut={noop}
        onReset={noop}
      />,
    );
    expect(label().textContent).toBe('125%');
  });
});

describe('board ownership', () => {
  it('stops wheel propagation so a pinch over the controls does not zoom the board', () => {
    renderControls(1);
    const container = screen.getByTestId('zoom-controls');
    let reachedAncestor = 0;
    const spy = (): void => {
      reachedAncestor += 1;
    };
    document.body.addEventListener('wheel', spy);
    const event = new WheelEvent('wheel', {
      deltaY: -100,
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    container.dispatchEvent(event);
    document.body.removeEventListener('wheel', spy);
    // The browser default is not suppressed over the controls...
    expect(event.defaultPrevented).toBe(false);
    // ...and the event never reaches an ancestor (which would be the board).
    expect(reachedAncestor).toBe(0);
  });
});
