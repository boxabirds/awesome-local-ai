import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { ZoomControls } from '@client/canvas/ZoomControls';
import { ZOOM_MIN, ZOOM_MAX } from '@shared/config';

function renderZoomControls(zoom: number, overrides: Partial<Parameters<typeof ZoomControls>[0]> = {}) {
  const props = {
    zoomPercent: Math.round(zoom * 100),
    canZoomIn: zoom < ZOOM_MAX,
    canZoomOut: zoom > ZOOM_MIN,
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
    ...overrides,
  };
  const result = render(<ZoomControls {...props} />);
  return { ...result, props };
}

describe('ZoomControls', () => {
  afterEach(cleanup);

  describe('TC-19: at ZOOM_MIN', () => {
    it('Zoom out disabled, Zoom in enabled, label 10%', () => {
      const { getByLabelText, getByTestId } = renderZoomControls(ZOOM_MIN);
      const zoomOut = getByLabelText('Zoom out') as HTMLButtonElement;
      const zoomIn = getByLabelText('Zoom in') as HTMLButtonElement;
      const label = getByTestId('zoom-label');
      expect(zoomOut.disabled).toBe(true);
      expect(zoomIn.disabled).toBe(false);
      expect(label.textContent).toBe('10%');
    });
  });

  describe('TC-20: at ZOOM_MAX', () => {
    it('Zoom in disabled, Zoom out enabled, label 400%', () => {
      const { getByLabelText, getByTestId } = renderZoomControls(ZOOM_MAX);
      const zoomOut = getByLabelText('Zoom out') as HTMLButtonElement;
      const zoomIn = getByLabelText('Zoom in') as HTMLButtonElement;
      const label = getByTestId('zoom-label');
      expect(zoomIn.disabled).toBe(true);
      expect(zoomOut.disabled).toBe(false);
      expect(label.textContent).toBe('400%');
    });
  });

  describe('TC-21: zoom 1.5625', () => {
    it('label shows 156% (rounded)', () => {
      const { getByTestId } = renderZoomControls(1.5625);
      const label = getByTestId('zoom-label');
      expect(label.textContent).toBe('156%');
    });
  });

  describe('TC-32: clicking a disabled button does not call its callback', () => {
    it('disabled Zoom out does not call onZoomOut', () => {
      const { getByLabelText, props } = renderZoomControls(ZOOM_MIN);
      const zoomOut = getByLabelText('Zoom out');
      fireEvent.click(zoomOut);
      expect(props.onZoomOut).not.toHaveBeenCalled();
    });

    it('disabled Zoom in does not call onZoomIn', () => {
      const { getByLabelText, props } = renderZoomControls(ZOOM_MAX);
      const zoomIn = getByLabelText('Zoom in');
      fireEvent.click(zoomIn);
      expect(props.onZoomIn).not.toHaveBeenCalled();
    });
  });

  it('has a Reset view button', () => {
    const { getByLabelText } = renderZoomControls(1);
    expect(getByLabelText('Reset view')).toBeInTheDocument();
  });
});
