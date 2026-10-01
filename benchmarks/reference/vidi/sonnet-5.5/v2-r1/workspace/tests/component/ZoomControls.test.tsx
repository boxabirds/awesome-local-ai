import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

afterEach(cleanup);

function renderAt(zoom: number, handlers = { onZoomIn: vi.fn(), onZoomOut: vi.fn(), onReset: vi.fn() }) {
  const cam = { x: 0, y: 0, zoom };
  render(
    <ZoomControls zoomPercent={zoomPercent(cam)} canZoomIn={canZoomIn(cam)} canZoomOut={canZoomOut(cam)} {...handlers} />,
  );
  return handlers;
}

const out = () => screen.getByLabelText('Zoom out') as HTMLButtonElement;
const inn = () => screen.getByLabelText('Zoom in') as HTMLButtonElement;

describe('ZoomControls', () => {
  it('TC-19 at min zoom: Zoom out disabled, label 10%', () => {
    renderAt(ZOOM_MIN);
    expect(out().disabled).toBe(true);
    expect(inn().disabled).toBe(false);
    expect(screen.getByText('10%')).toBeTruthy();
  });

  it('TC-20 at max zoom: Zoom in disabled, label 400%', () => {
    renderAt(ZOOM_MAX);
    expect(inn().disabled).toBe(true);
    expect(out().disabled).toBe(false);
    expect(screen.getByText('400%')).toBeTruthy();
  });

  it('TC-21 label is rounded', () => {
    renderAt(1.5625);
    expect(screen.getByText('156%')).toBeTruthy();
    expect(screen.getByText('156%').tagName).toBe('OUTPUT');
    expect(screen.getByText('156%').getAttribute('aria-live')).toBe('polite');
  });

  it('calls callbacks for enabled buttons and Reset view', () => {
    const h = renderAt(1);
    fireEvent.click(inn());
    fireEvent.click(out());
    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(h.onZoomIn).toHaveBeenCalledTimes(1);
    expect(h.onZoomOut).toHaveBeenCalledTimes(1);
    expect(h.onReset).toHaveBeenCalledTimes(1);
  });

  it('TC-32 clicking a disabled button does not call its callback', () => {
    const h = renderAt(ZOOM_MIN);
    fireEvent.click(out());
    expect(h.onZoomOut).not.toHaveBeenCalled();
  });
});
