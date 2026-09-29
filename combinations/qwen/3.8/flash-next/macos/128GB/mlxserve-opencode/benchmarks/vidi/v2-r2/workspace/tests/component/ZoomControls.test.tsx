import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MIN, ZOOM_MAX } from '../../src/shared/config';

describe('ZoomControls', () => {
  describe('TC-19: at ZOOM_MIN, Zoom out is disabled', () => {
    it('renders Zoom out disabled, Zoom in enabled, label shows 10%', () => {
      render(
        <ZoomControls
          zoomPercent={Math.round(ZOOM_MIN * 100)}
          canZoomIn={true}
          canZoomOut={false}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />
      );
      const zoomOut = screen.getByLabelText('Zoom out');
      const zoomIn = screen.getByLabelText('Zoom in');
      expect(zoomOut).toHaveAttribute('disabled');
      expect(zoomIn).not.toHaveAttribute('disabled');
      expect(screen.getByText('10%')).toBeTruthy();
    });
  });

  describe('TC-20: at ZOOM_MAX, Zoom in is disabled', () => {
    it('renders Zoom in disabled, Zoom out enabled, label shows 400%', () => {
      render(
        <ZoomControls
          zoomPercent={Math.round(ZOOM_MAX * 100)}
          canZoomIn={false}
          canZoomOut={true}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />
      );
      const zoomIn = screen.getByLabelText('Zoom in');
      const zoomOut = screen.getByLabelText('Zoom out');
      expect(zoomIn).toHaveAttribute('disabled');
      expect(zoomOut).not.toHaveAttribute('disabled');
      expect(screen.getByText('400%')).toBeTruthy();
    });
  });

  describe('TC-21: zoom 1.5625 rounds to 156%', () => {
    it('label shows "156%"', () => {
      render(
        <ZoomControls
          zoomPercent={Math.round(1.5625 * 100)}
          canZoomIn={true}
          canZoomOut={true}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />
      );
      expect(screen.getByText('156%')).toBeTruthy();
    });
  });

  describe('TC-32: clicking disabled button does not call callback', () => {
    it('clicking disabled Zoom in does not call onZoomIn', () => {
      const onZoomIn = vi.fn();
      render(
        <ZoomControls
          zoomPercent={400}
          canZoomIn={false}
          canZoomOut={true}
          onZoomIn={onZoomIn}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />
      );
      const zoomIn = screen.getByLabelText('Zoom in');
      fireEvent.click(zoomIn);
      expect(onZoomIn).not.toHaveBeenCalled();
    });

    it('clicking disabled Zoom out does not call onZoomOut', () => {
      const onZoomOut = vi.fn();
      render(
        <ZoomControls
          zoomPercent={10}
          canZoomIn={true}
          canZoomOut={false}
          onZoomIn={vi.fn()}
          onZoomOut={onZoomOut}
          onReset={vi.fn()}
        />
      );
      const zoomOut = screen.getByLabelText('Zoom out');
      fireEvent.click(zoomOut);
      expect(onZoomOut).not.toHaveBeenCalled();
    });
  });
});
