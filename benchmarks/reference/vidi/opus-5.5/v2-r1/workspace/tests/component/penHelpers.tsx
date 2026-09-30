import { fireEvent, screen } from '@testing-library/react';
import type * as Y from 'yjs';
import { objectsSnapshot } from '../../src/shared/board-model';
import type { Point } from '../../src/shared/geometry';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { toClient } from './shapeHelpers';

export const penTool = () => screen.getByTestId('pen-tool');
export const strokesOf = (doc: Y.Doc) =>
  objectsSnapshot(doc).filter((o): o is StrokeSnap => o.type === 'stroke');
export const penButton = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Pen (P)' });
export const isPressed = (el: Element) => el.getAttribute('aria-pressed') === 'true';

/** Draws through world points with the Pen tool: press at the first, move through the rest, release. */
export function drawWorld(points: readonly Point[], opts: { end?: 'up' | 'cancel' | 'lost' } = {}) {
  const el = penTool();
  const c = points.map(toClient);
  fireEvent.pointerDown(el, { clientX: c[0].x, clientY: c[0].y, button: 0, pointerId: 1 });
  for (const p of c.slice(1)) fireEvent.pointerMove(el, { clientX: p.x, clientY: p.y, pointerId: 1 });
  const last = c[c.length - 1];
  if (opts.end === 'cancel') fireEvent.pointerCancel(el, { pointerId: 1 });
  else if (opts.end === 'lost') fireEvent(el, new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 1 }));
  else fireEvent.pointerUp(el, { clientX: last.x, clientY: last.y, pointerId: 1 });
}
