// Story 7, sel.transform — the gesture's two callbacks (TC-26) and the lifetime
// of the pointer listeners it borrows from the window. The gesture is driven
// through a probe that hands its own pointer events to it, because the callbacks
// are the seam story 8 (undo) builds on and are not reachable from BoardApp.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import {
  useTransformGesture,
  type TransformGesture,
} from '../../src/client/board/useTransformGesture.ts';
import { useSelection } from '../../src/client/board/useSelection.ts';
import { createSticky, objectsSnapshot, type ObjectSnapshot } from '../../src/shared/board-model.ts';
import type { Camera } from '../../src/client/canvas/camera.ts';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config.ts';

const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

interface ProbeProps {
  doc: Y.Doc;
  id: string;
  canEdit: boolean;
  onStart(): void;
  onEnd(): void;
}

// The smallest host that behaves like the board: the snapshot follows the doc,
// the selection is local, and the object component is a grab surface that owns
// no pointer logic of its own.
function Probe(props: ProbeProps): React.JSX.Element {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const seen = () => setVersion((v) => v + 1);
    props.doc.on('update', seen);
    return () => {
      props.doc.off('update', seen);
    };
  }, [props.doc]);

  const snapshot: readonly ObjectSnapshot[] = useMemo(
    () => objectsSnapshot(props.doc),
    [props.doc, version],
  );
  const selection = useSelection(snapshot);
  const gesture: TransformGesture = useTransformGesture({
    doc: props.doc,
    camera: CAMERA,
    selection,
    snapshot,
    canEdit: props.canEdit,
    onGestureStart: props.onStart,
    onGestureEnd: props.onEnd,
  });

  const obj = snapshot.find((o) => o.id === props.id);
  return (
    <div
      data-testid="surface"
      data-selected={String(selection.ids.has(props.id))}
      style={{
        position: 'absolute',
        left: obj?.x ?? 0,
        top: obj?.y ?? 0,
        width: obj?.width ?? 100,
        height: obj?.height ?? 100,
      }}
      onPointerDown={(e) => gesture.onObjectPointerDown(e, props.id)}
    />
  );
}

function mount(opts: { canEdit?: boolean } = {}): {
  doc: Y.Doc;
  id: string;
  starts(): number;
  ends(): number;
} {
  const doc = new Y.Doc();
  const id = createSticky(doc, { x: 0, y: 0 });
  let starts = 0;
  let ends = 0;
  render(
    <Probe
      doc={doc}
      id={id}
      canEdit={opts.canEdit ?? true}
      onStart={() => starts++}
      onEnd={() => ends++}
    />,
  );
  return { doc, id, starts: () => starts, ends: () => ends };
}

const down = (x: number, y: number) => ({ clientX: x, clientY: y, button: 0, pointerId: 1 });

afterEach(() => {
  vi.restoreAllMocks();
});

describe('transform gesture lifecycle (sel.transform)', () => {
  // TC-26: exactly one start and one end for one drag, however many pointermoves
  // it is made of.
  it('TC-26 calls onGestureStart and onGestureEnd once per drag', () => {
    const t = mount();
    const el = screen.getByTestId('surface');

    fireEvent.pointerDown(el, down(300, 300));
    for (let i = 1; i <= 10; i++) fireEvent.pointerMove(window, down(300 + i * 20, 300));
    fireEvent.pointerUp(el, down(500, 300));

    expect(t.starts()).toBe(1);
    expect(t.ends()).toBe(1);
  });

  // A press that never became a drag was a select: it announces nothing.
  it('TC-26 a click announces neither a start nor an end', () => {
    const t = mount();
    const el = screen.getByTestId('surface');

    fireEvent.pointerDown(el, down(300, 300));
    fireEvent.pointerMove(window, down(300 + DRAG_THRESHOLD_PX - 1, 300));
    fireEvent.pointerUp(el, down(302, 300));

    expect(t.starts()).toBe(0);
    expect(t.ends()).toBe(0);
    expect(screen.getByTestId('surface')).toHaveAttribute('data-selected', 'true');
  });

  // Two drags in a row: two of each, never one per pointermove.
  it('TC-26 counts each drag separately', () => {
    const t = mount();
    const el = screen.getByTestId('surface');

    fireEvent.pointerDown(el, down(300, 300));
    fireEvent.pointerMove(window, down(400, 300));
    fireEvent.pointerUp(el, down(400, 300));

    fireEvent.pointerDown(el, down(500, 500));
    fireEvent.pointerMove(window, down(600, 500));
    fireEvent.pointerUp(el, down(600, 500));

    expect(t.starts()).toBe(2);
    expect(t.ends()).toBe(2);
  });

  // An interrupted drag ends once, keeps what it moved, and writes nothing more.
  it('TC-26 ends once on pointercancel and keeps the last position', () => {
    const t = mount();
    const el = screen.getByTestId('surface');

    fireEvent.pointerDown(el, down(300, 300));
    fireEvent.pointerMove(window, down(420, 300));
    fireEvent.pointerCancel(el, { pointerId: 1 });

    expect(t.starts()).toBe(1);
    expect(t.ends()).toBe(1);
    // The note is centred on (0,0), so it starts at x = -100 and the drag's
    // 120 px are its whole travel.
    const moved = objectsSnapshot(t.doc)[0];
    expect(moved.x).toBeCloseTo(20, 6);

    fireEvent.pointerMove(window, down(900, 900));
    expect(objectsSnapshot(t.doc)[0].x).toBeCloseTo(20, 6);
  });

  // The window listeners exist only while a gesture is alive: a count probe on
  // window's own pointermove listeners sees them arrive on press and leave on
  // release, so nothing accumulates over a long session.
  it('TC-26 attaches its window listeners for the length of the gesture only', () => {
    const added: string[] = [];
    const removed: string[] = [];
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const t = mount();
    const count = () => {
      let n = 0;
      for (const call of add.mock.calls) if (call[0] === 'pointermove') n++;
      for (const call of remove.mock.calls) if (call[0] === 'pointermove') n--;
      return n;
    };
    const el = screen.getByTestId('surface');
    expect(count()).toBe(0);

    fireEvent.pointerDown(el, down(300, 300));
    expect(count()).toBe(1);
    fireEvent.pointerMove(window, down(400, 300));
    expect(count()).toBe(1);
    fireEvent.pointerUp(el, down(400, 300));
    expect(count()).toBe(0);

    // And a second gesture borrows one set, not two.
    fireEvent.pointerDown(el, down(100, 100));
    expect(count()).toBe(1);
    fireEvent.pointerUp(el, down(100, 100));
    expect(count()).toBe(0);
    expect(added).toBeDefined();
    expect(removed).toBeDefined();
    expect(t.starts()).toBe(1);
  });

  // The gesture is refused before it begins on a read-only board: no listeners,
  // no callbacks, nothing written.
  it('TC-26 refuses to start at all when the board cannot be edited', () => {
    const t = mount({ canEdit: false });
    const el = screen.getByTestId('surface');

    fireEvent.pointerDown(el, down(300, 300));
    fireEvent.pointerMove(window, down(500, 300));
    fireEvent.pointerUp(el, down(500, 300));

    expect(t.starts()).toBe(0);
    expect(t.ends()).toBe(0);
    expect(objectsSnapshot(t.doc)[0].x).toBeCloseTo(-100, 6);
  });

  // Unmounting in the middle of a drag takes the borrowed listeners with it: a
  // board that comes and goes cannot leak a window pointermove handler.
  it('TC-26 removes its window listeners when the board unmounts mid-drag', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const doc = new Y.Doc();
    const id = createSticky(doc, { x: 0, y: 0 });
    const view = render(
      <Probe doc={doc} id={id} canEdit onStart={() => {}} onEnd={() => {}} />,
    );
    const live = () => {
      let n = 0;
      for (const call of add.mock.calls) if (call[0] === 'pointermove') n++;
      for (const call of remove.mock.calls) if (call[0] === 'pointermove') n--;
      return n;
    };
    const el = screen.getByTestId('surface');
    fireEvent.pointerDown(el, down(300, 300));
    fireEvent.pointerMove(window, down(400, 300));
    expect(live()).toBe(1);

    view.unmount();
    expect(live()).toBe(0);

    // A move after the board is gone writes nothing.
    fireEvent.pointerMove(window, down(900, 900));
    expect(objectsSnapshot(doc)[0].x).toBeCloseTo(-100, 6);
  });
});
