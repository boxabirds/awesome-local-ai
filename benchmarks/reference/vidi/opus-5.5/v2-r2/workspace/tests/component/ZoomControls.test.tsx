import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config';
import { flushFrame, renderApp } from './helpers';

function renderControls(zoom: number) {
  const cam = { x: 0, y: 0, zoom };
  const props = {
    zoomPercent: zoomPercent(cam),
    canZoomIn: canZoomIn(cam),
    canZoomOut: canZoomOut(cam),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
  };
  render(<ZoomControls {...props} />);
  return {
    props,
    zoomIn: screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement,
    zoomOut: screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement,
    reset: screen.getByRole('button', { name: 'Reset view' }) as HTMLButtonElement,
    label: screen.getByRole('status'),
  };
}

describe('zoom.controls', () => {
  it('renders an announced percentage label', () => {
    const { label } = renderControls(1);
    expect(label.tagName).toBe('OUTPUT');
    expect(label.getAttribute('aria-live')).toBe('polite');
    expect(label.textContent).toBe('100%');
  });

  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label 10%', () => {
    const { zoomIn, zoomOut, label } = renderControls(ZOOM_MIN);
    expect(zoomOut.disabled).toBe(true);
    expect(zoomIn.disabled).toBe(false);
    expect(label.textContent).toBe(`${Math.round(ZOOM_MIN * 100)}%`);
    expect(label.textContent).toBe('10%');
  });

  it('TC-20 at ZOOM_MAX: Zoom in disabled, label 400%', () => {
    const { zoomIn, zoomOut, label } = renderControls(ZOOM_MAX);
    expect(zoomIn.disabled).toBe(true);
    expect(zoomOut.disabled).toBe(false);
    expect(label.textContent).toBe('400%');
  });

  it('TC-21 zoom 1.5625 shows 156%', () => {
    const { label } = renderControls(ZOOM_STEP_FACTOR * ZOOM_STEP_FACTOR);
    expect(label.textContent).toBe('156%');
  });

  it('calls callbacks for enabled buttons', async () => {
    const user = userEvent.setup();
    const { props, zoomIn, zoomOut, reset } = renderControls(1);
    await user.click(zoomIn);
    await user.click(zoomOut);
    await user.click(reset);
    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-32 clicking a disabled button does not call its callback', async () => {
    const user = userEvent.setup();
    const { props, zoomIn } = renderControls(ZOOM_MAX);
    await user.click(zoomIn);
    expect(props.onZoomIn).not.toHaveBeenCalled();
  });

  it('buttons are keyboard focusable', async () => {
    const user = userEvent.setup();
    const { zoomOut, zoomIn, reset } = renderControls(1);
    await user.tab();
    expect(document.activeElement).toBe(zoomOut);
    await user.tab();
    expect(document.activeElement).toBe(zoomIn);
    await user.tab();
    expect(document.activeElement).toBe(reset);
  });

  it('wired to the board: + steps to 125%, − back to 100%, limits disable buttons', () => {
    renderApp();
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
    const zoomOut = screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement;
    const label = screen.getByRole('status');
    zoomIn.click();
    flushFrame();
    expect(label.textContent).toBe('125%');
    zoomOut.click();
    flushFrame();
    expect(label.textContent).toBe('100%');
    for (let i = 0; i < 30 && !zoomOut.disabled; i++) {
      zoomOut.click();
      flushFrame();
    }
    expect(label.textContent).toBe('10%');
    expect(zoomOut.disabled).toBe(true);
    zoomIn.click();
    flushFrame();
    expect(zoomOut.disabled).toBe(false);
    for (let i = 0; i < 30 && !zoomIn.disabled; i++) {
      zoomIn.click();
      flushFrame();
    }
    expect(label.textContent).toBe('400%');
    expect(zoomIn.disabled).toBe(true);
    screen.getByRole('button', { name: 'Reset view' }).click();
    flushFrame();
    expect(label.textContent).toBe('100%');
  });
});
