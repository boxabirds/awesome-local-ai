/** Story 10 component test helpers: the whole app on a real Y.Doc, driven with pointer events. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { snapshotObjects } from '../../src/shared/board-model';
import { isShapeSnap, type ShapeSnap } from '../../src/shared/objects/shape';
import { isConnectorSnap, type ConnectorSnap } from '../../src/shared/objects/connector';
import { worldToScreen, type Camera, type Point } from '../../src/client/canvas/camera';
import { dispatch, FRAME_MS, readCamera } from './helpers';

export const POINTER_ID = 1;

export function renderApp(doc: Y.Doc): void {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  render(<App doc={doc} />);
}

export function key(k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return dispatch(window, new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
}

type PointerKind = 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel';

export function pointer(el: Element | Window, type: PointerKind, p: Point, init: { shiftKey?: boolean } = {}): void {
  fireEvent[type](el, { clientX: p.x, clientY: p.y, pointerId: POINTER_ID, button: 0, buttons: 1, ...init });
}

/** Press at `from`, move in steps to `to`, release there. */
export function dragOn(el: Element, from: Point, to: Point, init: { shiftKey?: boolean } = {}): void {
  pointer(el, 'pointerDown', from, init);
  const STEPS = 4;
  for (let i = 1; i <= STEPS; i += 1) {
    pointer(el, 'pointerMove', { x: from.x + ((to.x - from.x) * i) / STEPS, y: from.y + ((to.y - from.y) * i) / STEPS }, init);
  }
  pointer(el, 'pointerUp', to, init);
}

export function shapes(doc: Y.Doc): ShapeSnap[] {
  return snapshotObjects(doc).filter(isShapeSnap);
}

export function connectors(doc: Y.Doc): ConnectorSnap[] {
  return snapshotObjects(doc).filter(isConnectorSnap);
}

export function toScreen(p: Point, camera: Camera = readCamera()): Point {
  return worldToScreen(camera, p);
}

export function objectEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-id="${id}"]`);
  if (el === null) throw new Error(`object ${id} not rendered`);
  return el;
}

export function toolButton(name: string): HTMLElement {
  return screen.getByRole('button', { name });
}

/** Jumps the camera through the test hook and renders it. */
export function setCamera(camera: Camera): void {
  act(() => {
    window.__vidi6!.setCamera(camera);
  });
  act(() => {
    vi.advanceTimersByTime(FRAME_MS);
  });
}
