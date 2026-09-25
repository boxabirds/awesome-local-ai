/**
 * connector.ui (story 10) on the real board with a real Y.Doc: connection dots, creating
 * arrows, selecting them near the line, and moving their ends. TC-18 to TC-21.
 */
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { deleteObjects } from '../../src/shared/board-model';
import { sideAnchor } from '../../src/shared/geometry/connector-geometry';
import {
  addArrow,
  addShape,
  arrows,
  attachedTo,
  centre,
  connectorTool,
  dots,
  dragOn,
  pointerDown,
  pointerMove,
  pointerUp,
  selectedIds,
  setZoom,
  toolPressed,
  toScreen,
} from './shapeHelpers';
import { board, renderBoard } from './stickyHelpers';
import { pressKey, remote } from './textHelpers';

const RECT_A = { x: 0, y: 0, width: 160, height: 100 };
const RECT_B = { x: 400, y: 0, width: 160, height: 100 };
const RECT_C = { x: 0, y: 400, width: 160, height: 100 };
const TOLERANCE_PX = 6;

function handle(end: 'from' | 'to'): Element {
  const el = screen.queryAllByTestId('connector-handle').find((h) => h.getAttribute('data-end') === end);
  if (!el) throw new Error(`no ${end} handle`);
  return el;
}

describe('connector.ui Connector tool', () => {
  it('TC-18 hovering a shape with the Connector tool shows four dots at its side midpoints', () => {
    renderBoard();
    const a = addShape(RECT_A);
    pressKey('l');
    expect(toolPressed('Connector (L)')).toBe('true');
    expect(dots()).toHaveLength(0);
    pointerMove(connectorTool(), toScreen(centre(RECT_A)));
    expect(connectorTool().dataset.hoverId).toBe(a);
    const shown = dots();
    expect(shown.map((d) => d.side).sort()).toEqual(['bottom', 'left', 'right', 'top']);
    for (const d of shown) {
      expect({ x: d.x, y: d.y }).toEqual(toScreen(sideAnchor(RECT_A, d.side as 'top')));
      expect(d.highlighted).toBe(false);
    }
    // Off the shape: no dots.
    pointerMove(connectorTool(), toScreen({ x: 300, y: 300 }));
    expect(dots()).toHaveLength(0);
  });

  it("TC-19 drag from A over B highlights B's nearest dot; release creates an attached arrow, selected, tool back to Select", () => {
    renderBoard();
    const a = addShape(RECT_A);
    const b = addShape(RECT_B);
    pressKey('l');
    const layer = connectorTool();
    pointerDown(layer, toScreen(centre(RECT_A)));
    pointerMove(layer, toScreen({ x: 300, y: 50 }));
    expect(screen.getByTestId('connector-preview')).toBeTruthy();
    pointerMove(layer, toScreen(centre(RECT_B)));
    expect(layer.dataset.targetId).toBe(b);
    const lit = dots().filter((d) => d.highlighted);
    expect(lit).toHaveLength(1);
    expect(lit[0]!.side).toBe('left');
    expect({ x: lit[0]!.x, y: lit[0]!.y }).toEqual(toScreen(sideAnchor(RECT_B, 'left')));

    pointerUp(layer, toScreen(centre(RECT_B)));
    const all = arrows();
    expect(all).toHaveLength(1);
    expect(all[0]!.from).toMatchObject({ kind: 'attached', objectId: a });
    expect(all[0]!.to).toMatchObject({ kind: 'attached', objectId: b });
    expect(all[0]!.fromPoint).toEqual(sideAnchor(RECT_A, 'right'));
    expect(all[0]!.toPoint).toEqual(sideAnchor(RECT_B, 'left'));
    expect(selectedIds()).toEqual([all[0]!.id]);
    expect(toolPressed('Select (V)')).toBe('true');
    // Selected: a handle at each end.
    expect(screen.getAllByTestId('connector-handle')).toHaveLength(2);
  });

  it('TC-19 release on empty space leaves a free end; start on empty space fixes a free start', () => {
    renderBoard();
    const a = addShape(RECT_A);
    pressKey('l');
    dragOn(connectorTool(), toScreen(centre(RECT_A)), toScreen({ x: 400, y: 250 }));
    expect(arrows()[0]).toMatchObject({
      from: { kind: 'attached', objectId: a },
      to: { kind: 'free', x: 400, y: 250 },
    });

    pressKey('l');
    dragOn(connectorTool(), toScreen({ x: -300, y: 50 }), toScreen(centre(RECT_A)));
    const second = arrows().find((c) => c.from.kind === 'free')!;
    expect(second.from).toEqual({ kind: 'free', x: -300, y: 50 });
    expect(second.to).toMatchObject({ kind: 'attached', objectId: a });
    expect(second.toPoint).toEqual(sideAnchor(RECT_A, 'left'));
  });

  it('no accidental arrows: released on the start object or moved less than 8 units creates nothing and keeps the tool (negative)', () => {
    renderBoard();
    addShape(RECT_A);
    pressKey('l');
    // Starts and ends on A (moved well over 8 units).
    dragOn(connectorTool(), toScreen({ x: 20, y: 20 }), toScreen({ x: 140, y: 80 }));
    // Starts on empty space, 7 units.
    dragOn(connectorTool(), toScreen({ x: 300, y: 300 }), toScreen({ x: 307, y: 300 }));
    expect(arrows()).toHaveLength(0);
    expect(toolPressed('Connector (L)')).toBe('true');
  });

  it('an arrow to an object deleted by someone else mid-drag is still created, its end free where it was released', () => {
    renderBoard();
    const a = addShape(RECT_A);
    const b = addShape(RECT_B);
    pressKey('l');
    const layer = connectorTool();
    pointerDown(layer, toScreen(centre(RECT_A)));
    pointerMove(layer, toScreen(centre(RECT_B)));
    remote((d) => deleteObjects(d, [b]));
    pointerUp(layer, toScreen(centre(RECT_B)));
    expect(arrows()).toHaveLength(1);
    expect(arrows()[0]).toMatchObject({ from: { objectId: a }, to: { kind: 'free', ...centre(RECT_B) } });
  });
});

describe('connector.ui selecting and re-attaching', () => {
  it.each([0.5, 2])('TC-20 at zoom %s: a click 5 screen px from the line selects the arrow, 7 px does not', (zoom) => {
    renderBoard();
    setZoom(zoom, { x: -100, y: -200 });
    const id = addArrow({ kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 300, y: 0 });
    const onLine = toScreen({ x: 150, y: 0 });
    const near = { x: onLine.x, y: onLine.y + (TOLERANCE_PX - 1) };
    const far = { x: onLine.x, y: onLine.y + (TOLERANCE_PX + 1) };

    pointerDown(board(), far);
    pointerUp(board(), far);
    expect(selectedIds()).toEqual([]);

    pointerDown(board(), near);
    pointerUp(board(), near);
    expect(selectedIds()).toEqual([id]);

    // Far again: empty space, the selection is cleared.
    pointerDown(board(), far);
    pointerUp(board(), far);
    expect(selectedIds()).toEqual([]);
  });

  it('TC-20 a press near an arrow drawn over a shape selects the arrow; away from the line it selects the shape', () => {
    renderBoard();
    const a = addShape({ x: 0, y: -100, width: 300, height: 200 });
    const id = addArrow({ kind: 'free', x: 0, y: 0 }, { kind: 'free', x: 300, y: 0 });
    const shapeEl = screen.getAllByTestId('shape-object')[0]!;
    const near = toScreen({ x: 150, y: 3 });
    pointerDown(shapeEl, near);
    pointerUp(shapeEl, near);
    expect(selectedIds()).toEqual([id]);
    const away = toScreen({ x: 150, y: 60 });
    pointerDown(shapeEl, away);
    pointerUp(shapeEl, away);
    expect(selectedIds()).toEqual([a]);
  });

  it('TC-21 dragging the selected arrow end handle onto C re-attaches it; onto empty space frees it there', () => {
    renderBoard();
    const a = addShape(RECT_A);
    const b = addShape(RECT_B);
    const c = addShape(RECT_C);
    const id = addArrow(attachedTo(a), attachedTo(b));
    // Select the arrow by clicking near its line.
    const mid = toScreen({ x: 280, y: 50 });
    pointerDown(board(), mid);
    pointerUp(board(), mid);
    expect(selectedIds()).toEqual([id]);

    const end = toScreen(arrows()[0]!.toPoint);
    const overC = toScreen(centre(RECT_C));
    pointerDown(handle('to'), end);
    pointerMove(handle('to'), { x: (end.x + overC.x) / 2, y: (end.y + overC.y) / 2 });
    pointerMove(handle('to'), overC);
    // The target's dot the end will attach to is highlighted while dragging.
    const lit = dots().filter((d) => d.highlighted);
    expect(lit).toHaveLength(1);
    expect(lit[0]!.side).toBe('top');
    pointerUp(handle('to'), overC);
    expect(arrows()[0]!.to).toMatchObject({ kind: 'attached', objectId: c });
    expect(arrows()[0]!.toPoint).toEqual(sideAnchor(RECT_C, 'top'));
    expect(selectedIds()).toEqual([id]);

    const start = toScreen(arrows()[0]!.toPoint);
    const empty = toScreen({ x: 700, y: 600 });
    pointerDown(handle('to'), start);
    pointerMove(handle('to'), empty);
    pointerUp(handle('to'), empty);
    expect(arrows()[0]!.to).toEqual({ kind: 'free', x: 700, y: 600 });

    // Onto the object at the other end: rejected, snaps back.
    const onA = toScreen(centre(RECT_A));
    pointerDown(handle('to'), empty);
    pointerMove(handle('to'), onA);
    pointerUp(handle('to'), onA);
    expect(arrows()[0]!.to).toEqual({ kind: 'free', x: 700, y: 600 });
  });

  it('moving a connected shape redraws the arrow on its nearest side (follow), with no write to the arrow', () => {
    renderBoard();
    const a = addShape(RECT_A);
    const b = addShape(RECT_B);
    addArrow(attachedTo(a), attachedTo(b));
    const stored = arrows()[0]!;
    remote((d) => {
      const map = d.getMap<import('yjs').Map<unknown>>('objects').get(b)!;
      map.set('x', 0);
      map.set('y', -400);
    });
    const line = screen.getByTestId('connector-object');
    expect(arrows()[0]!.to).toEqual(stored.to);
    expect(Number(line.dataset.y1)).toBe(RECT_A.y);
    expect(Number(line.dataset.x1)).toBe(centre(RECT_A).x);
  });
});
