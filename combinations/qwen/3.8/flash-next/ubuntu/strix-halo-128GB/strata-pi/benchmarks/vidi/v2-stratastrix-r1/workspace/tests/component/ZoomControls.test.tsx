import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';

const percent = (zoom: number) => Math.round(zoom * 100);

function renderControls(overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const props = {
    zoomPercent: percent(ZOOM_STEP_FACTOR),
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

const byLabel = (name: string) =>
  document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);

describe('ZoomControls', () => {
  // TC-19
  it('TC-19: disables Zoom out and shows 10% at ZOOM_MIN', () => {
    renderControls({ zoomPercent: percent(ZOOM_MIN), canZoomOut: false });

    expect(byLabel('Zoom out')?.disabled).toBe(true);
    expect(byLabel('Zoom in')?.disabled).toBe(false);
    expect(document.querySelector('[data-testid="zoom-label"]')?.textContent).toBe(
      `${percent(ZOOM_MIN)}%`,
    );
  });

  // TC-20
  it('TC-20: disables Zoom in and shows 400% at ZOOM_MAX', () => {
    renderControls({ zoomPercent: percent(ZOOM_MAX), canZoomIn: false });

    expect(byLabel('Zoom in')?.disabled).toBe(true);
    expect(byLabel('Zoom out')?.disabled).toBe(false);
    expect(document.querySelector('[data-testid="zoom-label"]')?.textContent).toBe(
      `${percent(ZOOM_MAX)}%`,
    );
  });

  // TC-21
  it('TC-21: shows the zoom rounded to a whole-number percentage', () => {
    renderControls({ zoomPercent: percent(1.5625) });
    expect(document.querySelector('[data-testid="zoom-label"]')?.textContent).toBe('156%');
  });

  it('announces the zoom level politely and names its buttons', () => {
    renderControls();
    const label = document.querySelector('[data-testid="zoom-label"]');
    expect(label?.getAttribute('aria-live')).toBe('polite');
    expect(byLabel('Zoom out')).not.toBeNull();
    expect(byLabel('Zoom in')).not.toBeNull();
    const reset = byLabel('Reset view');
    expect(reset?.textContent).toBe('Reset view');
    // All three are keyboard focusable buttons.
    for (const button of document.querySelectorAll('button')) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
    }
  });

  it('calls the right callback for each control', () => {
    const props = renderControls();

    fireEvent.click(byLabel('Zoom in')!);
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);

    fireEvent.click(byLabel('Zoom out')!);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);

    fireEvent.click(byLabel('Reset view')!);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  // TC-32
  it('TC-32: ignores clicks on a disabled zoom button', () => {
    const props = renderControls({ canZoomIn: false, canZoomOut: false });

    fireEvent.click(byLabel('Zoom in')!);
    fireEvent.click(byLabel('Zoom out')!);

    expect(props.onZoomIn).not.toHaveBeenCalled();
    expect(props.onZoomOut).not.toHaveBeenCalled();
    expect(props.onReset).not.toHaveBeenCalled();
  });

  it('stops wheel events so a wheel over the control is not a board gesture', () => {
    const seenByBoard = vi.fn();
    const noop = () => {};

    function Harness() {
      return (
        <div data-testid="board-surface" onWheel={seenByBoard}>
          <ZoomControls
            zoomPercent={100}
            canZoomIn
            canZoomOut
            onZoomIn={noop}
            onZoomOut={noop}
            onReset={noop}
          />
        </div>
      );
    }

    render(<Harness />);
    const controls = document.querySelector('[data-testid="zoom-controls"]')!;
    // The browser default is left alone: only propagation to the board stops.
    expect(fireEvent.wheel(controls, { deltaY: -100, ctrlKey: true })).toBe(true);
    expect(seenByBoard).not.toHaveBeenCalled();
  });
});
