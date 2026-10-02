import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { ZOOM_MIN, ZOOM_MAX, ZOOM_STEP_FACTOR } from '../../src/shared/config';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ZoomControls', () => {
  describe('TC-19: at ZOOM_MIN, Zoom out is disabled', () => {
    it('Zoom out disabled, Zoom in enabled, label shows 10%', () => {
      render(
        <ZoomControls
          zoomPercent={Math.round(ZOOM_MIN * 100)}
          canZoomIn={true}
          canZoomOut={false}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />,
      );

      expect(screen.getByLabelText('Zoom out')).toBeDisabled();
      expect(screen.getByLabelText('Zoom in')).toBeEnabled();
      expect(screen.getByTestId('zoom-label')).toHaveTextContent('10%');
    });
  });

  describe('TC-20: at ZOOM_MAX, Zoom in is disabled', () => {
    it('Zoom in disabled, label shows 400%', () => {
      render(
        <ZoomControls
          zoomPercent={Math.round(ZOOM_MAX * 100)}
          canZoomIn={false}
          canZoomOut={true}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />,
      );

      expect(screen.getByLabelText('Zoom in')).toBeDisabled();
      expect(screen.getByTestId('zoom-label')).toHaveTextContent('400%');
    });
  });

  describe('TC-21: zoom 1.5625 shows 156%', () => {
    it('label shows 156% (rounded)', () => {
      const zoom = 1.5625;
      render(
        <ZoomControls
          zoomPercent={Math.round(zoom * 100)}
          canZoomIn={true}
          canZoomOut={true}
          onZoomIn={vi.fn()}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />,
      );

      expect(screen.getByTestId('zoom-label')).toHaveTextContent('156%');
    });
  });

  describe('TC-32: clicking disabled button does not call callback', () => {
    it('disabled Zoom out does not call onZoomOut', () => {
      const onZoomOut = vi.fn();
      render(
        <ZoomControls
          zoomPercent={Math.round(ZOOM_MIN * 100)}
          canZoomIn={true}
          canZoomOut={false}
          onZoomIn={vi.fn()}
          onZoomOut={onZoomOut}
          onReset={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByLabelText('Zoom out'));
      expect(onZoomOut).not.toHaveBeenCalled();
    });

    it('disabled Zoom in does not call onZoomIn', () => {
      const onZoomIn = vi.fn();
      render(
        <ZoomControls
          zoomPercent={Math.round(ZOOM_MAX * 100)}
          canZoomIn={false}
          canZoomOut={true}
          onZoomIn={onZoomIn}
          onZoomOut={vi.fn()}
          onReset={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByLabelText('Zoom in'));
      expect(onZoomIn).not.toHaveBeenCalled();
    });
  });
});
