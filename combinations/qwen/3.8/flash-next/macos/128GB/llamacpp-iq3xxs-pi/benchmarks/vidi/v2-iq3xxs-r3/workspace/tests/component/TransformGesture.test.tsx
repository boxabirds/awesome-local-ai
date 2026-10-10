/**
 * TC-23 to TC-26 (story 7, sel.transform): the one gesture that changes where
 * objects are — press an object and the selection follows it; press a handle of
 * the selection's bounding box and every object inside the box scales.
 *
 * TC-23 and TC-24 go through the board the app renders, because what they are
 * about is the object under a pointer and the handles drawn on the box. TC-25 and
 * TC-26 are about what `useTransformGesture` promises its caller — refuse to write
 * when this client may not write, and announce a gesture as started and ended
 * exactly once — so those mount the hook itself in `GestureProbe`, which is also
 * the only way to set `canEdit` false without pretending a socket is down.
 *
 * Every board here is opened with its camera at the origin at zoom 1, so a point
 * in the viewport is the same numbers in the world, and a pointer delta of 40 px
 * is a move of 40 board units (the zooming half of that equation is TC-31).
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { useEffect, useReducer } from 'react';
import type { JSX } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { Doc } from 'yjs';
import type { Doc as YDoc } from 'yjs';

import { useSelection } from '../../src/client/board/useSelection';
import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { objectSnapshots } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX, HANDLE_SIZE_PX, STICKY_SIZE_WORLD } from '../../src/shared/config';
import { createTestbox } from '../fixtures/testbox';
import {
  addNote,
  centreOfNote,
  clickNote,
  drag,
  flushFrame,
  noteById,
  objectSizes,
  pointerEvent,
  press,
  readNote,
  releaseAt,
  renderStickyBoard,
  selectedIds,
  setCamera,
} from './helpers/board';

/** The board under test, with the camera parked where the numbers are simple. */
async function startBoard(doc: YDoc): Promise<void> {
  renderStickyBoard(doc);
  act(() => setCamera({ x: 0, y: 0, zoom: 1 }));
  await flushFrame();
}

/** A `testbox`: a second object type, so genericity is observed, not assumed. */
function addBox(doc: YDoc, rect: { x: number; y: number; width: number; height: number }): string {
  let id = '';
  act(() => {
    id = createTestbox(doc, rect);
  });
  return id;
}

afterEach(cleanup);

/** A press and release on a box's middle. */
function clickBox(doc: YDoc, id: string): void {
  const at = objectSizes(doc, id);
  const point = { x: at.x + at.width / 2, y: at.y + at.height / 2 };
  const target = document.querySelector(`[data-box-id="${id}"]`) as Element;
  press(target, point);
  releaseAt(target, point);
}

describe('moving a selection (TC-23)', () => {
  it('a press on an unselected object selects it alone and moves only it', async () => {
    const doc = new Doc();
    await startBoard(doc);
    const a = addNote(doc, { x: 100, y: 100 });
    const b = addNote(doc, { x: 600, y: 100 });
    clickNote(doc, a);
    expect(selectedIds()).toEqual([a]);
    const before = { a: readNote(doc, a)!, b: readNote(doc, b)! };

    drag(noteById(b), centreOfNote(doc, b), { x: 40, y: 20 });
    await flushFrame();

    // `b` was not selected when it was pressed, so pressing it *is* the click:
    // the selection is {b}, and only b follows the pointer.
    expect(selectedIds()).toEqual([b]);
    const after = { a: readNote(doc, a)!, b: readNote(doc, b)! };
    expect(after.a.x).toBe(before.a.x);
    expect(after.a.y).toBe(before.a.y);
    expect(after.b.x).toBeCloseTo(before.b.x + 40, 6);
    expect(after.b.y).toBeCloseTo(before.b.y + 20, 6);
  });

  it('one pixel under the threshold is a press; on it, a move', async () => {
    const doc = new Doc();
    await startBoard(doc);
    const b = addNote(doc, { x: 600, y: 100 });
    const before = readNote(doc, b)!;
    const at = centreOfNote(doc, b);

    // Under the threshold it is still a press: the pointer has not pulled the
    // object off the board, so nothing is written and nothing is restacked.
    press(noteById(b), at);
    pointerEvent('pointerMove', noteById(b), { x: at.x + DRAG_THRESHOLD_PX - 1, y: at.y });
    releaseAt(noteById(b), { x: at.x + DRAG_THRESHOLD_PX - 1, y: at.y });
    await flushFrame();
    expect(readNote(doc, b)!.x).toBe(before.x);
    expect(readNote(doc, b)!.z).toBe(before.z);

    // Exactly the threshold: the gesture has started, and the object is where
    // the pointer got to.
    press(noteById(b), at);
    pointerEvent('pointerMove', noteById(b), { x: at.x + DRAG_THRESHOLD_PX, y: at.y });
    await flushFrame();
    expect(readNote(doc, b)!.x).toBeCloseTo(before.x + DRAG_THRESHOLD_PX, 6);
    expect(selectedIds()).toEqual([b]);
    releaseAt(noteById(b), { x: at.x + DRAG_THRESHOLD_PX, y: at.y });
  });

  it('pressing an already-selected object moves the whole selection by the same amount', async () => {
    const doc = new Doc();
    await startBoard(doc);
    const a = addNote(doc, { x: 100, y: 100 });
    const b = addNote(doc, { x: 600, y: 100 });
    const other = addNote(doc, { x: 100, y: 600 });
    clickNote(doc, a);
    clickNote(doc, b, { shift: true });
    const before = { a: readNote(doc, a)!, b: readNote(doc, b)!, other: readNote(doc, other)! };

    drag(noteById(a), centreOfNote(doc, a), { x: 30, y: -25 });
    await flushFrame();

    const after = { a: readNote(doc, a)!, b: readNote(doc, b)!, other: readNote(doc, other)! };
    expect(after.a.x).toBeCloseTo(before.a.x + 30, 6);
    expect(after.a.y).toBeCloseTo(before.a.y - 25, 6);
    expect(after.b.x).toBeCloseTo(before.b.x + 30, 6);
    expect(after.b.y).toBeCloseTo(before.b.y - 25, 6);
    // One gesture, so one restacking: the moved objects end up above the one
    // that stayed behind, and the one that stayed behind is untouched.
    expect(after.other.z).toBe(before.other.z);
    expect(after.a.z).toBeGreaterThan(after.other.z);
    expect(after.b.z).toBeGreaterThan(after.other.z);
  });
});

describe('resizing the bounding box (TC-24)', () => {
  it('an edge handle changes one axis, and every handle says which one it is', async () => {
    const doc = new Doc();
    await startBoard(doc);
    const box = addBox(doc, { x: 100, y: 100, width: 200, height: 100 });
    clickBox(doc, box);

    // Eight handles, each saying which edge or corner it is, and drawn in screen
    // pixels so they stay grabbable however far away the board is zoomed.
    expect(screen.getAllByTestId(/^handle-/)).toHaveLength(8);
    const east = screen.getByRole('button', { name: 'Resize right' });
    expect(east.getAttribute('data-handle')).toBe('e');
    expect(screen.getByRole('button', { name: 'Resize top-left' }).getAttribute('data-handle')).toBe('nw');
    expect(east.style.width).toBe(`${HANDLE_SIZE_PX}px`);

    const rect = objectSizes(doc, box);
    // The east handle is on the box's right edge, vertically centred.
    drag(east, { x: rect.x + rect.width, y: rect.y + rect.height / 2 }, { x: 40, y: 10 });
    await flushFrame();

    // A box is not a note: this edge handle changes the width and nothing else,
    // and the left edge stays where it was.
    const wide = objectSizes(doc, box);
    expect(wide.x).toBe(100);
    expect(wide.y).toBe(100);
    expect(wide.width).toBeCloseTo(240, 6);
    expect(wide.height).toBeCloseTo(100, 6);
  });

  it('Shift keeps the ratio of a type that does not lock it itself', async () => {
    const doc = new Doc();
    await startBoard(doc);
    const box = addBox(doc, { x: 1000, y: 100, width: 200, height: 100 });
    clickBox(doc, box);
    const corner = screen.getByRole('button', { name: 'Resize bottom-right' });

    // The same handle and the same pull as above, but with Shift held.
    drag(corner, { x: 1200, y: 200 }, { x: 50, y: 0 }, { shiftKey: true });
    await flushFrame();

    const grown = objectSizes(doc, box);
    expect(grown.x).toBe(1000);
    expect(grown.y).toBe(100);
    expect(grown.width).toBeCloseTo(250, 6);
    expect(grown.height).toBeCloseTo(125, 6);
  });

  it('a sticky note keeps its square through the same handle', async () => {
    const doc = new Doc();
    await startBoard(doc);
    const note = addNote(doc, { x: 100, y: 400 });
    clickNote(doc, note);
    const handle = screen.getByRole('button', { name: 'Resize right' });

    drag(handle, { x: 300, y: 500 }, { x: 40, y: 0 });
    await flushFrame();

    // `aspectLocked` in the registry, not a branch about sticky notes in here.
    const grown = objectSizes(doc, note);
    expect(grown.width).toBeCloseTo(STICKY_SIZE_WORLD + 40, 6);
    expect(grown.height).toBeCloseTo(grown.width, 6);
  });
});

describe('what a gesture may not do (TC-25, TC-26)', () => {
  it('TC-25: a board this client may not write to is selected but never moved', async () => {
    const doc = new Doc();
    const starts: string[] = [];
    const ends: string[] = [];
    render(<GestureProbe doc={doc} canEdit={false} starts={starts} ends={ends} />);
    const a = addNote(doc, { x: 100, y: 100 });
    const before = readNote(doc, a)!;
    const at = { x: 200, y: 200 };

    // Selecting is not writing, so the press still selects…
    press(probeObject(a), at);
    releaseAt(probeObject(a), at);
    expect(probe().dataset.selectedCount).toBe('1');

    // …but dragging past the threshold changes nothing on the board.
    drag(probeObject(a), at, { x: 120, y: 90 });
    await flushFrame();
    expect(readNote(doc, a)!.x).toBe(before.x);
    expect(readNote(doc, a)!.y).toBe(before.y);
    // …and the board was never told a gesture had begun.
    expect(starts).toHaveLength(0);
    expect(ends).toHaveLength(0);
  });

  it('TC-26: one drag says started and ended once, and a cancelled drag keeps where it got to', async () => {
    const doc = new Doc();
    const starts: string[] = [];
    const ends: string[] = [];
    render(<GestureProbe doc={doc} canEdit starts={starts} ends={ends} />);
    const a = addNote(doc, { x: 100, y: 100 });
    const before = readNote(doc, a)!;
    const at = { x: 200, y: 200 };

    press(probeObject(a), at);
    pointerEvent('pointerMove', probeObject(a), { x: at.x + 20, y: at.y });
    await flushFrame();
    const halfWay = readNote(doc, a)!;
    expect(halfWay.x).toBeCloseTo(before.x + 20, 6);
    expect(probe().dataset.dragging).toBe('true');

    // The board takes the pointer back — a second finger, a system gesture, a
    // window that lost focus: what is on the board stays where the last frame
    // left it, and nothing after it is applied.
    pointerEvent('pointerCancel', probeObject(a), { x: at.x + 20, y: at.y });
    expect(probe().dataset.dragging).toBe('false');
    pointerEvent('pointerMove', probeObject(a), { x: at.x + 200, y: at.y });
    await flushFrame();
    expect(readNote(doc, a)!.x).toBeCloseTo(halfWay.x, 6);

    expect(starts).toEqual(['start']);
    expect(ends).toEqual(['end']);
  });
});

function probe(): HTMLElement {
  return screen.getByTestId('gesture-probe');
}

function probeObject(id: string): Element {
  const element = document.querySelector(`[data-probe-object="${id}"]`);
  if (!(element instanceof Element)) throw new Error(`no probe object ${id}`);
  return element;
}

/**
 * `useTransformGesture` with nothing around it but a selection and one element per
 * object, so what a gesture promises its caller can be watched directly: the
 * camera is fixed at the origin at zoom 1, so the numbers in the test are the
 * numbers on the board.
 */
function GestureProbe({
  doc,
  canEdit,
  starts,
  ends,
}: {
  readonly doc: YDoc;
  readonly canEdit: boolean;
  readonly starts: string[];
  readonly ends: string[];
}): JSX.Element {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const changed = (): void => tick();
    doc.on('update', changed);
    return () => doc.off('update', changed);
  }, [doc]);

  const snapshot = objectSnapshots(doc);
  const selection = useSelection(snapshot);
  const gesture = useTransformGesture({
    doc,
    camera: { x: 0, y: 0, zoom: 1 },
    selection,
    snapshot,
    canEdit,
    onGestureStart: () => starts.push('start'),
    onGestureEnd: () => ends.push('end'),
  });

  return (
    <div
      data-testid="gesture-probe"
      data-selected-count={selection.ids.size}
      data-dragging={gesture.dragging ? 'true' : 'false'}
    >
      {snapshot.map((object) => (
        <div
          key={object.id}
          data-probe-object={object.id}
          data-selected={selection.ids.has(object.id) ? 'true' : 'false'}
          style={{ position: 'absolute', left: `${object.x}px`, top: `${object.y}px` }}
          onPointerDown={(event) => gesture.onObjectPointerDown(event, object.id)}
        />
      ))}
    </div>
  );
}
