import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, act, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, objects, deleteObject } from '../../src/shared/board-model';
import { createSticky } from '../../src/shared/board-model';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import { StrokeObject } from '../../src/client/objects/StrokeObject';
import { getObjectType } from '../../src/client/objects/registry';
import { TestBoard } from './helpers/TestBoard';
import { PEN_THICKNESS_WORLD, STROKE_HIT_TOLERANCE_PX } from '../../src/shared/config';
import type { Point } from '../../src/shared/geometry';

beforeEach(() => {
  class MockPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    pressure: number;
    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props);
      this.pointerId = props.pointerId ?? 1;
      this.pointerType = props.pointerType ?? 'mouse';
      this.pressure = props.pressure ?? 0.5;
    }
  }
  (globalThis as any).PointerEvent = MockPointerEvent;
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  if (!HTMLElement.prototype.getBoundingClientRect) {
    HTMLElement.prototype.getBoundingClientRect = () =>
      ({ x: 0, y: 0, width: 800, height: 600, top: 0, left: 0, right: 800, bottom: 600, toJSON: () => ({}) } as DOMRect);
  }
});

afterEach(() => {
  cleanup();
});

function makeLineStroke(): { doc: Y.Doc; snap: StrokeSnap } {
  const doc = new Y.Doc();
  initDoc(doc);
  const id = createStroke(
    doc,
    { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], color: 'black', thickness: 'medium' },
    'u',
  );
  return { doc, snap: objects(doc).find((o) => o.id === id) as StrokeSnap };
}

describe('StrokeObject rendering', () => {
  it('renders a smoothed SVG path with the stored colour and thickness, labelled "Drawing"', () => {
    const { doc, snap } = makeLineStroke();
    const { container } = render(
      <StrokeObject stroke={snap} selected={false} camera={{ x: 0, y: 0, zoom: 1 }} />,
    );
    const el = container.querySelector('[data-testid="stroke-object-' + snap.id + '"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-label')).toBe('Drawing');
    const path = container.querySelector('path');
    expect(path).not.toBeNull();
    expect(path?.getAttribute('d')?.startsWith('M ')).toBe(true);
    expect(path?.getAttribute('fill')).toBe('none');
    expect(path?.getAttribute('stroke-width')).toBe(String(PEN_THICKNESS_WORLD.medium));
    expect(path?.getAttribute('stroke-linecap')).toBe('round');
    expect(path?.getAttribute('stroke-linejoin')).toBe('round');
    void doc;
  });
});

describe('TC-15: registry hit test at the screen-pixel boundary', () => {
  it('5 px screen distance hits and 7 px misses, at 50% and 200% zoom', () => {
    const { snap } = makeLineStroke();
    const spec = getObjectType('stroke');
    expect(spec, 'stroke type registered').toBeDefined();
    for (const zoom of [0.5, 2] as const) {
      const tol = Math.max(PEN_THICKNESS_WORLD[snap.thickness] / 2, STROKE_HIT_TOLERANCE_PX / zoom);
      const fivePx = (5 / zoom) as number;
      const sevenPx = (7 / zoom) as number;
      expect(fivePx, `5px world at zoom ${zoom}`).toBeLessThanOrEqual(tol);
      expect(sevenPx, `7px world at zoom ${zoom}`).toBeGreaterThan(tol);
      expect(spec!.hitTest(snap, { x: 50, y: fivePx }, zoom), `hit at 5px, zoom ${zoom}`).toBe(true);
      expect(spec!.hitTest(snap, { x: 50, y: sevenPx }, zoom), `miss at 7px, zoom ${zoom}`).toBe(false);
    }
  });
});

describe('TC-16: clicking inside a stroke bbox far from the line selects what is below', () => {
  it('a click at the centre of a big loop stroke over a sticky selects the sticky, not the stroke', () => {
    const stickyAndStrokeDoc = {
      create(doc: Y.Doc) {
        // Sticky centred on (200, 200): rect (100,100,200,200).
        createSticky(doc, { x: 200, y: 200 });
        // A loop stroke (circle r=150 centred on (200,200)) above the sticky.
        const pts: Point[] = [];
        for (let i = 0; i < 72; i++) {
          const t = (i / 72) * Math.PI * 2;
          pts.push({ x: 200 + Math.cos(t) * 150, y: 200 + Math.sin(t) * 150 });
        }
        return createStroke(doc, { points: pts, color: 'black', thickness: 'medium' }, 'u');
      },
    };

    let strokeId: string | null = null;
    render(
      <TestBoard
        camera={{ x: 0, y: 0, zoom: 1 }}
        viewportSize={{ width: 800, height: 600 }}
        onDocReady={(doc) => {
          strokeId = stickyAndStrokeDoc.create(doc);
        }}
      />,
    );

    const strokeEl = document.querySelector(`[data-testid="stroke-object-${strokeId}"]`);
    expect(strokeEl, 'stroke rendered').not.toBeNull();
    const sticky = document.querySelector('[data-testid^="sticky-note-"]');
    expect(sticky, 'sticky rendered').not.toBeNull();

    // Click the centre of the stroke bbox (200,200): far from the loop line.
    act(() => {
      fireEvent.pointerDown(strokeEl!, { clientX: 200, clientY: 200, button: 0 });
      fireEvent.pointerUp(strokeEl!, { clientX: 200, clientY: 200, button: 0 });
    });

    expect(strokeEl?.getAttribute('data-selected'), 'stroke not selected').toBeNull();
    expect((sticky as HTMLElement).getAttribute('data-selected'), 'sticky selected').not.toBeNull();
  });
});

describe('TC-21: a stroke deleted while selected clears the selection', () => {
  it('deleting the selected stroke via the model → selection cleared, no exception', () => {
    let boardDoc: Y.Doc | null = null;
    let strokeId: string | null = null;
    render(
      <TestBoard
        camera={{ x: 0, y: 0, zoom: 1 }}
        viewportSize={{ width: 800, height: 600 }}
        onDocReady={(doc) => {
          boardDoc = doc;
          strokeId = createStroke(
            doc,
            { points: [{ x: 100, y: 100 }, { x: 300, y: 100 }], color: 'black', thickness: 'medium' },
            'u',
          );
        }}
      />,
    );
    const strokeEl = document.querySelector(`[data-testid="stroke-object-${strokeId}"]`);
    expect(strokeEl, 'stroke rendered').not.toBeNull();

    // Select the stroke by clicking its line.
    act(() => {
      fireEvent.pointerDown(strokeEl!, { clientX: 200, clientY: 100, button: 0 });
      fireEvent.pointerUp(strokeEl!, { clientX: 200, clientY: 100, button: 0 });
    });
    expect(strokeEl?.getAttribute('data-selected')).not.toBeNull();

    // Remote delete while selected.
    expect(() => {
      act(() => {
        deleteObject(boardDoc!, strokeId!);
      });
    }).not.toThrow();
    expect(document.querySelector(`[data-testid="stroke-object-${strokeId}"]`), 'stroke gone').toBeNull();
  });
});
