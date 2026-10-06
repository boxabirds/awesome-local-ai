import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';
import { ZoomControls } from '../../src/client/canvas/ZoomControls';
import { canZoomIn, canZoomOut, zoomPercent, type Camera } from '../../src/client/canvas/camera';
import { ZOOM_MAX, ZOOM_MIN } from '../../src/shared/config';

function cameraAt(zoom: number): Camera {
  return { x: 0, y: 0, zoom };
}

function setup(zoom: number) {
  const props = {
    zoomPercent: zoomPercent(cameraAt(zoom)),
    canZoomIn: canZoomIn(cameraAt(zoom)),
    canZoomOut: canZoomOut(cameraAt(zoom)),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    onReset: vi.fn(),
  };
  render(<ZoomControls {...props} />);
  return props;
}

const zoomOutButton = () => screen.getByRole('button', { name: 'Zoom out' });
const zoomInButton = () => screen.getByRole('button', { name: 'Zoom in' });
const resetButton = () => screen.getByRole('button', { name: 'Reset view' });
const label = () => screen.getByTestId('zoom-percent');

describe('zoom.controls', () => {
  test('TC-19 at ZOOM_MIN the Zoom out button is disabled and the label reads 10%', () => {
    setup(ZOOM_MIN);

    expect(zoomOutButton()).toBeDisabled();
    expect(zoomInButton()).toBeEnabled();
    expect(label()).toHaveTextContent('10%');
  });

  test('TC-20 at ZOOM_MAX the Zoom in button is disabled and the label reads 400%', () => {
    setup(ZOOM_MAX);

    expect(zoomInButton()).toBeDisabled();
    expect(zoomOutButton()).toBeEnabled();
    expect(label()).toHaveTextContent('400%');
  });

  test('TC-21 the label shows the zoom rounded to a whole percent (1.5625 -> 156%)', () => {
    setup(1.5625);

    expect(label()).toHaveTextContent('156%');
    expect(zoomInButton()).toBeEnabled();
    expect(zoomOutButton()).toBeEnabled();
  });

  test('TC-32 clicking a disabled zoom button does nothing', async () => {
    const user = userEvent.setup();
    const props = setup(ZOOM_MAX);

    await user.click(zoomInButton());

    expect(props.onZoomIn).not.toHaveBeenCalled();
    expect(props.onZoomOut).not.toHaveBeenCalled();
    expect(props.onReset).not.toHaveBeenCalled();
  });

  test('the buttons call their callbacks when enabled', async () => {
    const user = userEvent.setup();
    const props = setup(1);

    await user.click(zoomInButton());
    await user.click(zoomOutButton());
    await user.click(resetButton());

    expect(props.onZoomIn).toHaveBeenCalledTimes(1);
    expect(props.onZoomOut).toHaveBeenCalledTimes(1);
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  test('all controls are keyboard focusable and in a sensible order', async () => {
    const user = userEvent.setup();
    const props = setup(1);

    await user.tab();
    expect(zoomOutButton()).toHaveFocus();
    await user.tab();
    expect(zoomInButton()).toHaveFocus(); // the zoom label is an <output>, not focusable
    await user.tab();
    expect(resetButton()).toHaveFocus();

    // jsdom does not implement key activation of buttons, so activation is asserted with a click
    fireEvent.click(resetButton());
    expect(props.onReset).toHaveBeenCalledTimes(1);
  });

  test('the zoom label is announced politely when it changes', () => {
    const { rerender } = render(
      <ZoomControls
        zoomPercent={100}
        canZoomIn
        canZoomOut
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(label()).toHaveAttribute('aria-live', 'polite');

    rerender(
      <ZoomControls
        zoomPercent={125}
        canZoomIn
        canZoomOut
        onZoomIn={vi.fn()}
        onZoomOut={vi.fn()}
        onReset={vi.fn()}
      />,
    );
    expect(label()).toHaveTextContent('125%');
  });
});
