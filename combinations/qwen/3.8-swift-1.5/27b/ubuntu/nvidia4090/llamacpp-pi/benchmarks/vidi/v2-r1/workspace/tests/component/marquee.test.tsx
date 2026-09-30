import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, createSticky, snapshot, type ObjectSnapshot } from '@shared/board-model';
import { useMarquee, MarqueeRect } from '@client/board/Marquee';
import { BoardViewport } from '@client/canvas/BoardViewport';
import type { Camera } from '@client/canvas/camera';

const IDLE_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

// jsdom has no PointerEvent constructor; build MouseEvents with a pointerId.
function pevent(type: string, init: { clientX?: number; clientY?: number; button?: number; pointerId?: number; shiftKey?: boolean } = {}): MouseEvent {
  const e = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
    button: init.button ?? 0,
    shiftKey: init.shiftKey ?? false,
  });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  return e;
}

function makeDoc(notes: Array<{ x: number; y: number }>) {
  const doc = new Y.Doc();
  initDoc(doc);
  const ids = notes.map((n) => createSticky(doc, n));
  return { doc, ids };
}

interface MarqueeHandles {
  marquee: ReturnType<typeof useMarquee>;
}

function MarqueeHarness(props: {
  doc: Y.Doc;
  onSelect: (ids: string[]) => void;
  handlesRef: { current: MarqueeHandles | null };
}) {
  const { doc, onSelect, handlesRef } = props;
  const objects: readonly ObjectSnapshot[] = snapshot(doc);
  const marquee = useMarquee(IDLE_CAMERA, objects, onSelect);
  handlesRef.current = { marquee };
  return (
    <div style={{ position: 'relative', width: 800, height: 600 }}>
      <MarqueeRect rect={marquee.rect} camera={IDLE_CAMERA} />
    </div>
  );
}

describe('sel.marquee (useMarquee)', () => {
  // TC-32: fully contained objects selected; partial not
  it('TC-32: a marquee selects only the objects lying entirely inside', () => {
    // Notes (200x200, centred on the given point):
    //  A: centred (150,150)  → 50..250
    //  B: centred (450,150)  → 350..550
    //  C: centred (150,450)  → 50..250 y 350..550
    const { doc } = makeDoc([{ x: 150, y: 150 }, { x: 450, y: 150 }, { x: 150, y: 450 }]);
    const onSelect = vi.fn();
    const handlesRef = { current: null as MarqueeHandles | null };
    const { container } = render(<MarqueeHarness doc={doc} onSelect={onSelect} handlesRef={handlesRef} />);

    act(() => handlesRef.current!.marquee.begin({ x: 0, y: 0 }));
    act(() => handlesRef.current!.marquee.move({ x: 300, y: 300 }));
    // marquee rect: 0..300 x 0..300 (world == screen at zoom 1, camera 0,0)
    // A (50..250) fully inside → selected
    // B (350..550) outside → not selected
    // C (y 350..550) outside → not selected
    act(() => handlesRef.current!.marquee.end());

    expect(onSelect).toHaveBeenCalledTimes(1);
    const snap = snapshot(doc);
    const idA = snap[0].id;
    expect(onSelect.mock.calls[0][0]).toEqual([idA]);
    expect(container.querySelector('[data-testid="marquee-rect"]')).toBeNull();
  });

  it('an object touching the marquee edge from outside is NOT selected', () => {
    // Note centred (250,150) → 150..350. Marquee 0..150: the note starts
    // exactly at the marquee edge → not fully inside.
    const { doc } = makeDoc([{ x: 250, y: 150 }]);
    const onSelect = vi.fn();
    const handlesRef = { current: null as MarqueeHandles | null };
    render(<MarqueeHarness doc={doc} onSelect={onSelect} handlesRef={handlesRef} />);

    act(() => handlesRef.current!.marquee.begin({ x: 0, y: 0 }));
    act(() => handlesRef.current!.marquee.move({ x: 150, y: 300 }));
    act(() => handlesRef.current!.marquee.end());

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a zero-size marquee (plain shift+click) selects nothing', () => {
    const { doc } = makeDoc([{ x: 150, y: 150 }]);
    const onSelect = vi.fn();
    const handlesRef = { current: null as MarqueeHandles | null };
    render(<MarqueeHarness doc={doc} onSelect={onSelect} handlesRef={handlesRef} />);

    act(() => handlesRef.current!.marquee.begin({ x: 100, y: 100 }));
    act(() => handlesRef.current!.marquee.end());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('cancel discards the marquee without selecting', () => {
    const { doc } = makeDoc([{ x: 150, y: 150 }]);
    const onSelect = vi.fn();
    const handlesRef = { current: null as MarqueeHandles | null };
    const { container } = render(<MarqueeHarness doc={doc} onSelect={onSelect} handlesRef={handlesRef} />);

    act(() => handlesRef.current!.marquee.begin({ x: 0, y: 0 }));
    act(() => handlesRef.current!.marquee.move({ x: 300, y: 300 }));
    expect(container.querySelector('[data-testid="marquee-rect"]')).not.toBeNull();
    act(() => handlesRef.current!.marquee.cancel());
    expect(container.querySelector('[data-testid="marquee-rect"]')).toBeNull();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('marquee is stored in world units: zoom 0.5 doubles the world rect', () => {
    const camera: Camera = { x: 0, y: 0, zoom: 0.5 };
    const { doc } = makeDoc([{ x: 150, y: 150 }]);
    const onSelect = vi.fn();
    const handlesRef = { current: null as MarqueeHandles | null };
    // A centred (150,150) → 50..250. Screen 0..100 → world 0..200 → fully inside.
    const Harness = () => {
      const objects = snapshot(doc);
      const marquee = useMarquee(camera, objects, onSelect);
      handlesRef.current = { marquee };
      return <MarqueeRect rect={marquee.rect} camera={camera} />;
    };
    render(<Harness />);

    act(() => handlesRef.current!.marquee.begin({ x: 0, y: 0 }));
    // screen 0..200 at zoom 0.5 → world 0..400 → note 50..250 fully inside
    act(() => handlesRef.current!.marquee.move({ x: 200, y: 200 }));
    act(() => handlesRef.current!.marquee.end());
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toHaveLength(1);
  });
});

describe('sel.marquee (BoardViewport wiring)', () => {
  interface ViewportTestProps {
    onMarqueeBegin?: (p: { x: number; y: number }) => void;
    onMarqueeMove?: (p: { x: number; y: number }) => void;
    onMarqueeEnd?: () => void;
    onMarqueeCancel?: () => void;
    onPointerUpEmpty?: () => void;
    beginPan?: () => void;
  }

  let lastContainer: HTMLElement | null = null;

  function renderViewport(props: ViewportTestProps) {
    const result = render(
      <BoardViewport
        camera={IDLE_CAMERA}
        beginPan={props.beginPan ?? vi.fn()}
        panMove={vi.fn()}
        endPan={vi.fn()}
        wheel={vi.fn()}
        zoomAtPointer={vi.fn()}
        zoomStep={vi.fn()}
        reset={vi.fn()}
        isPanning={false}
        onPointerUpEmpty={props.onPointerUpEmpty}
        onMarqueeBegin={props.onMarqueeBegin}
        onMarqueeMove={props.onMarqueeMove}
        onMarqueeEnd={props.onMarqueeEnd}
        onMarqueeCancel={props.onMarqueeCancel}
      />,
    );
    lastContainer = result.container;
    return result;
  }

  // Scoped to this test's container: a global document.querySelector would
  // find the previous test's unmounted viewport.
  function viewportEl() {
    return lastContainer!.querySelector('[data-testid="board-viewport"]') as HTMLElement;
  }

  it('Shift+drag on empty space runs the marquee callbacks and does NOT pan', () => {
    const begin = vi.fn();
    const moveCb = vi.fn();
    const end = vi.fn();
    const beginPan = vi.fn();
    const onPointerUpEmpty = vi.fn();
    renderViewport({ onMarqueeBegin: begin, onMarqueeMove: moveCb, onMarqueeEnd: end, beginPan, onPointerUpEmpty });

    const el = viewportEl();
    act(() => { el.dispatchEvent(pevent('pointerdown', { clientX: 10, clientY: 10, shiftKey: true })); });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(beginPan).not.toHaveBeenCalled();

    act(() => { el.dispatchEvent(pevent('pointermove', { clientX: 60, clientY: 50 })); });
    expect(moveCb).toHaveBeenCalled();

    act(() => { el.dispatchEvent(pevent('pointerup', { clientX: 60, clientY: 50 })); });
    expect(end).toHaveBeenCalledTimes(1);
    // A marquee up must not clear the selection.
    expect(onPointerUpEmpty).not.toHaveBeenCalled();
  });

  it('a plain drag (no Shift) still pans and does not start a marquee', () => {
    const begin = vi.fn();
    const beginPan = vi.fn();
    renderViewport({ onMarqueeBegin: begin, beginPan });

    const el = viewportEl();
    act(() => { el.dispatchEvent(pevent('pointerdown', { clientX: 10, clientY: 10, shiftKey: false })); });
    expect(begin).not.toHaveBeenCalled();
    expect(beginPan).toHaveBeenCalledTimes(1);
  });

  it('pointercancel during a marquee calls onMarqueeCancel', () => {
    const cancelCb = vi.fn();
    const end = vi.fn();
    renderViewport({ onMarqueeBegin: vi.fn(), onMarqueeCancel: cancelCb, onMarqueeEnd: end });

    const el = viewportEl();
    act(() => { el.dispatchEvent(pevent('pointerdown', { clientX: 10, clientY: 10, shiftKey: true })); });
    act(() => { el.dispatchEvent(pevent('pointercancel')); });
    expect(cancelCb).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
  });
});
