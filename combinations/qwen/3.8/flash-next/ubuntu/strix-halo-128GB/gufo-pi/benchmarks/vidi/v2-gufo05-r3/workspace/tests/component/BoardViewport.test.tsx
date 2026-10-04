import { describe, expect, it } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { BoardViewport } from '../../src/client/canvas/BoardViewport';
import {
  GRID_SPACING_WORLD,
  WHEEL_ZOOM_SENSITIVITY,
  ZOOM_MAX,
} from '../../src/shared/config';

function setup() {
  const { container } = render(<BoardViewport />);
  const root = container.querySelector<HTMLElement>('.board-viewport')!;
  const surface = container.querySelector<HTMLElement>('[data-board-surface]')!;
  const worldLayer = container.querySelector<HTMLElement>('.world-layer')!;
  const marker = container.querySelector<HTMLElement>('[data-origin-marker]')!;
  const controls = container.querySelector<HTMLElement>('[data-zoom-controls]')!;
  const zoomLabel = container.querySelector<HTMLElement>('.zoom-label')!;
  const hint = () => container.querySelector('[data-navigation-hint]');
  return { root, surface, worldLayer, marker, controls, zoomLabel, hint };
}

const zoomValue = (label: HTMLElement) => parseInt(label.textContent ?? '', 10);
const markerPos = (m: HTMLElement) => ({
  left: parseFloat(m.style.left),
  top: parseFloat(m.style.top),
});

describe('BoardViewport input (TC-13..TC-18, TC-29, TC-30)', () => {
  it('TC-13 drag 200,100 moves the world layer with camera and cycles Idle->Panning->Idle', () => {
    const { root, surface, worldLayer } = setup();
    expect(root.getAttribute('data-panning')).toBe('false');
    fireEvent.pointerDown(surface, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    expect(root.getAttribute('data-panning')).toBe('true');
    fireEvent.pointerMove(surface, { clientX: 200, clientY: 100, button: 0, pointerId: 1 });
    // camera x = -200, y = -100 -> translate(200px, 100px)
    expect(worldLayer.style.transform).toBe(`scale(1) translate(200px, 100px)`);
    fireEvent.pointerUp(surface, { clientX: 200, clientY: 100, button: 0, pointerId: 1 });
    expect(root.getAttribute('data-panning')).toBe('false');
  });

  it('TC-14 pointercancel freezes the camera; later moves are ignored', () => {
    const { surface, worldLayer } = setup();
    fireEvent.pointerDown(surface, { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 150, clientY: 60, button: 0, pointerId: 1 });
    const frozen = worldLayer.style.transform;
    fireEvent.pointerCancel(surface, { clientX: 150, clientY: 60, button: 0, pointerId: 1 });
    fireEvent.pointerMove(surface, { clientX: 999, clientY: 999, button: 0, pointerId: 1 });
    expect(worldLayer.style.transform).toBe(frozen);
    expect(frozen).toBe(`scale(1) translate(150px, 60px)`);
  });

  it('TC-15 plain wheel deltaY +100 pans camera y by +100/zoom and is prevented', () => {
    const { root, marker } = setup();
    const before = markerPos(marker).top;
    const notPrevented = fireEvent.wheel(root, { deltaY: 100, clientX: 0, clientY: 0 });
    expect(notPrevented).toBe(false); // preventDefault was called
    // camera.y += 100/zoom -> origin screen top decreases by 100 (screen = -cam.y)
    expect(markerPos(marker).top).toBeCloseTo(before - 100 / 1, 6);
  });

  it('TC-16 Ctrl wheel deltaY -100 zooms in and is prevented', () => {
    const { root, zoomLabel } = setup();
    expect(zoomValue(zoomLabel)).toBe(100);
    const notPrevented = fireEvent.wheel(root, {
      deltaY: -100,
      ctrlKey: true,
      clientX: 300,
      clientY: 200,
    });
    expect(notPrevented).toBe(false);
    const after = zoomValue(zoomLabel);
    expect(after).toBeGreaterThan(100);
    // factor = exp(100 * sensitivity) => ~e (within rounding of percent label)
    expect(after).toBe(Math.round(Math.exp(100 * WHEEL_ZOOM_SENSITIVITY) * 100));
  });

  it('TC-17 Safari gesturechange scale 2 doubles zoom and is prevented', () => {
    const { root, zoomLabel } = setup();
    const ev = new Event('gesturechange', { bubbles: true, cancelable: true });
    Object.assign(ev, { scale: 2, clientX: 300, clientY: 200 });
    act(() => {
      root.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(zoomValue(zoomLabel)).toBe(Math.round(Math.min(1 * 2, ZOOM_MAX) * 100));
  });

  it('TC-18 Ctrl = / - / 0 step zoom and reset, each prevented', () => {
    const { zoomLabel } = setup();
    expect(fireEvent.keyDown(window, { key: '=', ctrlKey: true })).toBe(false);
    expect(zoomValue(zoomLabel)).toBe(125);
    expect(fireEvent.keyDown(window, { key: '-', ctrlKey: true })).toBe(false);
    expect(zoomValue(zoomLabel)).toBe(100);
    expect(fireEvent.keyDown(window, { key: '0', ctrlKey: true })).toBe(false);
    expect(zoomValue(zoomLabel)).toBe(100);
  });

  it('TC-29 click without moving leaves camera unchanged and hint visible', () => {
    const { surface, marker, hint } = setup();
    const before = markerPos(marker);
    fireEvent.pointerDown(surface, { clientX: 40, clientY: 40, button: 0, pointerId: 1 });
    fireEvent.pointerUp(surface, { clientX: 40, clientY: 40, button: 0, pointerId: 1 });
    expect(markerPos(marker)).toEqual(before);
    expect(hint()).not.toBeNull(); // hint not dismissed
  });

  it('TC-30 Ctrl wheel over the zoom controls does not zoom the board and is not prevented', () => {
    const { controls, zoomLabel } = setup();
    const before = zoomValue(zoomLabel);
    const target = controls.querySelector('[aria-label="Zoom in"]') as HTMLElement;
    const notPrevented = fireEvent.wheel(target, {
      deltaY: -100,
      ctrlKey: true,
      clientX: 5,
      clientY: 5,
    });
    expect(notPrevented).toBe(true); // board handler skipped; browser default kept
    expect(zoomValue(zoomLabel)).toBe(before);
  });

  it('grid background size tracks zoom (grid attached to board)', () => {
    const { root, surface } = setup();
    expect(surface.style.backgroundSize).toBe(`${GRID_SPACING_WORLD * 1}px ${GRID_SPACING_WORLD * 1}px`);
    fireEvent.wheel(root, { deltaY: -100, ctrlKey: true, clientX: 0, clientY: 0 });
    // Zoomed in: spacing must grow with zoom.
    const size = parseFloat(surface.style.backgroundSize);
    expect(size).toBeGreaterThan(GRID_SPACING_WORLD);
  });
});
