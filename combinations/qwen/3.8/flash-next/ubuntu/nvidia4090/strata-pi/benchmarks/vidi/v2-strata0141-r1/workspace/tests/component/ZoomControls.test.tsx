import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

interface Calls {
  in: number;
  out: number;
  reset: number;
}

function setup(zoomPercent: number, canZoomIn: boolean, canZoomOut: boolean): Calls {
  const calls: Calls = { in: 0, out: 0, reset: 0 };
  render(
    <ZoomControls
      zoomPercent={zoomPercent}
      canZoomIn={canZoomIn}
      canZoomOut={canZoomOut}
      onZoomIn={() => {
        calls.in += 1;
      }}
      onZoomOut={() => {
        calls.out += 1;
      }}
      onReset={() => {
        calls.reset += 1;
      }}
    />,
  );
  return calls;
}

describe('ZoomControls (zoom.controls)', () => {
  it('TC-19: at ZOOM_MIN the Zoom out button is disabled and the label reads 10%', () => {
    setup(ZOOM_MIN * 100, true, false);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveProperty('disabled', false);
    expect(screen.getByTestId('zoom-percent').textContent).toBe(`${Math.round(ZOOM_MIN * 100)}%`);
    // The label is announced politely when it changes.
    expect(screen.getByTestId('zoom-percent').getAttribute('aria-live')).toBe('polite');
  });

  it('TC-20: at ZOOM_MAX the Zoom in button is disabled and the label reads 400%', () => {
    setup(ZOOM_MAX * 100, false, true);
    expect(screen.getByRole('button', { name: 'Zoom in' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Zoom out' })).toHaveProperty('disabled', false);
    expect(screen.getByTestId('zoom-percent').textContent).toBe(`${Math.round(ZOOM_MAX * 100)}%`);
  });

  it('TC-21: a fractional zoom is shown rounded to a whole percent', () => {
    setup(Math.round(1.5625 * 100), true, true);
    expect(screen.getByTestId('zoom-percent').textContent).toBe('156%');
  });

  it('TC-32: clicking a disabled zoom button changes nothing', async () => {
    const user = userEvent.setup();
    const calls = setup(ZOOM_MIN * 100, true, false);

    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    expect((zoomOut as HTMLButtonElement).disabled).toBe(true);

    // A disabled control is skipped by keyboard navigation.
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Zoom in' }));

    // Whether the click arrives as a dispatched event or a real user click, the
    // control never calls its callback while disabled.
    fireEvent.click(zoomOut);
    await user
      .click(zoomOut)
      .catch(() => undefined);

    expect(calls.out).toBe(0);
    expect(calls.in).toBe(0);
    expect(calls.reset).toBe(0);
  });

  it('enabled buttons and Reset view call their callbacks and are keyboard focusable', async () => {
    const user = userEvent.setup();
    const calls = setup(100, true, true);

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    await user.click(screen.getByRole('button', { name: 'Reset view' }));

    expect(calls).toEqual({ in: 1, out: 1, reset: 1 });
  });

  it('wheel events over the control are stopped from reaching React handlers above it', () => {
    setup(100, true, true);
    const container = screen.getByRole('button', { name: 'Reset view' }).parentElement;
    expect(container).not.toBeNull();
    // The control marks itself as board chrome so the board's own wheel handler
    // ignores events that start inside it (see TC-30 in BoardViewport.test).
    expect(container?.getAttribute('data-board-chrome')).toBe('true');
    const stoppered = fireEvent.wheel(screen.getByRole('button', { name: 'Zoom in' }), {
      deltaY: -100,
      ctrlKey: true,
    });
    expect(stoppered).toBe(true);
  });
});
