import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { useEffect, useState } from 'react';
import { snapshot, type ObjectSnapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import type { Camera } from '../../src/client/canvas/camera';
import { getObjectType } from '../../src/client/objects/registry';
import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { SelectionOverlay } from '../../src/client/board/SelectionOverlay';
import { createTestbox, registerTestbox, testboxSnapshot } from '../fixtures/testbox';
import {
  boardSurface,
  clickNote,
  dragOn,
  noteEl,
  renderBoard,
  seedSticky,
  selectedIds,
  shiftClickAt,
  stubViewportSize,
} from './boardHarness';

stubViewportSize();
registerTestbox();

/** Default view: screen pixels and board units are the same number. */
const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

/**
 * The generic pieces, rendered against the fixture type.
 *
 * The app only renders sticky notes (`snapshot()` returns those), so this is how
 * a second shape proves the gesture is generic: the same hook, the same overlay,
 * the same props, and a type that answers every question differently.
 */
function Harness(props: {
  doc: Y.Doc;
  canEdit?: boolean;
  onGestureStart?(): void;
  onGestureEnd?(): void;
}) {
  const { doc, canEdit = true, onGestureStart, onGestureEnd } = props;
  const [objects, setObjects] = useState<ObjectSnapshot[]>(() => testboxSnapshot(doc));
  useEffect(() => {
    const map = doc.getMap<Y.Map<unknown>>('objects');
    const changed = () => setObjects(testboxSnapshot(doc));
    map.observeDeep(changed);
    return () => map.unobserveDeep(changed);
  }, [doc]);

  const selection = useSelection(objects);
  const gesture = useTransformGesture({
    doc,
    camera: CAMERA,
    selection,
    snapshot: objects,
    canEdit,
    onGestureStart,
    onGestureEnd,
  });

  return (
    <div>
      <div className="world-layer">
        {objects.map((object) => {
          const Type = getObjectType(object.type);
          if (!Type) return null;
          return (
            <Type.Component
              key={object.id}
              doc={doc}
              snapshot={object}
              camera={CAMERA}
              selection={{
                selected: selection.has(object.id),
                editing: false,
                dragging: gesture.draggingIds.has(object.id),
              }}
              onEditChange={() => {}}
              onObjectPointerDown={gesture.onObjectPointerDown}
            />
          );
        })}
      </div>
      <SelectionOverlay
        ids={selection.ids}
        snapshot={objects}
        camera={CAMERA}
        onHandlePointerDown={gesture.onHandlePointerDown}
      />
    </div>
  );
}

function boxEl(container: HTMLElement, id: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-testbox-id="${id}"]`);
  if (!el) throw new Error(`test box ${id} is not rendered`);
  return el;
}

function rectOf(doc: Y.Doc, id: string) {
  const object = testboxSnapshot(doc).find((candidate) => candidate.id === id);
  if (!object) throw new Error(`test box ${id} is gone`);
  return { x: object.x, y: object.y, width: object.width, height: object.height };
}

/**
 * Where each note is, by id.
 *
 * Assertions below are written as *changes* from here, because `createSticky`
 * centres a note on the point it is given (story 2), so the stored coordinates
 * are not the ones a test hands it — and what a drag must do is move a note by
 * exactly the distance the pointer moved.
 */
function positions(doc: Y.Doc): Map<string, { x: number; y: number }> {
  return new Map(snapshot(doc).map((note) => [note.id, { x: note.x, y: note.y }]));
}

/** Rectangles come out of a scale, so they are compared with a tolerance. */
function expectRect(doc: Y.Doc, id: string, want: { x: number; y: number; width: number; height: number }) {
  const got = rectOf(doc, id);
  expect([got.x, got.y, got.width, got.height]).toEqual(
    [want.x, want.y, want.width, want.height].map((n) => expect.closeTo(n, 6)),
  );
}

describe('transform gesture on sticky notes (sel.transform)', () => {
  it('TC-23 dragging an unselected note selects just it and moves only it', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const b = seedSticky(doc, { x: 400, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    expect(selectedIds(container)).toEqual([a]);
    const before = positions(doc);

    // Boundary: one pixel under the threshold is still a click, so nothing is
    // written and the note does not budge.
    dragOn(noteEl(container, b), { x: 20, y: 20 }, { x: 20 + DRAG_THRESHOLD_PX - 1, y: 20 });
    let now = positions(doc);
    expect(now.get(b)).toEqual(before.get(b));
    expect(selectedIds(container)).toEqual([b]);

    // Exactly the threshold, horizontally: the gesture starts, and the note moves
    // by that many board units (the zoom is 1).
    dragOn(noteEl(container, b), { x: 20, y: 20 }, { x: 20 + DRAG_THRESHOLD_PX, y: 20 });
    now = positions(doc);
    expect(now.get(b)!.x).toBeCloseTo(before.get(b)!.x + DRAG_THRESHOLD_PX, 6);
    expect(now.get(b)!.y).toBeCloseTo(before.get(b)!.y, 6);
    // The other note stayed where it was: only what is selected moves.
    expect(now.get(a)).toEqual(before.get(a));
  });

  it('a group drag moves every selected note and nothing else', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const b = seedSticky(doc, { x: 300, y: 0 });
    const away = seedSticky(doc, { x: 0, y: 900 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    shiftClickAt(noteEl(container, b));
    const before = positions(doc);
    dragOn(noteEl(container, a), { x: 20, y: 20 }, { x: 120, y: 70 });

    const now = positions(doc);
    for (const id of [a, b]) {
      expect(now.get(id)!.x).toBeCloseTo(before.get(id)!.x + 100, 6);
      expect(now.get(id)!.y).toBeCloseTo(before.get(id)!.y + 50, 6);
    }
    // The note that was not selected did not move.
    expect(now.get(away)).toEqual(before.get(away));
  });

  it('a resize that lets go over the board keeps the selection it is resizing', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const b = seedSticky(doc, { x: 400, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    shiftClickAt(noteEl(container, b));

    const handle = screen.getByRole('button', { name: 'Resize right' });
    fireEvent.pointerDown(handle, { clientX: 300, clientY: 100, button: 0, pointerId: 9 });
    fireEvent.pointerMove(window, { clientX: 380, clientY: 100, pointerId: 9 });
    // A browser releases over whatever is under the pointer, here the board
    // itself. Releasing over the board is not a click on the board: the press
    // began on a handle, and clearing here would delete the selection mid-gesture.
    fireEvent.pointerUp(boardSurface(container), { clientX: 380, clientY: 100, pointerId: 9 });

    expect(selectedIds(container)).toEqual([a, b].sort());
    // And it really did resize.
    expect(snapshot(doc)[0].width).toBeGreaterThan(200);
  });

  it('the notes being moved are lifted above the others', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const under = seedSticky(doc, { x: 20, y: 20 });
    const { container } = renderBoard(doc);
    const zOf = (id: string) => snapshot(doc).find((note) => note.id === id)!.z;
    expect(zOf(a)).toBeLessThan(zOf(under));

    dragOn(noteEl(container, a), { x: 10, y: 10 }, { x: 80, y: 10 });
    expect(zOf(a)).toBeGreaterThan(zOf(under));
  });

  it('a cancelled drag keeps the last position the user saw', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);

    const before = positions(doc).get(a)!;
    dragOn(noteEl(container, a), { x: 20, y: 20 }, { x: 90, y: 20 }, { hold: true });
    fireEvent.pointerCancel(noteEl(container, a), { pointerId: 3 });

    // Nothing rewinds to where it started, and nothing moves after.
    expect(snapshot(doc)[0].x).toBeCloseTo(before.x + 70, 6);
    fireEvent.pointerMove(noteEl(container, a), { clientX: 400, clientY: 20, pointerId: 3 });
    expect(snapshot(doc)[0].x).toBeCloseTo(before.x + 70, 6);
  });
});

describe('transform gesture on a second object type (sel.transform, sel.all_types)', () => {
  /** Two boxes 100x100 and 100x200, side by side: a 300 x 200 bounding box. */
  function twoBoxes() {
    const doc = new Y.Doc();
    createTestbox(doc, { id: 'one', x: 0, y: 0, width: 100, height: 100 });
    createTestbox(doc, { id: 'two', x: 200, y: 0, width: 100, height: 200 });
    const { container } = render(<Harness doc={doc} />);
    clickNote(boxEl(container, 'one'));
    shiftClickAt(boxEl(container, 'two'));
    expect(selectedIds(container)).toEqual(['one', 'two']);
    return { doc, container };
  }

  it('the selection offers eight handles with names', () => {
    twoBoxes();
    for (const name of [
      'Resize top-left',
      'Resize top',
      'Resize top-right',
      'Resize right',
      'Resize bottom-right',
      'Resize bottom',
      'Resize bottom-left',
      'Resize left',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('TC-24 an edge handle changes one axis only', () => {
    const { doc, container } = twoBoxes();
    const handle = screen.getByRole('button', { name: 'Resize right' });

    // Pulling the box's right edge 60 units out is a 1.2 x 1 stretch: widths
    // grow, heights do not, and the gap between the boxes grows with them.
    dragOn(handle, { x: 300, y: 100 }, { x: 360, y: 100 });

    expectRect(doc, 'one', { x: 0, y: 0, width: 120, height: 100 });
    expectRect(doc, 'two', { x: 240, y: 0, width: 120, height: 200 });
    expect(container.querySelectorAll('[data-resize-handle]').length).toBe(8);
  });

  it('TC-24 Shift keeps the proportions', () => {
    const { doc } = twoBoxes();
    const handle = screen.getByRole('button', { name: 'Resize right' });

    dragOn(handle, { x: 300, y: 100 }, { x: 360, y: 100 }, { shiftKey: true });

    // The same 1.2 on both axes, so each box keeps the shape it had. The locked
    // side handle keeps the left edge where it is and grows the height about the
    // middle of the group, which is what makes the picture read as one zoom.
    expectRect(doc, 'one', { x: 0, y: -20, width: 120, height: 120 });
    expectRect(doc, 'two', { x: 240, y: -20, width: 120, height: 240 });
  });

  it('a corner handle moves the opposite corner on both axes', () => {
    const { doc } = twoBoxes();
    const handle = screen.getByRole('button', { name: 'Resize bottom-right' });

    dragOn(handle, { x: 300, y: 200 }, { x: 450, y: 300 });

    expectRect(doc, 'one', { x: 0, y: 0, width: 150, height: 150 });
    expectRect(doc, 'two', { x: 300, y: 0, width: 150, height: 300 });
  });

  it('a resize stops at the minimum its own type allows', () => {
    const doc = new Y.Doc();
    createTestbox(doc, { id: 'small', x: 0, y: 0, width: 20, height: 20 });
    const { container } = render(<Harness doc={doc} />);
    clickNote(boxEl(container, 'small'));
    const handle = screen.getByRole('button', { name: 'Resize right' });

    // This type's minimum is 10 (a sticky note's is 50): pushing the edge far
    // inside stops there instead of collapsing or flipping the box.
    dragOn(handle, { x: 20, y: 10 }, { x: -500, y: 10 });
    expectRect(doc, 'small', { x: 0, y: 0, width: 10, height: 20 });
  });

  it('TC-26 one start and one end per drag, whatever the number of frames', () => {
    const doc = new Y.Doc();
    createTestbox(doc, { id: 'one', x: 0, y: 0, width: 100, height: 100 });
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const { container } = render(
      <Harness doc={doc} onGestureStart={onStart} onGestureEnd={onEnd} />,
    );
    const el = boxEl(container, 'one');

    // A click is not a gesture: an undo group for it would be wrong.
    dragOn(el, { x: 10, y: 10 }, { x: 10, y: 10 });
    expect(onStart).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();

    dragOn(el, { x: 10, y: 10 }, { x: 60, y: 10 });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('TC-26 a cancelled gesture reports its end exactly once', () => {
    const doc = new Y.Doc();
    createTestbox(doc, { id: 'one', x: 0, y: 0, width: 100, height: 100 });
    const onStart = vi.fn();
    const onEnd = vi.fn();
    const { container } = render(
      <Harness doc={doc} onGestureStart={onStart} onGestureEnd={onEnd} />,
    );
    const el = boxEl(container, 'one');

    dragOn(el, { x: 10, y: 10 }, { x: 60, y: 10 }, { hold: true });
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onEnd).not.toHaveBeenCalled();

    fireEvent.pointerCancel(el, { pointerId: 3 });
    expect(onEnd).toHaveBeenCalledTimes(1);
    // What the pointer last showed is what was written.
    expect(rectOf(doc, 'one').x).toBeCloseTo(50, 6);

    fireEvent.pointerUp(el, { clientX: 60, clientY: 10, pointerId: 3 });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('TC-25 on a read-only board nothing is written and no gesture starts', () => {
    const doc = new Y.Doc();
    createTestbox(doc, { id: 'one', x: 0, y: 0, width: 100, height: 100 });
    const onStart = vi.fn();
    const { container } = render(
      <Harness doc={doc} canEdit={false} onGestureStart={onStart} />,
    );
    const el = boxEl(container, 'one');

    dragOn(el, { x: 10, y: 10 }, { x: 200, y: 200 });
    expectRect(doc, 'one', { x: 0, y: 0, width: 100, height: 100 });
    expect(onStart).not.toHaveBeenCalled();
    // Looking and selecting still work on a read-only board.
    expect(selectedIds(container)).toEqual(['one']);

    const handle = screen.getByRole('button', { name: 'Resize right' });
    dragOn(handle, { x: 100, y: 50 }, { x: 300, y: 50 });
    expectRect(doc, 'one', { x: 0, y: 0, width: 100, height: 100 });
  });

  it('an object deleted by somebody else mid-drag is skipped, not fatal', () => {
    const doc = new Y.Doc();
    createTestbox(doc, { id: 'one', x: 0, y: 0, width: 100, height: 100 });
    createTestbox(doc, { id: 'two', x: 200, y: 0, width: 100, height: 100 });
    const { container } = render(<Harness doc={doc} />);
    clickNote(boxEl(container, 'one'));
    shiftClickAt(boxEl(container, 'two'));

    dragOn(boxEl(container, 'one'), { x: 10, y: 10 }, { x: 60, y: 10 }, { hold: true });
    act(() => {
      doc.getMap('objects').delete('two');
    });
    fireEvent.pointerMove(container, { clientX: 110, clientY: 10, pointerId: 3 });
    fireEvent.pointerUp(container, { clientX: 110, clientY: 10, pointerId: 3 });

    expect(rectOf(doc, 'one').x).toBeCloseTo(100, 6);
    expect(testboxSnapshot(doc).map((object) => object.id)).toEqual(['one']);
  });
});
