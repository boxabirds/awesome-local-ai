// Story 7 `sel.transform` component cases (TC-23 to TC-26): group move, group
// resize by handle, the edit lock, and the gesture start/end contract.
//
// Two levels: the real board shell (selection, handles, registry rendering) and a
// harness around `useTransformGesture` for the two callbacks the shell only forwards
// to story 8.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, screen, cleanup } from '@testing-library/react';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import BoardApp from '../../src/client/board/BoardApp.tsx';
import { useTransformGesture } from '../../src/client/board/useTransformGesture.ts';
import { useSelection } from '../../src/client/board/useSelection.ts';
import {
  bringToFront,
  createSticky,
  deleteObject,
  deleteObjects,
  initDoc,
  objectBounds,
  objectSnapshots,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model.ts';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config.ts';
import { createFixedBox, createTestBox, TESTFIXED_TYPE } from '../fixtures/testbox.tsx';

/**
 * jsdom's PointerEvent has no clientX/clientY, so gestures are driven with MouseEvents
 * named pointerdown/pointermove/pointerup — the events the board actually listens for.
 * `Window` because the board itself attaches the move/up listeners to the window.
 */
function firePointer(
  el: Element | Window,
  type: string,
  x: number,
  y: number,
  opts: { shift?: boolean } = {},
) {
  act(() => {
    el.dispatchEvent(
      new MouseEvent(type, {
        clientX: x,
        clientY: y,
        shiftKey: !!opts.shift,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}
function flush() {
  act(() => {
    vi.advanceTimersByTime(48);
  });
}

let doc: Y.Doc;
const ids: Record<string, string> = {};

const obj = (id: string) => objectSnapshots(doc).find((o) => o.id === id)!;
/** Geometry as the board sees it (a legacy note has no stored size of its own). */
const bounds = (id: string) => objectBounds(obj(id));
const el = (id: string) => document.querySelector(`[data-note-id="${id}"]`) as HTMLElement;
const boxEl = (id: string) => document.querySelector(`[data-object-id="${id}"]`) as HTMLElement;
const handle = (label: string) => screen.getByLabelText(`Resize ${label}`);

function clickOn(target: Element, x = 20, y = 20) {
  firePointer(target, 'pointerdown', x, y);
  firePointer(target, 'pointerup', x, y);
}
function shiftClickOn(target: Element, x = 20, y = 20) {
  firePointer(target, 'pointerdown', x, y, { shift: true });
  firePointer(target, 'pointerup', x, y);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('story 7 sel.transform group move (TC-23)', () => {
  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    ids.a = createSticky(doc, { x: 300, y: 300 });
    ids.b = createSticky(doc, { x: 700, y: 300 });
    ids.c = createSticky(doc, { x: 1100, y: 300 });
    render(<BoardApp doc={doc} />);
  });

  it('TC-23 dragging an unselected object selects it alone and moves only it', () => {
    clickOn(el(ids.a)); // {a}
    expect(el(ids.a).getAttribute('data-selected')).toBe('true');
    // Drag b (not selected) while a stays where it is.
    firePointer(el(ids.b), 'pointerdown', 20, 20);
    firePointer(window, 'pointermove', 120, 20);
    flush();
    firePointer(window, 'pointerup', 120, 20);
    flush();
    expect(el(ids.b).getAttribute('data-selected')).toBe('true');
    expect(el(ids.a).getAttribute('data-selected')).toBe('false');
    // b started 400 right of a and moved 100; a did not move.
    expect(obj(ids.b).x).toBeCloseTo(obj(ids.a).x + 500, 6);
    expect(obj(ids.c).x).toBe(1000); // never selected, never moved
  });

  it('TC-23 the dragged selection is raised above the objects it does not contain', () => {
    act(() => {
      bringToFront(doc, ids.a); // a is on top of everything
    });
    flush();
    shiftClickOn(el(ids.b)); // selection {a, b}
    firePointer(el(ids.b), 'pointerdown', 20, 20);
    firePointer(window, 'pointermove', 60, 20);
    flush();
    firePointer(window, 'pointerup', 60, 20);
    flush();
    expect(obj(ids.b).z).toBeGreaterThan(obj(ids.a).z);
  });

  it('TC-23 boundary: 1 px under the threshold writes nothing, exactly at it moves the group', () => {
    const startX = obj(ids.a).x;
    clickOn(el(ids.a));
    shiftClickOn(el(ids.b));
    // Just under the threshold: a click, not a drag.
    firePointer(el(ids.a), 'pointerdown', 300, 300);
    firePointer(window, 'pointermove', 300 + DRAG_THRESHOLD_PX - 1, 300);
    flush();
    firePointer(window, 'pointerup', 300 + DRAG_THRESHOLD_PX - 1, 300);
    flush();
    expect(obj(ids.a).x).toBe(startX);
    expect(obj(ids.b).x).toBe(obj(ids.a).x + 400);

    // Exactly at the threshold: the gesture starts and both objects move.
    firePointer(el(ids.a), 'pointerdown', 300, 300);
    firePointer(window, 'pointermove', 300 + DRAG_THRESHOLD_PX, 300);
    flush();
    firePointer(window, 'pointerup', 300 + DRAG_THRESHOLD_PX, 300);
    flush();
    expect(obj(ids.a).x).toBeCloseTo(startX + DRAG_THRESHOLD_PX, 6);
    expect(obj(ids.b).x).toBeCloseTo(startX + 400 + DRAG_THRESHOLD_PX, 6);
    // The one that was never selected never moved.
    expect(obj(ids.c).x).toBe(startX + 800);
  });

  it('TC-23 one gesture moves every selected object by the same world delta', () => {
    clickOn(el(ids.a));
    shiftClickOn(el(ids.b));
    shiftClickOn(el(ids.c));
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('3 selected');
    const before = [obj(ids.a), obj(ids.b), obj(ids.c)].map((o) => ({ x: o.x, y: o.y }));
    firePointer(el(ids.a), 'pointerdown', 10, 10);
    firePointer(window, 'pointermove', 90, 45);
    flush();
    firePointer(window, 'pointerup', 90, 45);
    flush();
    const after = [obj(ids.a), obj(ids.b), obj(ids.c)].map((o) => ({ x: o.x, y: o.y }));
    after.forEach((p, i) => {
      expect(p.x).toBeCloseTo(before[i]!.x + 80, 6);
      expect(p.y).toBeCloseTo(before[i]!.y + 35, 6);
    });
  });

  it('TC-25 a board that failed to load selects but never moves', () => {
    cleanup();
    doc = new Y.Doc();
    initDoc(doc);
    ids.a = createSticky(doc, { x: 300, y: 300 });
    ids.b = createSticky(doc, { x: 700, y: 300 });
    const before = objectSnapshots(doc).map((o) => ({ x: o.x, y: o.y, z: o.z }));
    let updates = 0;
    doc.on('update', () => {
      updates += 1;
    });
    render(<BoardApp doc={doc} connection="load_failed" />);
    clickOn(el(ids.a));
    shiftClickOn(el(ids.b));
    expect(el(ids.b).getAttribute('data-selected')).toBe('true');
    firePointer(el(ids.a), 'pointerdown', 20, 20);
    firePointer(window, 'pointermove', 220, 20);
    flush();
    firePointer(window, 'pointerup', 220, 20);
    flush();
    expect(objectSnapshots(doc).map((o) => ({ x: o.x, y: o.y, z: o.z }))).toEqual(before);
    expect(updates).toBe(0);
  });
});

describe('story 7 sel.transform resize handles (TC-24)', () => {
  beforeEach(() => {
    doc = new Y.Doc();
    initDoc(doc);
    ids.a = createSticky(doc, { x: 300, y: 300 });
    ids.box = createTestBox(doc, 400, 100, 200, 120);
    render(<BoardApp doc={doc} />);
  });

  it('TC-24 the eight handles are named by position, not by direction', () => {
    clickOn(boxEl(ids.box));
    for (const label of [
      'top-left',
      'top',
      'top-right',
      'right',
      'bottom-right',
      'bottom',
      'bottom-left',
      'left',
    ]) {
      expect(handle(label)).toBeInTheDocument();
    }
    expect(screen.getAllByTestId('resize-handle')).toHaveLength(8);
    // A sticky note is square by nature; a testbox is free-form; both resize.
    expect(screen.getByTestId('selection-box')).toBeInTheDocument();
  });

  it('TC-24 a sticky note selected with a testbox is resized together', () => {
    clickOn(boxEl(ids.box));
    shiftClickOn(el(ids.a));
    expect(screen.getByTestId('selection-bar')).toHaveTextContent('2 selected');
    const boxBefore = bounds(ids.box);
    const noteBefore = bounds(ids.a);
    // The selection box spans x 200..600, y 100..400 (400 x 300); dragging its right
    // edge 100 right scales the whole selection by 1.25.
    firePointer(handle('right'), 'pointerdown', 600, 250);
    firePointer(window, 'pointermove', 700, 250);
    flush();
    firePointer(window, 'pointerup', 700, 250);
    flush();
    // Sticky notes keep their shape; the free-form box does not. Both got wider.
    const noteAfter = bounds(ids.a);
    const boxAfter = bounds(ids.box);
    // Both grew by the same factor, the west edge of the selection stayed put...
    expect(noteAfter.width / noteBefore.width).toBeCloseTo(1.25, 4);
    expect(boxAfter.width / boxBefore.width).toBeCloseTo(1.25, 4);
    expect(noteAfter.x).toBeCloseTo(200, 6);
    // ...a sticky note is still square, and the shape rule of the group comes from
    // the objects in it: one aspect-locked type locks the box, so the free-form box
    // scales evenly too (on its own it is free — see the edge-handle cases).
    expect(noteAfter.width).toBeCloseTo(noteAfter.height, 3);
    expect(boxAfter.width / boxAfter.height).toBeCloseTo(
      boxBefore.width / boxBefore.height,
      4,
    );
    // ...and the space between them scaled with everything else: they touched
    // before and still touch.
    expect(noteAfter.x + noteAfter.width).toBeCloseTo(boxAfter.x, 3);
  });

  it('TC-24 an edge handle of a free-form type changes one axis only', () => {
    clickOn(boxEl(ids.box));
    const before = bounds(ids.box);
    expect(before.width).toBe(200);
    expect(before.height).toBe(120);
    // Left edge of the box is at x=400, mid-height y=160; drag it 22 left.
    firePointer(handle('left'), 'pointerdown', 400, 160);
    firePointer(window, 'pointermove', 378, 160);
    flush();
    firePointer(window, 'pointerup', 378, 160);
    flush();
    const after = obj(ids.box);
    expect(after.width).toBeCloseTo(before.width + 22, 3);
    expect(after.x).toBeCloseTo(before.x - 22, 3);
    expect(after.height).toBeCloseTo(before.height, 6); // width only
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('TC-24 Shift asks a free-form type to keep its proportions', () => {
    clickOn(boxEl(ids.box));
    const before = bounds(ids.box);
    // Shift is held for the whole drag: the free-form type is asked for its ratio.
    firePointer(handle('left'), 'pointerdown', 400, 160, { shift: true });
    firePointer(window, 'pointermove', 389, 160, { shift: true });
    flush();
    firePointer(window, 'pointermove', 378, 160, { shift: true });
    flush();
    firePointer(window, 'pointerup', 378, 160, { shift: true });
    flush();
    const after = bounds(ids.box);
    expect(after.width).toBeCloseTo(before.width + 22, 3);
    expect(after.height / after.width).toBeCloseTo(before.height / before.width, 4);
    // Without Shift the same drag changes the width only.
    firePointer(handle('left'), 'pointerdown', 378, 160);
    firePointer(window, 'pointermove', 358, 160);
    flush();
    firePointer(window, 'pointerup', 358, 160);
    flush();
    const plain = bounds(ids.box);
    expect(plain.width).toBeCloseTo(after.width + 20, 3);
    expect(plain.height).toBeCloseTo(after.height, 6);
  });

  it('TC-24 shrinking stops at the type minimum', () => {
    clickOn(boxEl(ids.box));
    const before = bounds(ids.box);
    // Drag the left edge 400 to the right: the box would turn inside out.
    firePointer(handle('left'), 'pointerdown', 400, 160);
    firePointer(window, 'pointermove', 800, 160);
    flush();
    firePointer(window, 'pointerup', 800, 160);
    flush();
    const after = bounds(ids.box);
    expect(after.width).toBeCloseTo(10, 6); // the testbox's own minSize
    expect(after.height).toBeCloseTo(before.height, 6);
    expect(after.x).toBeCloseTo(before.x + before.width - 10, 6);
  });

  it('TC-24 handles are hidden while the text of a selected object is edited', () => {
    clickOn(el(ids.a));
    expect(screen.getAllByTestId('resize-handle')).toHaveLength(8);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    flush();
    expect(screen.getByTestId('sticky-text-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('selection-overlay')).not.toBeInTheDocument();
  });

  it('TC-24 a type registered as not resizable gets an outline and no handles', () => {
    let fixed = '';
    act(() => {
      fixed = createFixedBox(doc, 100, 600, 200, 120);
    });
    flush();
    clickOn(boxEl(fixed));
    expect(obj(fixed).type).toBe(TESTFIXED_TYPE);
    expect(boxEl(fixed).getAttribute('data-selected')).toBe('true');
    expect(screen.queryAllByTestId('resize-handle')).toHaveLength(0);
    expect(screen.queryByTestId('selection-box')).not.toBeInTheDocument();
    // ...but it is still part of the selection and moves with it.
    clickOn(boxEl(ids.box));
    shiftClickOn(boxEl(fixed));
    firePointer(boxEl(ids.box), 'pointerdown', 500, 160);
    firePointer(window, 'pointermove', 550, 160);
    flush();
    firePointer(window, 'pointerup', 550, 160);
    flush();
    expect(obj(fixed).x).toBeCloseTo(100 + 50, 6);
  });

  it('resizing a selection past the document maximum stops at the maximum', () => {
    clickOn(boxEl(ids.box));
    firePointer(handle('right'), 'pointerdown', 600, 160);
    firePointer(window, 'pointermove', 60000, 160);
    flush();
    firePointer(window, 'pointerup', 60000, 160);
    flush();
    const after = bounds(ids.box);
    expect(after.width).toBeLessThanOrEqual(20000);
    expect(after.width).toBeGreaterThan(19000);
  });
});

describe('story 7 sel.transform error paths (TC-25, TC-26)', () => {
  it('TC-25 the edit lock also gates the resize handles', () => {
    doc = new Y.Doc();
    initDoc(doc);
    ids.box = createTestBox(doc, 400, 100, 200, 120);
    const before = bounds(ids.box);
    render(<BoardApp doc={doc} connection="load_failed" />);
    clickOn(boxEl(ids.box));
    expect(screen.getAllByTestId('resize-handle')).toHaveLength(8);
    firePointer(handle('right'), 'pointerdown', 600, 160);
    firePointer(window, 'pointermove', 900, 160);
    flush();
    firePointer(window, 'pointerup', 900, 160);
    flush();
    expect(objectBounds(obj(ids.box))).toEqual(before);
  });

  it('TC-25 objects the gesture holds cannot be deleted from under it without stopping', () => {
    doc = new Y.Doc();
    initDoc(doc);
    ids.a = createSticky(doc, { x: 300, y: 300 });
    ids.b = createSticky(doc, { x: 700, y: 300 });
    render(<BoardApp doc={doc} />);
    clickOn(el(ids.a));
    shiftClickOn(el(ids.b));
    firePointer(el(ids.a), 'pointerdown', 20, 20);
    firePointer(window, 'pointermove', 80, 20);
    flush();
    // A colleague deletes the whole selection mid-drag.
    act(() => {
      deleteObjects(doc, [ids.a, ids.b]);
    });
    flush();
    firePointer(window, 'pointermove', 120, 20);
    flush();
    firePointer(window, 'pointerup', 120, 20);
    flush();
    // Nothing came back: the deleted objects are not resurrected by the drag.
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('selection-bar')).not.toBeInTheDocument();
  });

  it('TC-26 onGestureStart and onGestureEnd each fire once per drag', () => {
    const calls: string[] = [];
    doc = new Y.Doc();
    initDoc(doc);
    ids.a = createSticky(doc, { x: 300, y: 300 });
    ids.b = createSticky(doc, { x: 700, y: 300 });
    render(
      <Harness doc={doc} canEdit onStart={() => calls.push('start')} onEnd={() => calls.push('end')} />,
    );
    const one = harnessEl(ids.a);
    const two = harnessEl(ids.b);
    clickOn(one);
    shiftClickOn(two);
    firePointer(one, 'pointerdown', 20, 20);
    firePointer(window, 'pointermove', 60, 20);
    firePointer(window, 'pointermove', 90, 20);
    flush();
    firePointer(window, 'pointerup', 90, 20);
    flush();
    expect(calls).toEqual(['start', 'end']);
    expect(obj(ids.a).x).toBeCloseTo(200 + 70, 6);
    expect(obj(ids.b).x).toBeCloseTo(600 + 70, 6);
  });

  it('TC-26 a click fires neither callback', () => {
    const calls: string[] = [];
    doc = new Y.Doc();
    initDoc(doc);
    ids.a = createSticky(doc, { x: 300, y: 300 });
    render(
      <Harness doc={doc} canEdit onStart={() => calls.push('start')} onEnd={() => calls.push('end')} />,
    );
    clickOn(harnessEl(ids.a));
    flush();
    expect(calls).toEqual([]);
    expect(harnessEl(ids.a).getAttribute('data-selected')).toBe('true');
  });

  it('TC-26 pointercancel mid-drag keeps the last applied positions', () => {
    const calls: string[] = [];
    doc = new Y.Doc();
    initDoc(doc);
    ids.a = createSticky(doc, { x: 300, y: 300 });
    ids.b = createSticky(doc, { x: 700, y: 300 });
    render(
      <Harness doc={doc} canEdit onStart={() => calls.push('start')} onEnd={() => calls.push('end')} />,
    );
    const one = harnessEl(ids.a);
    const two = harnessEl(ids.b);
    clickOn(one);
    shiftClickOn(two);
    const beforeA = obj(ids.a).x;
    firePointer(one, 'pointerdown', 20, 20);
    firePointer(window, 'pointermove', 60, 20);
    flush();
    firePointer(window, 'pointermove', 75, 20); // pending, not yet written
    firePointer(window, 'pointercancel', 75, 20);
    flush();
    expect(calls).toEqual(['start', 'end']);
    // The pointer's last position is what stayed, not the last flushed frame.
    expect(obj(ids.a).x).toBeCloseTo(beforeA + 55, 6);
    expect(obj(ids.b).x).toBeCloseTo(600 + 55, 6);
  });

  it('TC-26 unmounting mid-drag leaves the document as the last write left it', () => {
    doc = new Y.Doc();
    initDoc(doc);
    ids.a = createSticky(doc, { x: 300, y: 300 });
    const view = render(
      <Harness doc={doc} canEdit onStart={() => {}} onEnd={() => {}} />,
    );
    const one = harnessEl(ids.a);
    clickOn(one);
    firePointer(one, 'pointerdown', 20, 20);
    firePointer(window, 'pointermove', 60, 20);
    flush();
    view.unmount();
    expect(obj(ids.a).x).toBeCloseTo(200 + 40, 6);
  });

  it('TC-26 a selection that loses a member mid-drag moves the rest', () => {
    doc = new Y.Doc();
    initDoc(doc);
    ids.a = createSticky(doc, { x: 300, y: 300 });
    ids.b = createSticky(doc, { x: 700, y: 300 });
    const calls: string[] = [];
    render(
      <Harness doc={doc} canEdit onStart={() => calls.push('start')} onEnd={() => calls.push('end')} />,
    );
    const one = harnessEl(ids.a);
    const two = harnessEl(ids.b);
    clickOn(one);
    shiftClickOn(two);
    firePointer(one, 'pointerdown', 20, 20);
    firePointer(window, 'pointermove', 60, 20);
    flush();
    act(() => {
      deleteObject(doc, ids.b); // a colleague deletes one of the two
    });
    firePointer(window, 'pointermove', 100, 20);
    flush();
    firePointer(window, 'pointerup', 100, 20);
    flush();
    expect(calls).toEqual(['start', 'end']);
    expect(obj(ids.a).x).toBeCloseTo(200 + 80, 6);
    expect(snapshot(doc)).toHaveLength(1);
  });
});

/**
 * A minimal host for `useTransformGesture`, so the two callbacks the shell only
 * forwards to story 8 can be counted, and so the gesture can be tested without the
 * rest of the board (camera, toolbars, overlay) in the way.
 */
function Harness(props: {
  doc: Y.Doc;
  canEdit: boolean;
  onStart(): void;
  onEnd(): void;
}) {
  const [objects, setObjects] = useState<readonly ObjectSnapshot[]>(() =>
    objectSnapshots(props.doc),
  );
  useEffect(() => {
    const map = props.doc.getMap<Y.Map<unknown>>('objects');
    const handler = () => setObjects(objectSnapshots(props.doc));
    map.observeDeep(handler);
    return () => {
      map.unobserveDeep(handler);
    };
  }, [props.doc]);

  const selection = useSelection(objects);
  const gesture = useTransformGesture({
    doc: props.doc,
    camera: { x: 0, y: 0, zoom: 1 },
    selection,
    snapshot: objects,
    canEdit: props.canEdit,
    onGestureStart: props.onStart,
    onGestureEnd: props.onEnd,
  });

  return (
    <div data-testid="harness">
      {objects.map((o) => {
        const r = objectBounds(o);
        return (
          <div
            key={o.id}
            data-harness-id={o.id}
            data-selected={selection.ids.has(o.id) ? 'true' : 'false'}
            onPointerDown={(e) => gesture.onObjectPointerDown(e, o.id)}
            style={{
              position: 'absolute',
              left: r.x,
              top: r.y,
              width: r.width,
              height: r.height,
            }}
          />
        );
      })}
    </div>
  );
}

function harnessEl(id: string) {
  return document.querySelector(`[data-harness-id="${id}"]`) as HTMLElement;
}
