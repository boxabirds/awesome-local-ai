import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BoardViewport } from '@client/canvas/BoardViewport';
import { ZoomControls } from '@client/canvas/ZoomControls';
import { useBoard } from '@client/canvas/BoardContext';
import { zoomPercent, canZoomIn, canZoomOut } from '@client/canvas/camera';

// Overlay mirroring App wiring, so controls/hint sit inside the board context.
function OverlayControls() {
  const { camera, zoomStep, reset } = useBoard();
  return (
    <ZoomControls
      zoomPercent={zoomPercent(camera)}
      canZoomIn={canZoomIn(camera)}
      canZoomOut={canZoomOut(camera)}
      onZoomIn={() => zoomStep('in')}
      onZoomOut={() => zoomStep('out')}
      onReset={reset}
    />
  );
}

function NavigatedProbe() {
  const { hasNavigated } = useBoard();
  return <div data-testid="nav-probe" data-navigated={hasNavigated ? 'true' : 'false'} />;
}

function refs() {
  const viewport = screen.getByTestId('board-viewport');
  const world = screen.getByTestId('board-world');
  const marker = screen.getByTestId('origin-marker');
  return { viewport, world, marker };
}

function getZoom(world: HTMLElement): number {
  const m = /scale\(([^)]+)\)/.exec(world.style.transform);
  return m ? Number.parseFloat(m[1]) : Number.NaN;
}

function markerPos(marker: HTMLElement): { x: number; y: number } {
  return {
    x: Number(marker.getAttribute('data-origin-screen-x')),
    y: Number(marker.getAttribute('data-origin-screen-y')),
  };
}

function dispatchWheel(el: Element, init: WheelEventInit): WheelEvent {
  const ev = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaMode: 0, ...init });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

function dispatchKey(init: KeyboardEventInit): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  act(() => {
    window.dispatchEvent(ev);
  });
  return ev;
}

function dispatchGesture(el: Element, scale: number, x: number, y: number): Event {
  const ev = new Event('gesturechange', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'scale', { value: scale });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  act(() => {
    el.dispatchEvent(ev);
  });
  return ev;
}

describe('BoardViewport input (viewport.input)', () => {
  // TC-13
  it('TC-13 dragging the board by (200,100) moves the world by exactly that and Idle->Panning->Idle', () => {
    render(<BoardViewport />);
    const { viewport, marker } = refs();
    const before = markerPos(marker);
    expect(viewport).toHaveAttribute('data-panning', 'false');

    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    expect(viewport).toHaveAttribute('data-panning', 'true'); // Panning

    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 300, clientY: 200 });
    const after = markerPos(marker);
    expect(after.x - before.x).toBeCloseTo(200, 6);
    expect(after.y - before.y).toBeCloseTo(100, 6);
    expect(viewport).toHaveAttribute('data-panning', 'true');

    fireEvent.pointerUp(viewport, { pointerId: 1 });
    expect(viewport).toHaveAttribute('data-panning', 'false'); // Idle
  });

  // TC-14
  it('TC-14 pointercancel freezes the camera and ignores later moves', () => {
    render(<BoardViewport />);
    const { viewport, marker } = refs();
    const initial = markerPos(marker);
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 50, clientY: 30 });
    const frozen = markerPos(marker);
    // The pre-cancel move did move the board.
    expect(frozen.x - initial.x).toBeCloseTo(50, 6);
    expect(frozen.y - initial.y).toBeCloseTo(30, 6);

    fireEvent.pointerCancel(viewport, { pointerId: 1 });
    expect(viewport).toHaveAttribute('data-panning', 'false');

    // A later move after cancel must be ignored: the camera stays frozen.
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 400, clientY: 400 });
    const later = markerPos(marker);
    expect(later.x).toBeCloseTo(frozen.x, 6);
    expect(later.y).toBeCloseTo(frozen.y, 6);
  });

  // TC-15
  it('TC-15 plain wheel deltaY +100 moves content up (camera.y += 100/zoom) and preventDefaults', () => {
    render(<BoardViewport />);
    const { viewport, marker } = refs();
    const before = markerPos(marker);
    const ev = dispatchWheel(viewport, { deltaY: 100 });
    const after = markerPos(marker);
    // Scroll down -> content moves up: marker screen y decreases by 100 at zoom 1.
    expect(after.y).toBeCloseTo(before.y - 100, 6);
    expect(ev.defaultPrevented).toBe(true);
  });

  it('TC-15b trackpad scroll right moves content left', () => {
    render(<BoardViewport />);
    const { viewport, marker } = refs();
    const before = markerPos(marker);
    dispatchWheel(viewport, { deltaX: 60 });
    const after = markerPos(marker);
    expect(after.x).toBeCloseTo(before.x - 60, 6);
  });

  // TC-16
  it('TC-16 Ctrl wheel deltaY -100 zooms in and preventDefaults', () => {
    render(<BoardViewport />);
    const { viewport, world } = refs();
    const before = getZoom(world);
    const ev = dispatchWheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 300, clientY: 200 });
    expect(getZoom(world)).toBeGreaterThan(before);
    expect(ev.defaultPrevented).toBe(true);
  });

  // TC-17
  it('TC-17 Safari gesturechange scale 2 doubles zoom and preventDefaults', () => {
    render(<BoardViewport />);
    const { viewport, world } = refs();
    const before = getZoom(world);
    const ev = dispatchGesture(viewport, 2, 300, 200);
    expect(getZoom(world)).toBeCloseTo(before * 2, 6);
    expect(ev.defaultPrevented).toBe(true);
  });

  // TC-18
  it('TC-18 Ctrl+=, Ctrl+-, Ctrl+0 -> 1.0, 1.25, 1.0, reset, each preventDefault', () => {
    render(<BoardViewport />);
    const { viewport, world, marker } = refs();
    const initial = markerPos(marker);

    const eq = dispatchKey({ key: '=', ctrlKey: true });
    expect(getZoom(world)).toBeCloseTo(1.25, 6);
    expect(eq.defaultPrevented).toBe(true);

    const minus = dispatchKey({ key: '-', ctrlKey: true });
    expect(getZoom(world)).toBeCloseTo(1.0, 9);
    expect(minus.defaultPrevented).toBe(true);

    const zero = dispatchKey({ key: '0', ctrlKey: true });
    expect(getZoom(world)).toBeCloseTo(1.0, 9);
    expect(zero.defaultPrevented).toBe(true);
    // reset recentres the origin exactly where it started
    const afterReset = markerPos(marker);
    expect(afterReset.x).toBeCloseTo(initial.x, 6);
    expect(afterReset.y).toBeCloseTo(initial.y, 6);
    void viewport;
  });

  // TC-29
  it('TC-29 click without moving leaves the camera unchanged and does not dismiss the hint', () => {
    render(
      <BoardViewport overlay={<NavigatedProbe />} />,
    );
    const { viewport, marker } = refs();
    const probe = screen.getByTestId('nav-probe');
    expect(probe).toHaveAttribute('data-navigated', 'false');
    const before = markerPos(marker);

    fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 42, clientY: 42 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 42, clientY: 42 });

    const after = markerPos(marker);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
    expect(probe).toHaveAttribute('data-navigated', 'false');
  });

  // TC-30
  it('TC-30 Ctrl wheel over the zoom control does not zoom the board and is not preventDefaulted there', () => {
    render(
      <BoardViewport overlay={<OverlayControls />} />,
    );
    const { viewport, world } = refs();
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' });
    const before = getZoom(world);
    const ev = dispatchWheel(zoomIn, { deltaY: -100, ctrlKey: true });
    expect(getZoom(world)).toBeCloseTo(before, 9); // board unchanged
    expect(ev.defaultPrevented).toBe(false); // browser default preserved over UI
    // and the board itself would still zoom, proving the guard is target-specific
    dispatchWheel(viewport, { deltaY: -100, ctrlKey: true, clientX: 5, clientY: 5 });
    expect(getZoom(world)).toBeGreaterThan(before);
  });
});
