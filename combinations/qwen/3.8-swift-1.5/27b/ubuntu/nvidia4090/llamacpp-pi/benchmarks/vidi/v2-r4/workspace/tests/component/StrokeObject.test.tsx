import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { render, screen, act, renderHook, cleanup } from '@testing-library/react';
import { initDoc, snapshot, createSticky, deleteObject } from '../../src/shared/board-model';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import { getObjectType } from '../../src/client/objects/registry';
import { StrokeObjectComponent } from '../../src/client/objects/StrokeObject';
import { StickyNoteComponent } from '../../src/client/objects/StickyNote';
import { useSelection } from '../../src/client/board/useSelection';
import type { ObjectProps } from '../../src/client/objects/registry';
import type { ObjectSnapshot } from '../../src/shared/board-model';

beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
});

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function makeObjectProps(obj: ObjectSnapshot, onPointerDown: (e: unknown, id: string) => void): ObjectProps {
  return {
    obj,
    doc: makeDoc(),
    zoom: 1,
    selected: false,
    editing: false,
    editable: true,
    onPointerDown: onPointerDown as ObjectProps['onPointerDown'],
    onStartEdit: vi.fn(),
    onEndEdit: vi.fn(),
  };
}

function dispatchPointer(el: HTMLElement, type: string, x: number, y: number, pointerId = 1, button = 0) {
  const evt = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(evt, { clientX: x, clientY: y, pointerId, button });
  el.dispatchEvent(evt);
}

describe('stroke.object component tests', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    doc = makeDoc();
  });

  // TC-15: registry hitTest at 5 px and 7 px screen distance from the line,
  // at 50% and 200% zoom → hit / miss at both zooms (boundary).
  it('TC-15: hit test at 5px and 7px screen distance at 50% and 200% zoom', () => {
    createStroke(
      doc,
      {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
        ],
        color: 'black',
        thickness: 'medium',
      },
      'user1',
    );
    const s = snapshot(doc).find((o) => o.type === 'stroke') as StrokeSnap;
    const spec = getObjectType('stroke')!;

    for (const zoom of [0.5, 2]) {
      const tolerance = Math.max(PEN_THICKNESS_WORLD[s.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
      // 5 screen px from the line
      expect(spec.hitTest(s, { x: 50, y: 5 / zoom }, zoom)).toBe(true);
      // 7 screen px from the line
      expect(spec.hitTest(s, { x: 50, y: 7 / zoom }, zoom)).toBe(false);
      // sanity: the tolerance is the 6px screen distance at both zooms
      expect(tolerance).toBe(STROKE_HIT_TOLERANCE_PX / zoom);
    }
  });

  // TC-16: a click inside the stroke's bbox, far from its line, over a
  // sticky note → the sticky is selected, the stroke is not (negative).
  it('TC-16: clicking inside the bbox away from the line selects the sticky below', () => {
    const stickyId = createSticky(doc, { x: 100, y: 100 }); // bbox (0,0)-(200,200)
    createStroke(
      doc,
      {
        // A square loop: large bbox, line far from the centre
        points: [
          { x: 10, y: 10 },
          { x: 190, y: 10 },
          { x: 190, y: 190 },
          { x: 10, y: 190 },
          { x: 10, y: 10 },
        ],
        color: 'black',
        thickness: 'medium',
      },
      'user1',
    );
    const snap = snapshot(doc);
    const sticky = snap.find((o) => o.id === stickyId)!;
    const stroke = snap.find((o) => o.type === 'stroke')!;

    const onPointerDownSticky = vi.fn();
    const onPointerDownStroke = vi.fn();

    render(
      <div>
        <StickyNoteComponent {...makeObjectProps(sticky, onPointerDownSticky)} />
        <StrokeObjectComponent {...makeObjectProps(stroke, onPointerDownStroke)} />
      </div>,
    );

    // The click lands on the sticky (inside the stroke's bbox, far from the line)
    const stickyEl = screen.getByTestId('sticky-note');
    act(() => {
      dispatchPointer(stickyEl, 'pointerdown', 100, 100);
    });

    expect(onPointerDownSticky).toHaveBeenCalledTimes(1);
    expect(onPointerDownStroke).not.toHaveBeenCalled();

    // The stroke wrapper is pointer-transparent: in a real browser the click
    // falls through to whatever is underneath.
    const strokeEl = screen.getByTestId('stroke-object');
    expect(strokeEl.style.pointerEvents).toBe('none');
  });

  // TC-21: a stroke deleted (remotely) while selected → the selection is
  // cleared and nothing throws (error path).
  it('TC-21: remote delete while selected clears the selection without error', () => {
    const id = createStroke(
      doc,
      {
        points: [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
        ],
        color: 'black',
        thickness: 'medium',
      },
      'user1',
    )!;

    const { result, rerender } = renderHook(
      ({ snap }) => useSelection(snap),
      { initialProps: { snap: snapshot(doc) } },
    );

    act(() => {
      result.current.click(id);
    });
    expect(result.current.ids.has(id)).toBe(true);

    // The other person deletes the stroke
    let deleted = false;
    act(() => {
      deleted = deleteObject(doc, id);
    });
    expect(deleted).toBe(true);

    expect(() => {
      rerender({ snap: snapshot(doc) });
    }).not.toThrow();
    expect(result.current.ids.size).toBe(0);
  });

  // Rendering: the stroke renders a smooth SVG path labelled "Drawing" with
  // the stored thickness as stroke-width.
  it('renders a smooth path with round caps and the stored thickness', () => {
    createStroke(
      doc,
      {
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
          { x: 20, y: 0 },
        ],
        color: 'red',
        thickness: 'thick',
      },
      'user1',
    );
    const s = snapshot(doc).find((o) => o.type === 'stroke')!;
    const { container } = render(<StrokeObjectComponent {...makeObjectProps(s, vi.fn())} />);

    const path = container.querySelector('path[aria-label="Drawing"]');
    expect(path).toBeTruthy();
    expect(path!.getAttribute('d')!.startsWith('M ')).toBe(true);
    expect(path!.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.thick));
    expect(path!.getAttribute('stroke-linecap')).toBe('round');
    expect(path!.getAttribute('stroke-linejoin')).toBe('round');
    expect(path!.getAttribute('fill')).toBe('none');
  });
});
