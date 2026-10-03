import { render, screen, userEvent } from './tl.js';
import { describe, expect, it, vi } from 'vitest';

import { ZoomControls, renderWithZoom, zoomPercentOf } from './harness.js';
import { zoomLabel } from './helpers.js';
import { ZOOM_MAX, ZOOM_MIN, ZOOM_STEP_FACTOR } from '../../src/shared/config.js';

/**
 * Zoom controls: − , percentage, + and Reset view (design "zoom.controls").
 * The component is stateless, so these tests drive it with props derived from
 * cameras at each equivalence class of zoom level: at ZOOM_MIN, in between, and
 * at ZOOM_MAX.
 */
describe('zoom label (zoom.indicator)', () => {
  it('TC-19 at ZOOM_MIN: Zoom out disabled, Zoom in enabled, label "10%"', () => {
    renderWithZoom({ zoom: ZOOM_MIN });
    expect(screen.getByLabelText('Zoom out')).toBeDisabled();
    expect(screen.getByLabelText('Zoom in')).toBeEnabled();
    expect(zoomLabel()).toHaveTextContent(`${zoomPercentOf(ZOOM_MIN)}%`);
    expect(zoomLabel()).toHaveTextContent('10%');
  });

  it('TC-20 at ZOOM_MAX: Zoom in disabled, Zoom out enabled, label "400%"', () => {
    renderWithZoom({ zoom: ZOOM_MAX });
    expect(screen.getByLabelText('Zoom in')).toBeDisabled();
    expect(screen.getByLabelText('Zoom out')).toBeEnabled();
    expect(zoomLabel()).toHaveTextContent('400%');
  });

  it('TC-21 at 1.5625: label "156%" (rounded to a whole percent)', () => {
    renderWithZoom({ zoom: 1.5625 });
    expect(zoomLabel()).toHaveTextContent('156%');
  });

  it('shows 100% at 1 and 125% one step in', () => {
    renderWithZoom({ zoom: 1 });
    expect(zoomLabel()).toHaveTextContent(`${zoomPercentOf(1)}%`);
  });

  it('shows 125% one step in from 100%', () => {
    renderWithZoom({ zoom: ZOOM_STEP_FACTOR });
    expect(zoomLabel()).toHaveTextContent('125%');
  });

  it('announces changes politely', () => {
    renderWithZoom({ zoom: 1 });
    expect(zoomLabel()).toHaveAttribute('aria-live', 'polite');
    expect(zoomLabel().tagName).toBe('OUTPUT');
  });
});

describe('zoom buttons (zoom.step, zoom.limits)', () => {
  it('TC-32 clicking a disabled button does not call its callback', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    const onReset = vi.fn();
    renderWithZoom({ zoom: ZOOM_MAX, onZoomIn, onZoomOut, onReset });

    await userEvent.click(screen.getByLabelText('Zoom in'));
    expect(onZoomIn).not.toHaveBeenCalled();
    await userEvent.click(screen.getByLabelText('Zoom out'));
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Reset view' }));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('calls the callbacks for enabled buttons', async () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    renderWithZoom({ zoom: 1, onZoomIn, onZoomOut });
    await userEvent.click(screen.getByLabelText('Zoom in'));
    await userEvent.click(screen.getByLabelText('Zoom out'));
    expect(onZoomIn).toHaveBeenCalledTimes(1);
    expect(onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('has accessible names for every control', () => {
    renderWithZoom({ zoom: 1 });
    const controls = screen.getByTestId('zoom-controls');
    const names = [...controls.querySelectorAll('button')].map(
      (button) => button.getAttribute('aria-label') ?? button.textContent,
    );
    expect(names).toEqual(['Zoom out', 'Zoom in', 'Reset view']);
    expect(controls.querySelector('button[aria-label="Zoom out"]')?.textContent).toBe('\u2212');
    expect(controls.querySelector('button[aria-label="Zoom in"]')?.textContent).toBe('+');
    expect(controls.querySelector('button[aria-label="Zoom out"]')).toBeEnabled();
  });

  it('is keyboard reachable in order, skipping the live label', async () => {
    const onReset = vi.fn();
    renderWithZoom({ zoom: 1, onReset });
    const zoomOut = screen.getByLabelText('Zoom out');
    zoomOut.focus();
    expect(document.activeElement).toBe(zoomOut);
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByLabelText('Zoom in'));
    await userEvent.keyboard('{Tab}');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reset view' }));
    await userEvent.keyboard('{Enter}');
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('renders the documented props contract directly', () => {
    render(
      <ZoomControls
        zoomPercent={200}
        canZoomIn={false}
        canZoomOut
        onZoomIn={() => undefined}
        onZoomOut={() => undefined}
        onReset={() => undefined}
      />,
    );
    expect(zoomLabel()).toHaveTextContent('200%');
    expect(screen.getByLabelText('Zoom in')).toBeDisabled();
    expect(screen.getByLabelText('Zoom out')).toBeEnabled();
  });
});
