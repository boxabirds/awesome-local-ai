import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { snapshot, type ObjectSnapshot } from '../../src/shared/board-model';
import { createShape } from '../../src/shared/objects/shape';
import type { ShapeKind } from '../../src/shared/config';

export function renderBoard(shapes: { kind?: ShapeKind; x: number; y: number; w?: number; h?: number }[] = []) {
  const doc = new Y.Doc();
  const ids = shapes.map((s) =>
    createShape(doc, { kind: s.kind ?? 'rect', rect: { x: s.x, y: s.y, width: s.w ?? 100, height: s.h ?? 100 }, at: { x: s.x, y: s.y } }, 'g_test')!,
  );
  render(<App doc={doc} />);
  return { doc, ids };
}

/** Current camera origin read from the world layer's transform (zoom is whatever the board shows). */
export function camera(): { x: number; y: number; zoom: number } {
  const t = screen.getByTestId('world-layer').style.transform;
  const m = /scale\(([-\d.e]+)\) translate\(([-\d.e]+)px, ([-\d.e]+)px\)/.exec(t);
  if (!m) throw new Error(`unexpected transform ${t}`);
  return { zoom: Number(m[1]), x: -Number(m[2]), y: -Number(m[3]) };
}
export const toScreen = (p: { x: number; y: number }) => {
  const c = camera();
  return { x: (p.x - c.x) * c.zoom, y: (p.y - c.y) * c.zoom };
};

export function key(k: string, init: KeyboardEventInit = {}) {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
}

export const down = (el: Element, x: number, y: number, init: PointerEventInit = {}) => fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1, button: 0, ...init });
export const move = (el: Element, x: number, y: number, init: PointerEventInit = {}) => fireEvent.pointerMove(el, { clientX: x, clientY: y, pointerId: 1, ...init });
export const up = (el: Element, x: number, y: number, init: PointerEventInit = {}) => fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1, ...init });

export const objectsOf = (doc: Y.Doc, type: string): ObjectSnapshot[] => snapshot(doc).filter((o) => o.type === type);
export const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
