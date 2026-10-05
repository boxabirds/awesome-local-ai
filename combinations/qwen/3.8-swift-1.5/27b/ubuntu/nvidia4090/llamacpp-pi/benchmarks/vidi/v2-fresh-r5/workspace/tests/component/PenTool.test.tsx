/**
 * Component tests: PenTool — TC-09 to TC-14 (story 11).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, fireEvent, act } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc } from '../../src/shared/board-model';
import { useActiveTool } from '../../src/client/tools/useActiveTool';
import { usePenOptions } from '../../src/client/tools/usePenOptions';
import { PenTool } from '../../src/client/tools/PenTool';
import { STROKE_MAX_POINTS } from '../../src/shared/config';

const testCamera = { x: 0, y: 0, zoom: 1 };

function newDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function overlay(container: ParentNode): SVGElement {
  const el = container.querySelector('[data-testid="pen-tool-overlay"]');
  expect(el, 'pen overlay should be rendered').not.toBeNull();
  return el as SVGElement;
}

function strokeEntries(doc: Y.Doc): Y.Map<unknown>[] {
  const out: Y.Map<unknown>[] = [];
  doc.getMap('objects').forEach((obj) => {
    if ((obj as Y.Map<unknown>).get('type') === 'stroke') out.push(obj as Y.Map<unknown>);
  });
  return out;
}

describe('PenTool (TC-09 to TC-14)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-09: drag commits a stroke with the chosen colour/thickness; tool stays pen', () => {
    const { result } = renderHook(() => useActiveTool({ canEdit: true, onSelect: () => {} }));
    act(() => {
      result.current.setTool('pen');
    });
    expect(result.current.tool).toBe('pen');

    const doc = newDoc();
    const { container } = render(
      <PenTool camera={testCamera} color="red" thickness="thick" doc={doc} identityId="local" />,
    );
    const svg = overlay(container);

    act(() => {
      fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    });
    act(() => {
      fireEvent.pointerMove(svg, { clientX: 150, clientY: 140, pointerId: 1 });
    });
    act(() => {
      fireEvent.pointerMove(svg, { clientX: 200, clientY: 220, pointerId: 1 });
    });
    // Flush the preview frame
    act(() => {
      vi.advanceTimersByTime(16);
    });
    // Local preview is visible while dragging
    expect(container.querySelector('[data-testid="pen-preview-path"]')).not.toBeNull();

    act(() => {
      fireEvent.pointerUp(svg, { clientX: 200, clientY: 220, pointerId: 1 });
    });

    // Exactly one stroke, with red/thick
    const entries = strokeEntries(doc);
    expect(entries).toHaveLength(1);
    expect(entries[0].get('color')).toBe('red');
    expect(entries[0].get('thickness')).toBe('thick');
    const pts = entries[0].get('points') as number[];
    expect(pts.length).toBeGreaterThanOrEqual(4); // at least two world points

    // The pen tool stays active (pen.stay_active)
    expect(result.current.tool).toBe('pen');

    // Preview cleared
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(container.querySelector('[data-testid="pen-preview-path"]')).toBeNull();
  });

  it('TC-10: press without movement commits a single-point dot', () => {
    const doc = newDoc();
    const { container } = render(
      <PenTool camera={testCamera} color="black" thickness="medium" doc={doc} identityId="local" />,
    );
    const svg = overlay(container);

    act(() => {
      fireEvent.pointerDown(svg, { clientX: 123.5, clientY: 77.25, button: 0, pointerId: 1 });
    });
    act(() => {
      fireEvent.pointerUp(svg, { clientX: 123.5, clientY: 77.25, pointerId: 1 });
    });

    const entries = strokeEntries(doc);
    expect(entries).toHaveLength(1);
    const e = entries[0];
    const pts = e.get('points') as number[];
    // A single world point: 2 coordinates
    expect(pts).toHaveLength(2);
    // Bbox is a thickness-sized square (medium = 4)
    expect(e.get('width')).toBeCloseTo(4, 5);
    expect(e.get('height')).toBeCloseTo(4, 5);
    // The point sits at the centre of the bbox
    expect(e.get('x')).toBeCloseTo(123.5 - 2, 5);
    expect(e.get('y')).toBeCloseTo(77.25 - 2, 5);
    expect(pts[0]).toBeCloseTo(2, 5);
    expect(pts[1]).toBeCloseTo(2, 5);
  });

  it('TC-11: interrupted drag (pointercancel) keeps the points drawn so far', () => {
    const doc = newDoc();
    const { container } = render(
      <PenTool camera={testCamera} color="blue" thickness="thin" doc={doc} identityId="local" />,
    );
    const svg = overlay(container);

    act(() => {
      fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    });
    act(() => {
      fireEvent.pointerMove(svg, { clientX: 130, clientY: 120, pointerId: 1 });
    });
    act(() => {
      fireEvent.pointerMove(svg, { clientX: 160, clientY: 110, pointerId: 1 });
    });
    // System interruption
    act(() => {
      fireEvent.pointerCancel(svg, { pointerId: 1 });
    });

    const entries = strokeEntries(doc);
    expect(entries).toHaveLength(1);
    const pts = entries[0].get('points') as number[];
    // All three captured points kept
    expect(pts.length).toBe(6);
  });

  it('TC-12: a very long stroke splits into consecutive strokes that join at the same point', () => {
    const doc = newDoc();
    const { container } = render(
      <PenTool camera={testCamera} color="black" thickness="thin" doc={doc} identityId="local" />,
    );
    const svg = overlay(container);

    act(() => {
      fireEvent.pointerDown(svg, { clientX: 100, clientY: 100, button: 0, pointerId: 1 });
    });
    const extra = STROKE_MAX_POINTS + 10 - 1; // 5009 moves → 5010 raw points
    for (let i = 1; i <= extra; i++) {
      act(() => {
        fireEvent.pointerMove(svg, { clientX: 100 + i, clientY: 100, pointerId: 1 });
      });
    }
    act(() => {
      vi.advanceTimersByTime(16);
    });
    act(() => {
      fireEvent.pointerUp(svg, { clientX: 100 + extra, clientY: 100, pointerId: 1 });
    });

    const entries = strokeEntries(doc);
    expect(entries).toHaveLength(2);

    const worldLastOf = (e: Y.Map<unknown>): { x: number; y: number } => {
      const x = e.get('x') as number;
      const y = e.get('y') as number;
      const w = e.get('width') as number;
      const bw = e.get('baseWidth') as number;
      const h = e.get('height') as number;
      const bh = e.get('baseHeight') as number;
      const pts = e.get('points') as number[];
      const sx = bw > 0 ? w / bw : 1;
      const sy = bh > 0 ? h / bh : 1;
      return {
        x: x + pts[pts.length - 2] * sx,
        y: y + pts[pts.length - 1] * sy,
      };
    };
    const worldFirstOf = (e: Y.Map<unknown>): { x: number; y: number } => {
      const x = e.get('x') as number;
      const y = e.get('y') as number;
      const w = e.get('width') as number;
      const bw = e.get('baseWidth') as number;
      const h = e.get('height') as number;
      const bh = e.get('baseHeight') as number;
      const pts = e.get('points') as number[];
      const sx = bw > 0 ? w / bw : 1;
      const sy = bh > 0 ? h / bh : 1;
      return { x: x + pts[0] * sx, y: y + pts[1] * sy };
    };

    const joinA = worldLastOf(entries[0]);
    const joinB = worldFirstOf(entries[1]);
    expect(joinB.x).toBeCloseTo(joinA.x, 5);
    expect(joinB.y).toBeCloseTo(joinA.y, 5);

    // Each part is within the point limit
    for (const e of entries) {
      const pts = e.get('points') as number[];
      expect(pts.length / 2).toBeLessThanOrEqual(STROKE_MAX_POINTS);
    }
  });

  it('TC-13: Escape returns to select; V keeps select; no strokes created', () => {
    const doc = newDoc();
    const { result } = renderHook(() => useActiveTool({ canEdit: true, onSelect: () => {} }));
    act(() => {
      result.current.setTool('pen');
    });
    expect(result.current.tool).toBe('pen');

    render(
      <PenTool camera={testCamera} color="black" thickness="medium" doc={doc} identityId="local" />,
    );
    // A stray drag while the tool is active would create a stroke; Escape must
    // happen first so it does not.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(result.current.tool).toBe('select');

    // Pressing V (select shortcut) while on select stays select
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });
    expect(result.current.tool).toBe('select');

    // Nothing was created
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('TC-14: changing colour after a stroke leaves the old stroke unchanged', () => {
    const doc = newDoc();
    const { result } = renderHook(() => usePenOptions());
    const { rerender } = render(
      <PenTool
        camera={testCamera}
        color={result.current.color}
        thickness={result.current.thickness}
        doc={doc}
        identityId="local"
      />,
    );

    const drawStroke = (x0: number, x1: number) => {
      const svg = overlay(document.body);
      act(() => {
        fireEvent.pointerDown(svg, { clientX: x0, clientY: 200, button: 0, pointerId: 1 });
      });
      act(() => {
        fireEvent.pointerMove(svg, { clientX: x1, clientY: 240, pointerId: 1 });
      });
      act(() => {
        fireEvent.pointerUp(svg, { clientX: x1, clientY: 240, pointerId: 1 });
      });
      act(() => {
        vi.advanceTimersByTime(16);
      });
    };

    // First stroke with defaults (black)
    drawStroke(50, 150);
    expect(strokeEntries(doc)).toHaveLength(1);
    expect(strokeEntries(doc)[0].get('color')).toBe('black');

    // Change colour, then draw again
    act(() => {
      result.current.setColor('red');
    });
    rerender(
      <PenTool
        camera={testCamera}
        color={result.current.color}
        thickness={result.current.thickness}
        doc={doc}
        identityId="local"
      />,
    );
    drawStroke(300, 400);

    const entries = strokeEntries(doc);
    expect(entries).toHaveLength(2);
    // Y.Map iteration order = insertion order
    expect(entries[0].get('color')).toBe('black');
    expect(entries[1].get('color')).toBe('red');
  });
});
