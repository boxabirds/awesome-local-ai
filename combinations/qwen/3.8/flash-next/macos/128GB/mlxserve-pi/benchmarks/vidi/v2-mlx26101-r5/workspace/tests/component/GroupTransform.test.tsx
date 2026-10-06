/**
 * Component tests for the one gesture that moves objects (design capability `sel.transform`, TC-23
 * to TC-26): press something and drag it, and either the selection moves with it, or its size
 * changes, or — on a board the room cannot read — nothing happens at all.
 *
 * Three things are being pinned down here, and only one of them is where things end up:
 *
 * — **What a press selects.** A press on an object outside the selection replaces it, because that
 *   is what a press means; a press on an object inside it keeps it, because that is the press that
 *   drags the group.
 * — **Which rule a resize obeys.** Proportions come from the *object's type* first and from Shift
 *   second, so a sticky note is always square and a testbox is only square when asked.
 * — **How many writes a drag is.** One per animation frame, from absolute positions — which is what
 *   lets two people drag two different groups on one board without the board drifting.
 *
 * Coordinates: viewport 1280×800, camera (−640, −400) at zoom 1, so a world point is drawn 640 across
 * and 400 down from itself, and a note created at a world point is centred on it.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';

import { useTransformGesture } from '../../src/client/board/useTransformGesture';
import { useSelection } from '../../src/client/board/useSelection';
import type { Camera } from '../../src/client/canvas/camera';
import {
  createSticky,
  OBJECTS_MAP,
  snapshot,
  type ObjectSnapshot,
} from '../../src/shared/board-model';
import { CLOSE_BOARD_LOAD_FAILED } from '../../src/shared/protocol';
import { FakeProvider } from './helpers/fake-provider';
import {
  registerTestBox,
  registerTestDot,
  testboxFields,
  testdotFields,
  TESTBOX_MIN_SIZE_WORLD,
} from '../fixtures/testbox';
import {
  act,
  board,
  nextFrame,
  pointer,
  renderBoard,
  VIEWPORT,
  type BoardFixture,
} from './harness';

/** The board id is only there so the board really connects and really gets an answer. */
const BOARD_ID = 'boardboardboardboard01';

/** The camera `renderBoard` starts with, for the one test that drives the hook without a Board. */
const CAMERA: Camera = { x: -VIEWPORT.width / 2, y: -VIEWPORT.height / 2, zoom: 1 };

/** The host the hook is documented against: one element per object, each handing over its pointer. */
function GestureHost({
  doc,
  onCall,
}: {
  doc: Y.Doc;
  onCall(what: 'start' | 'end'): void;
}): React.JSX.Element {
  const [objects, setObjects] = useState<readonly ObjectSnapshot[]>(() => snapshot(doc));
  useEffect(() => {
    const map = doc.getMap<Y.Map<unknown>>(OBJECTS_MAP);
    const changed = (): void => setObjects(snapshot(doc));
    map.observeDeep(changed);
    return () => map.unobserveDeep(changed);
  }, [doc]);

  const selection = useSelection(objects);
  const gesture = useTransformGesture({
    doc,
    camera: CAMERA,
    snapshot: objects,
    selection,
    canEdit: true,
    onGestureStart: () => onCall('start'),
    onGestureEnd: () => onCall('end'),
  });

  return (
    <div data-testid="gesture-host">
      {objects.map((object) => (
        <div
          data-dragging={gesture.movingIds.has(object.id) ? 'true' : 'false'}
          data-object-id={object.id}
          data-testid={`host-${object.id}`}
          data-x={object.x}
          data-y={object.y}
          key={object.id}
          style={{ position: 'absolute', left: object.x + 640, top: object.y + 400, width: 200, height: 200 }}
          onPointerDown={(event) => gesture.onObjectPointerDown(event, object.id)}
        />
      ))}
    </div>
  );
}

/** Counts the transactions the document has had, which is the only way to see a write storm. */
function countWrites(fx: BoardFixture): () => number {
  let writes = 0;
  fx.doc().on('update', () => {
    writes += 1;
  });
  return () => writes;
}

describe('a press that becomes a drag', () => {
  it('TC-23 moves the object that was pressed, and selects it instead of what was selected', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0); // world (−100,−100)→(100,100)
    const b = await fx.create(400, 0); // (300,−100)→(500,100)
    await fx.press(a);
    expect(fx.selection().selectedId).toBe(a);

    const from = fx.screenOf(b);
    await fx.dragObject(b, from, { x: from.x + 200, y: from.y + 100 });

    // The press said "this one", and the drag moved it: a is left behind, untouched.
    expect(fx.selection().selectedId).toBe(b);
    expect(fx.boundsOf(b)).toMatchObject({ x: 500, y: 0 });
    expect(fx.boundsOf(a)).toMatchObject({ x: -100, y: -100 });
    // What was dragged comes above what it was dragged over — once, at the start of the gesture.
    expect(fx.boundsOf(b).z).toBeGreaterThan(fx.boundsOf(a).z);
  });

  it('TC-23 moves every object in the selection together, in one write per frame', async () => {
    const fx = renderBoard();
    const writes = countWrites(fx);
    const ids = [await fx.create(0, 0), await fx.create(400, 0), await fx.create(200, 400)];
    await fx.press(ids[0] as string);
    await fx.shiftClick(ids[1] as string);
    await fx.shiftClick(ids[2] as string);
    const before = writes();

    // Six pointer moves inside one animation frame, three objects, one position each: the drag is
    // one gesture and not three, and nobody watching sees the objects arrive one at a time or
    // sixteen times a second per object.
    const from = fx.screenOf(ids[0] as string);
    const el = fx.objectEl(ids[0] as string);
    if (!el) throw new Error('object is not rendered');
    const pointerId = 3;
    pointer('pointerDown', el, { ...from, pointerId });
    for (const step of [10, 20, 30, 40, 50, 60]) {
      // No frame is awaited between moves: this is what a trackpad actually does between two paints.
      pointer('pointerMove', el, { x: from.x + step, y: from.y + step * 0.5, pointerId });
    }
    await act(nextFrame);
    pointer('pointerUp', el, { x: from.x + 60, y: from.y + 30, pointerId });
    await act(nextFrame);

    // The starting places were (−100,−100), (300,−100) and (100,300); the pointer went 60 across and
    // 30 down, and every object went exactly that way, from where it *was* and not from wherever the
    // previous frame left it. That is what lets two people move two groups on one board at once
    // (design TC-36) without the board ending up in two places.
    expect(fx.boundsOf(ids[0] as string)).toMatchObject({ x: -40, y: -70 });
    expect(fx.boundsOf(ids[1] as string)).toMatchObject({ x: 360, y: -70 });
    expect(fx.boundsOf(ids[2] as string)).toMatchObject({ x: 160, y: 330 });
    // A write per *frame*, not per event: six moves, and the only transactions are the one that
    // brought the group to the front and the one that put it where the pointer stopped.
    expect(writes() - before, 'the drag batched its writes').toBeLessThanOrEqual(2);
  });

  it('TC-23 lets go of an object that was deleted while it was being dragged, without writing it back', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const b = await fx.create(400, 0);
    await fx.press(a);
    await fx.shiftClick(b);

    const el = fx.objectEl(b);
    if (!el) throw new Error('object is not rendered');
    const from = fx.screenOf(b);
    pointer('pointerDown', el, { ...from, pointerId: 5 });
    pointer('pointerMove', el, { x: from.x + 100, y: from.y, pointerId: 5 });
    await act(nextFrame);
    // Somebody else deletes one of the two mid-drag. The other one goes on moving; this one is not
    // resurrected by the frame that arrives after it stopped existing.
    await act(async () => {
      const objects = fx.doc().getMap<Y.Map<unknown>>(OBJECTS_MAP);
      objects.delete(b);
      await nextFrame();
    });
    // The element the drag started on is gone from the page, which is the reason the pointer is
    // followed on the window rather than on the object: in a browser the viewport is holding the
    // pointer, and the moves keep arriving whoever else has been unmounted in the meantime.
    const surface = board();
    pointer('pointerMove', surface, { x: from.x + 200, y: from.y, pointerId: 5 });
    pointer('pointerUp', surface, { x: from.x + 200, y: from.y, pointerId: 5 });
    await act(nextFrame);

    expect(fx.objectEl(b)).toBeNull();
    // a was created centred on (0,0), so it stands at (−100,−100); the pointer went 200 across and
    // the last of it is what the note kept.
    expect(fx.boundsOf(a)).toMatchObject({ x: 100, y: -100 });
    expect(fx.selection().ids.has(b)).toBe(false);
  });

  it('TC-23 treats a pointer the system took away as the end of a drag, keeping the last position', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    const el = fx.objectEl(a);
    if (!el) throw new Error('object is not rendered');
    const from = fx.screenOf(a);

    pointer('pointerDown', el, { ...from, pointerId: 6 });
    pointer('pointerMove', el, { x: from.x + 150, y: from.y + 50, pointerId: 6 });
    await act(nextFrame);
    // A touch that became a scroll, a menu that opened: the drag is over, and where the note is
    // standing is where the person last saw it.
    pointer('pointerCancel', el, { x: from.x + 150, y: from.y + 50, pointerId: 6 });
    await act(nextFrame);

    expect(fx.boundsOf(a)).toMatchObject({ x: 50, y: -50 });
    expect(el.dataset['interaction']).not.toBe('dragging');
  });
});

describe('resizing a selection', () => {
  it('TC-24 pulls an edge handle of a type that is not proportion-locked, and only that edge moves', async () => {
    registerTestBox();
    const fx = renderBoard();
    await fx.seedObject('tb-tc24', { ...testboxFields(0, 0, 1), width: 400, height: 200 });
    await fx.press('tb-tc24', fx.screenOf('tb-tc24'));

    // The box is the testbox: world (0,0)→(400,200), drawn at screen (640,400)→(1040,600).
    expect(fx.handles()).toHaveLength(8);
    // Its own spec says its proportions are nobody's business, so a drag right is a wider box.
    await fx.dragHandle('e', { x: 1040, y: 500 }, { x: 1140, y: 500 });

    expect(fx.boundsOf('tb-tc24').width).toBeCloseTo(500, 6);
    expect(fx.boundsOf('tb-tc24').height).toBeCloseTo(200, 6);
    expect(fx.boundsOf('tb-tc24')).toMatchObject({ x: 0, y: 0 });
  });

  it('TC-24 holds Shift and the same type keeps its proportions, because Shift is the person asking', async () => {
    registerTestBox();
    const fx = renderBoard();
    await fx.seedObject('tb-shift', { ...testboxFields(0, 0, 1), width: 400, height: 200 });
    await fx.press('tb-shift', fx.screenOf('tb-shift'));

    await fx.dragHandle('e', { x: 1040, y: 500 }, { x: 1140, y: 500 }, 1, { shiftKey: true });

    // The same 100 pixels of pointer, with the modifier: 500 wide would be 250 tall.
    expect(fx.boundsOf('tb-shift').width).toBeCloseTo(500, 6);
    expect(fx.boundsOf('tb-shift').height).toBeCloseTo(250, 6);
  });

  it('TC-24 keeps a sticky note square without being asked, because its own type says so', async () => {
    const fx = renderBoard();
    const a = await fx.create(0, 0);
    await fx.press(a);

    // The east handle of a note at (−100,−100,200,200) sits at screen (740,400).
    await fx.dragHandle('e', { x: 740, y: 400 }, { x: 840, y: 400 });

    expect(fx.boundsOf(a).width).toBeCloseTo(300, 6);
    expect(fx.boundsOf(a).height).toBeCloseTo(300, 6);
    // The west edge — the one the pointer is not holding — is where it was, and the axis the pointer
    // never moved grew about the middle rather than downward: a square is a square, and it is a
    // square centred on itself.
    expect(fx.boundsOf(a)).toMatchObject({ x: -100, y: -150 });
  });

  it('TC-24 stops a group resize at the tightest limit in the selection, whichever object it belongs to', async () => {
    registerTestBox();
    const fx = renderBoard();
    const note = await fx.create(400, 0); // 200×200, minimum 50
    await fx.seedObject('tb-min', { ...testboxFields(-100, 400, 2), width: 400, height: 200 });
    await fx.press(note);
    await fx.shiftClick('tb-min', fx.screenOf('tb-min'));

    // The box is (−100,−100)→(500,600): 600 wide, drawn from screen (540,300), and the west handle
    // is at screen (540,650). The drag shoves that handle 580 pixels into the board — to nothing, if
    // the objects had no say.
    await fx.dragHandle('w', { x: 540, y: 650 }, { x: 1120, y: 650 });

    // The note cannot go below 50 wide and the testbox below 40; the note gets there first, and the
    // whole selection stops with it.
    const scale = 50 / 200;
    expect(fx.boundsOf(note).width).toBeCloseTo(200 * scale, 6);
    expect(fx.boundsOf('tb-min').width).toBeCloseTo(400 * scale, 6);
    expect(fx.boundsOf('tb-min').width).toBeGreaterThanOrEqual(TESTBOX_MIN_SIZE_WORLD);
    // The note is in the selection, and a note keeps its proportions, so the whole drag did: the
    // testbox is half as tall as it was too, rather than a wide thing next to a square one.
    expect(fx.boundsOf(note).height).toBeCloseTo(50, 6);
    expect(fx.boundsOf('tb-min').height).toBeCloseTo(50, 6);
    // And the edge that was pulled is the edge that moved: the box's west edge went from −100 to 350,
    // and the testbox standing against it went with it, while the note against the *east* edge stayed
    // against the east edge. A group resize that left objects behind the edge they were welded to is
    // a group resize that loses half the group.
    expect(fx.boundsOf('tb-min').x).toBeCloseTo(350, 6);
    expect(fx.boundsOf(note).x).toBeCloseTo(450, 6);
    expect(fx.boundsOf(note).x + fx.boundsOf(note).width).toBeCloseTo(500, 6);
  });

  it('TC-24 boxes a type that cannot be resized and offers nothing to pull', async () => {
    registerTestDot();
    const fx = renderBoard();
    await fx.seedObject('dot-tc24', testdotFields(0, 0, 1)); // world (0,0)→(60,60)
    await fx.press('dot-tc24', fx.screenOf('dot-tc24'));

    // The box is drawn, because something is selected; the handles are not, because pulling one
    // would have nowhere to go.
    expect(fx.overlayEl()?.dataset['resizable']).toBe('false');
    expect(fx.handles()).toHaveLength(0);
    // Moving it is still on the table: a type that cannot change size can still change place.
    const from = fx.screenOf('dot-tc24');
    await fx.dragObject('dot-tc24', from, { x: from.x + 100, y: from.y + 100 });
    expect(fx.boundsOf('dot-tc24')).toMatchObject({ x: 100, y: 100 });
  });

  it('TC-24 offers handles for a mixed selection, and the resizable rule is a group rule', async () => {
    registerTestDot();
    const fx = renderBoard();
    const note = await fx.create(0, 0); // 200×200, resizable
    await fx.seedObject('dot-mix', testdotFields(0, 400, 2)); // 60×60, not resizable
    await fx.press(note);
    await fx.shiftClick('dot-mix', fx.screenOf('dot-mix'));

    expect(fx.overlayEl()?.dataset['resizable']).toBe('true');
    expect(fx.handles()).toHaveLength(8);

    // The box is (−100,−100)→(60,460): 200 wide, 560 tall, drawn (540,300)→(740,860), so the east
    // handle is at screen (740,580). Pulling it 200 pixels doubles the width.
    await fx.dragHandle('e', { x: 740, y: 580 }, { x: 940, y: 580 });
    expect(fx.boundsOf(note).width).toBeCloseTo(400, 6);
    expect(fx.boundsOf('dot-mix').width).toBeCloseTo(120, 6);
    // The dot cannot be resized on its own and has no proportion rule of its own; the note does, and
    // a group is resized as one box, so the note came out of the drag square (400×400) and the dot
    // came out of it at the same scale. A drag that changed only the width would have left a note
    // that is no longer a note.
    expect(fx.boundsOf(note).height).toBeCloseTo(400, 6);
    expect(fx.boundsOf('dot-mix').height).toBeCloseTo(120, 6);
  });

  it('TC-24 draws nothing for an object of a type this build cannot draw, and does not select it', async () => {
    const fx = renderBoard();
    await fx.seedObject('unknown-tc24', {
      type: 'shape-from-story-9',
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      z: 1,
    });

    // It is on the board — the document says so, and the board keeps what it cannot read.
    expect(fx.objects().some((object) => object.id === 'unknown-tc24')).toBe(true);
    // Nothing is rendered for it, so there is nothing to press…
    expect(fx.objectEl('unknown-tc24')).toBeNull();
    // …and a rectangle pulled over it does not pick it up either: a type with no hit test is a type
    // that cannot say where it is, and something nobody can see must not be dragged around silently.
    await fx.selectByMarquee(fx.screen({ x: -200, y: -200 }), fx.screen({ x: 400, y: 400 }));
    expect(fx.selection().size).toBe(0);
    expect(fx.overlayEl()).toBeNull();
    // Select all leaves it out too: it cannot be drawn, so it cannot be acted on.
    await fx.selectAll();
    expect(fx.selection().size).toBe(0);
  });

  it('TC-24 boxes a mixed selection but only resizes what the drag says, with every gap scaling too', async () => {
    registerTestBox();
    const fx = renderBoard();
    const near = await fx.create(0, 0); // (−100,−100)→(100,100)
    const far = await fx.create(600, 0); // (500,−100)→(700,100)
    await fx.press(near);
    await fx.shiftClick(far);

    // The box spans both: world (−100,−100)→(700,100), i.e. 800 wide and 200 tall, drawn
    // (540,300)→(1340,500), so the south-east handle is at screen (1340,500).
    const se = { x: 1340, y: 500 };
    // 800 across and 200 down is the same 4× on both axes of the box… which is what the notes' own
    // proportion rule would have made it anyway.
    await fx.dragHandle('se', se, { x: se.x + 800, y: se.y + 200 });

    // ×2: each note doubled in size, and the gap between them doubled as well — which is the
    // difference between a group resize and two independent ones.
    expect(fx.boundsOf(near)).toMatchObject({ x: -100, y: -100, width: 400, height: 400 });
    expect(fx.boundsOf(far)).toMatchObject({ x: 1100, y: -100, width: 400, height: 400 });
    expect(fx.boundsOf(far).x - (fx.boundsOf(near).x + fx.boundsOf(near).width)).toBeCloseTo(800, 6);
  });
});

describe('a gesture on a board the room cannot read', () => {
  it('TC-25 refuses the drag and the resize, and not one byte of the document moves', async () => {
    const provider = new FakeProvider();
    const fx = renderBoard(VIEWPORT, { boardId: BOARD_ID, connect: { provider } });
    const a = await fx.create(0, 0);
    const b = await fx.create(400, 0);
    await act(async () => {
      provider.emitClose(CLOSE_BOARD_LOAD_FAILED);
      await nextFrame();
    });
    expect(screen.getByTestId('connection-status').getAttribute('data-state')).toBe('load_failed');

    const writes = countWrites(fx);
    const before = writes();
    const beforeA = fx.boundsOf(a);

    // Pressing still works: looking at a board is not writing to it.
    await fx.press(a);
    await fx.shiftClick(b);
    expect(fx.selection().size).toBe(2);
    expect(writes(), 'selection is not a change to the board').toBe(before);

    // The drag: the pointer goes through the whole gesture and the note does not move.
    const el = fx.objectEl(a);
    if (!el) throw new Error('note is not rendered');
    const from = fx.screenOf(a);
    pointer('pointerDown', el, { ...from, pointerId: 8 });
    pointer('pointerMove', el, { x: from.x + 300, y: from.y + 300, pointerId: 8 });
    await act(nextFrame);
    expect(el.dataset['interaction'], 'no gesture was started').not.toBe('dragging');
    pointer('pointerUp', el, { x: from.x + 300, y: from.y + 300, pointerId: 8 });
    await act(nextFrame);

    // The handles are on screen, so the only thing standing between this drag and a write is the
    // gesture's own refusal.
    expect(fx.handles()).toHaveLength(8);
    await fx.dragHandle('se', { x: 1340, y: 500 }, { x: 1540, y: 700 });

    expect(fx.boundsOf(a)).toEqual(beforeA);
    expect(writes(), 'a board that cannot be written to was not written to').toBe(before);
  });

  it('TC-25 still selects the note, because a press that writes nothing is not a change', async () => {
    const provider = new FakeProvider();
    const fx = renderBoard(VIEWPORT, { boardId: BOARD_ID, connect: { provider } });
    const a = await fx.create(0, 0);
    await act(async () => {
      provider.emitClose(CLOSE_BOARD_LOAD_FAILED);
      await nextFrame();
    });
    const writes = countWrites(fx);
    const before = writes();

    await fx.press(a);

    expect(fx.selection().selectedId).toBe(a);
    expect(fx.barEl()).toBeNull();
    expect(writes()).toBe(before);
    // And the object's own bin is not offered either: there is nothing it could do.
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});

describe('what a gesture says about itself', () => {
  /** Drags an object in a `GestureHost`, one pointer event at a time, so the test can be exact. */
  async function drag(
    id: string,
    steps: { x: number; y: number }[],
    end: 'up' | 'cancel' = 'up',
  ): Promise<void> {
    const el = screen.getByTestId(`host-${id}`);
    const from = { x: 640, y: 400 };
    pointer('pointerDown', el, { ...from, pointerId: 11 });
    await act(nextFrame);
    for (const step of steps) {
      pointer('pointerMove', el, { ...step, pointerId: 11 });
      await act(nextFrame);
    }
    const last = steps[steps.length - 1] ?? from;
    pointer(end === 'cancel' ? 'pointerCancel' : 'pointerUp', el, { ...last, pointerId: 11 });
    await act(nextFrame);
  }

  it('TC-26 says it started and it ended, once each, for one drag', async () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    if (typeof id !== 'string') throw new Error('the note was not created');
    const calls: ('start' | 'end')[] = [];
    render(<GestureHost doc={doc} onCall={(what) => calls.push(what)} />);

    await drag(id, [
      { x: 700, y: 400 },
      { x: 800, y: 450 },
      { x: 900, y: 500 },
    ]);

    // Three moves, one gesture: whatever listens to these callbacks — a busy cursor, a broadcast of
    // "someone is moving this" — hears about the drag once and not once per frame.
    expect(calls).toEqual(['start', 'end']);
    expect(screen.getByTestId(`host-${id}`).dataset['dragging']).toBe('false');
    // The note was created centred on (0,0), so it stands at x=−100; the pointer travelled 260.
    expect(screen.getByTestId(`host-${id}`).dataset['x']).toBe('160');
  });

  it('TC-26 says nothing at all about a press that never left the object', async () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    if (typeof id !== 'string') throw new Error('the note was not created');
    const calls: ('start' | 'end')[] = [];
    render(<GestureHost doc={doc} onCall={(what) => calls.push(what)} />);

    // Three pixels is the line (DRAG_THRESHOLD_PX): a pointer that reaches it is dragging the
    // selection, and one that does not is a person choosing something.
    await drag(id, [{ x: 642, y: 400 }]);
    expect(calls).toEqual([]);

    await drag(id, [{ x: 643, y: 400 }]);
    expect(calls).toEqual(['start', 'end']);
  });

  it('TC-26 ends the gesture when the window loses focus, and does not start it again on the next drag', async () => {
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    if (typeof id !== 'string') throw new Error('the note was not created');
    const calls: ('start' | 'end')[] = [];
    render(<GestureHost doc={doc} onCall={(what) => calls.push(what)} />);

    const el = screen.getByTestId(`host-${id}`);
    pointer('pointerDown', el, { x: 640, y: 400, pointerId: 12 });
    pointer('pointerMove', el, { x: 740, y: 400, pointerId: 12 });
    await act(nextFrame);
    // Alt-Tab, a notification, the address bar: no pointerup is ever going to arrive.
    await act(async () => {
      window.dispatchEvent(new Event('blur'));
      await nextFrame();
    });
    expect(calls).toEqual(['start', 'end']);
    expect(el.dataset['dragging']).toBe('false');

    // The next drag is a drag, not a continuation of the one that was interrupted.
    await drag(id, [{ x: 800, y: 500 }]);
    expect(calls).toEqual(['start', 'end', 'start', 'end']);
  });

  it('TC-26 counts a drag of a whole selection as one gesture, not one per object', async () => {
    const doc = new Y.Doc();
    const first = createSticky(doc, { x: 0, y: 0 });
    const second = createSticky(doc, { x: 400, y: 0 });
    if (typeof first !== 'string' || typeof second !== 'string') {
      throw new Error('the notes were not created');
    }
    const calls: ('start' | 'end')[] = [];
    render(<GestureHost doc={doc} onCall={(what) => calls.push(what)} />);

    const one = screen.getByTestId(`host-${first}`);
    const two = screen.getByTestId(`host-${second}`);
    // A click on one note and a Shift-click on the other: a selection of two. A click is a press that
    // never travelled, so it reports no gesture at all — which is what makes the one pair below the
    // drag's, and not the picking-out's.
    pointer('pointerDown', one, { x: 640, y: 400, pointerId: 11 });
    pointer('pointerUp', one, { x: 640, y: 400, pointerId: 11 });
    await act(nextFrame);
    pointer('pointerDown', two, { x: 1040, y: 400, pointerId: 12, shiftKey: true });
    pointer('pointerUp', two, { x: 1040, y: 400, pointerId: 12, shiftKey: true });
    await act(nextFrame);
    expect(calls).toEqual([]);

    // Now one pointer drags the pair: the selection was already two objects when the press landed,
    // so both move, and the gesture says of itself once and once only.
    pointer('pointerDown', one, { x: 640, y: 400, pointerId: 13 });
    await act(nextFrame);
    pointer('pointerMove', one, { x: 700, y: 400, pointerId: 13 });
    await act(nextFrame);
    pointer('pointerMove', one, { x: 760, y: 400, pointerId: 13 });
    await act(nextFrame);
    pointer('pointerUp', one, { x: 760, y: 400, pointerId: 13 });
    await act(nextFrame);

    expect(calls).toEqual(['start', 'end']);
    // Both notes moved, by the same 120, and neither is still saying it is being dragged.
    expect(screen.getByTestId(`host-${first}`).dataset['x']).toBe('20');
    expect(screen.getByTestId(`host-${second}`).dataset['x']).toBe('420');
    expect(two.dataset['dragging']).toBe('false');
  });

  it('refuses a press with nothing selected, and writes nothing', async () => {
    const fx = renderBoard();
    const writes = countWrites(fx);
    const before = writes();

    // Nothing is selected and there is no box: the press on empty board space is the browser's own,
    // and the only thing the board does with it is drop a selection it does not have.
    fireEvent.pointerDown(board(), { clientX: 10, clientY: 10, button: 0 });
    await act(nextFrame);

    expect(fx.handles()).toHaveLength(0);
    expect(fx.overlayEl()).toBeNull();
    expect(fx.selection().size).toBe(0);
    expect(writes()).toBe(before);
  });
});
