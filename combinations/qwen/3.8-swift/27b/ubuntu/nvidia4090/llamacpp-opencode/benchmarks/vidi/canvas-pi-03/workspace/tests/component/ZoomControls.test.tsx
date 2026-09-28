import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, within, cleanup } from '@testing-library/react';
import { ZoomControls } from 'src/client/canvas/ZoomControls';
import { ZOOM_MIN, ZOOM_MAX } from 'src/shared/config';

afterEach(() => {
  cleanup();
});

describe('TC-19: at ZOOM_MIN - Zoom out disabled, label 10%', () => {
  it('renders disabled zoom out and 10% label', () => {
    const { container } = render(
      <ZoomControls
        zoomPercent={Math.round(ZOOM_MIN * 100)}
        canZoomIn={true}
        canZoomOut={false}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
      />,
    );
    const zoomOut = within(container).getByLabelText('Zoom out');
    const zoomIn = within(container).getByLabelText('Zoom in');
    const label = within(container).getByTestId('zoom-label');
    expect(zoomOut).toBeDisabled();
    expect(zoomIn).toBeEnabled();
    expect(label).toHaveTextContent('10%');
  });
});

describe('TC-20: at ZOOM_MAX - Zoom in disabled, label 400%', () => {
  it('renders disabled zoom in and 400% label', () => {
    const { container } = render(
      <ZoomControls
        zoomPercent={Math.round(ZOOM_MAX * 100)}
        canZoomIn={false}
        canZoomOut={true}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
      />,
    );
    const zoomOut = within(container).getByLabelText('Zoom out');
    const zoomIn = within(container).getByLabelText('Zoom in');
    const label = within(container).getByTestId('zoom-label');
    expect(zoomOut).toBeEnabled();
    expect(zoomIn).toBeDisabled();
    expect(label).toHaveTextContent('400%');
  });
});

describe('TC-21: zoom 1.5625 - label 156%', () => {
  it('renders rounded percentage label', () => {
    const { container } = render(
      <ZoomControls
        zoomPercent={Math.round(1.5625 * 100)}
        canZoomIn={true}
        canZoomOut={true}
        onZoomIn={() => {}}
        onZoomOut={() => {}}
        onReset={() => {}}
      />,
    );
    const label = within(container).getByTestId('zoom-label');
    expect(label).toHaveTextContent('156%');
  });
});

describe('TC-32: clicking a disabled button does not call its callback', () => {
  it('disabled zoom out does not call onZoomOut', () => {
    const onZoomOut = vi.fn();
    const { container } = render(
      <ZoomControls
        zoomPercent={10}
        canZoomIn={true}
        canZoomOut={false}
        onZoomIn={() => {}}
        onZoomOut={onZoomOut}
        onReset={() => {}}
      />,
    );
    const zoomOut = within(container).getByLabelText('Zoom out');
    (zoomOut as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onZoomOut).not.toHaveBeenCalled();
  });

  it('disabled zoom in does not call onZoomIn', () => {
    const onZoomIn = vi.fn();
    const { container } = render(
      <ZoomControls
        zoomPercent={400}
        canZoomIn={false}
        canZoomOut={true}
        onZoomIn={onZoomIn}
        onZoomOut={() => {}}
        onReset={() => {}}
      />,
    );
    const zoomIn = within(container).getByLabelText('Zoom in');
    (zoomIn as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onZoomIn).not.toHaveBeenCalled();
  });
});
