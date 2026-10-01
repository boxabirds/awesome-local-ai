import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { render, screen, act, renderHook, cleanup } from '@testing-library/react';
import { initDoc, snapshot } from '../../src/shared/board-model';
import { scaledPoints, type PenColor, type PenThickness, type StrokeSnap } from '../../src/shared/objects/stroke';
import { STROKE_MAX_POINTS, PEN_THICKNESS_WORLD } from '../../src/shared/config';
import { PenTool } from '../../src/client/tools/PenTool';
import { PenToolbar } from '../../src/client/tools/PenToolbar';
import { usePenOptions } from '../../src/client/tools/usePenOptions';
import { useTool } from '../../src/client/board/useTool';
import type { Camera } from '../../src/client/canvas/camera';

// Mock pointer capture for jsdom
beforeEach(() => {
  HTMLElement.prototype.setPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

function makeDoc(): Y.Doc {
  const doc = new Y.Doc();
  initDoc(doc);
  return doc;
}

function strokesIn(doc: Y.Doc): StrokeSnap[] {
  return snapshot(doc).filter((o) => o.type === 'stroke') as StrokeSnap[];
}

/** Dispatches a native pointer event with coordinates (jsdom has no hit testing). */
function dispatchPointer(el: HTMLElement, type: string, x: number, y: number, pointerId = 1, button = 0) {
  const evt = new window.Event(type, { bubbles: true, cancelable: true });
  Object.assign(evt, { clientX: x, clientY: y, pointerId, button });
  el.dispatchEvent(evt);
}

interface HarnessRefs {
  tool: string;
  color: PenColor;
  thickness: PenThickness;
  setColor(c: PenColor): void;
  setThickness(t: PenThickness): void;
}

function makeRefs(): HarnessRefs {
  return {
    tool: 'select',
    color: 'black',
    thickness: 'medium',
    setColor: vi.fn(),
    setThickness: vi.fn(),
  };
}

/** Board-level harness: the pen tool overlay is mounted while the tool is pen. */
function PenHarness({
  doc,
  onGestureEnd,
  refs,
}: {
  doc: Y.Doc;
  onGestureEnd: () => void;
  refs: HarnessRefs;
}) {
  const { tool } = useTool({ canEdit: true, editingId: null });
  const opts = usePenOptions();
  refs.tool = tool;
  refs.color = opts.color;
  refs.thickness = opts.thickness;
  refs.setColor = opts.setColor;
  refs.setThickness = opts.setThickness;
  if (tool !== 'pen') return null;
  return (
    <PenTool
      camera={CAMERA}
      color={opts.color}
      thickness={opts.thickness}
      doc={doc}
      identityId="user1"
      onGestureEnd={onGestureEnd}
    />
  );
}

function pressPenTool() {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p' }));
  });
}

describe('pen.tool component tests', () => {
  let doc: Y.Doc;
  let refs: HarnessRefs;
  let onGestureEnd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    doc = makeDoc();
    refs = makeRefs();
    onGestureEnd = vi.fn();
  });

  function renderHarness() {
    return render(<PenHarness doc={doc} onGestureEnd={onGestureEnd} refs={refs} />);
  }

  function getOverlay(): HTMLElement {
    return screen.getByTestId('pen-tool-overlay') as HTMLElement;
  }

  // TC-09: drag with red + thick selected → createStroke once with red/thick;
  // the tool is still pen afterwards.
  it('TC-09: drag commits one red/thick stroke and the pen stays active', () => {
    renderHarness();
    pressPenTool();
    expect(refs.tool).toBe('pen');

    act(() => {
      refs.setColor('red');
      refs.setThickness('thick');
    });

    const overlay = getOverlay();
    act(() => {
      dispatchPointer(overlay, 'pointerdown', 100, 100);
    });
    act(() => {
      dispatchPointer(overlay, 'pointermove', 150, 120);
      dispatchPointer(overlay, 'pointermove', 200, 150);
      vi.advanceTimersByTime(16);
    });
    // Local preview is visible during the drag
    const preview = screen.getByTestId('pen-preview-path');
    expect(preview.getAttribute('d')).toBeTruthy();

    act(() => {
      dispatchPointer(overlay, 'pointerup', 200, 150);
    });

    const strokes = strokesIn(doc);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].color).toBe('red');
    expect(strokes[0].thickness).toBe('thick');
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
    // The preview is gone and the tool is still pen
    expect(screen.queryByTestId('pen-preview-path')).toBeNull();
    expect(refs.tool).toBe('pen');
  });

  // TC-10: pointerdown/up without movement → a single-point dot is committed.
  it('TC-10: a click without movement commits a dot', () => {
    renderHarness();
    pressPenTool();

    const overlay = getOverlay();
    act(() => {
      dispatchPointer(overlay, 'pointerdown', 100, 100);
    });
    act(() => {
      dispatchPointer(overlay, 'pointerup', 100, 100);
    });

    const strokes = strokesIn(doc);
    expect(strokes).toHaveLength(1);
    const t = PEN_THICKNESS_WORLD.medium; // default thickness
    expect(strokes[0].points).toHaveLength(2);
    expect(strokes[0].width).toBe(t);
    expect(strokes[0].height).toBe(t);
    expect(strokes[0].x).toBe(100 - t / 2);
    expect(strokes[0].y).toBe(100 - t / 2);
  });

  // TC-11: pointerdown, moves, pointercancel → the stroke is committed with
  // the points drawn so far (interrupted strokes are kept).
  it('TC-11: pointercancel commits the points drawn so far', () => {
    renderHarness();
    pressPenTool();

    const overlay = getOverlay();
    act(() => {
      dispatchPointer(overlay, 'pointerdown', 100, 100);
    });
    act(() => {
      dispatchPointer(overlay, 'pointermove', 140, 130);
      dispatchPointer(overlay, 'pointermove', 180, 160);
      vi.advanceTimersByTime(16);
    });
    act(() => {
      overlay.dispatchEvent(new window.Event('pointercancel', { bubbles: true }));
    });

    const strokes = strokesIn(doc);
    expect(strokes).toHaveLength(1);
    const pts = scaledPoints(strokes[0]);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    expect(pts[0]).toEqual({ x: 100, y: 100 });
    // The last drawn point is the end of the kept stroke
    const last = pts[pts.length - 1];
    expect(Math.hypot(last.x - 180, last.y - 160)).toBeLessThanOrEqual(1 + 1e-9);
    expect(onGestureEnd).toHaveBeenCalledTimes(1);
  });

  // TC-12: STROKE_MAX_POINTS + 10 moves → two commits; the second stroke
  // starts at the first one's last point (boundary).
  it('TC-12: a very long stroke splits into two joined strokes', () => {
    renderHarness();
    pressPenTool();

    const overlay = getOverlay();
    act(() => {
      dispatchPointer(overlay, 'pointerdown', 0, 0);
    });
    act(() => {
      for (let i = 0; i < STROKE_MAX_POINTS + 10; i++) {
        dispatchPointer(overlay, 'pointermove', i + 1, (i % 7) * 3);
      }
      vi.advanceTimersByTime(16);
    });
    act(() => {
      dispatchPointer(overlay, 'pointerup', STROKE_MAX_POINTS + 11, 0);
    });

    const strokes = strokesIn(doc);
    expect(strokes).toHaveLength(2);
    const [first, second] = strokes;
    const p1 = scaledPoints(first);
    const p2 = scaledPoints(second);
    expect(p1.length).toBeGreaterThanOrEqual(2);
    expect(p2.length).toBeGreaterThanOrEqual(2);
    // Part 2 starts with part 1's last point — no visible gap
    expect(p2[0]).toEqual(p1[p1.length - 1]);
    expect(onGestureEnd).toHaveBeenCalledTimes(2);
  });

  // TC-13: Escape; then V → the tool becomes select and nothing is created
  // (negative).
  it('TC-13: Escape and V switch tools without creating a stroke', () => {
    renderHarness();
    pressPenTool();
    expect(refs.tool).toBe('pen');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(refs.tool).toBe('select');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });
    expect(refs.tool).toBe('select');
    expect(strokesIn(doc)).toHaveLength(0);
  });

  // TC-14: changing the colour after a stroke exists leaves the existing
  // stroke unchanged; the next stroke uses the new colour (negative).
  it('TC-14: option changes never restyle existing strokes', () => {
    renderHarness();
    pressPenTool();

    const overlay = getOverlay();
    act(() => {
      dispatchPointer(overlay, 'pointerdown', 100, 100);
      dispatchPointer(overlay, 'pointermove', 160, 120);
      vi.advanceTimersByTime(16);
      dispatchPointer(overlay, 'pointerup', 160, 120);
    });

    act(() => {
      refs.setColor('red');
      refs.setThickness('thick');
    });

    act(() => {
      dispatchPointer(overlay, 'pointerdown', 300, 300);
      dispatchPointer(overlay, 'pointermove', 380, 320);
      vi.advanceTimersByTime(16);
      dispatchPointer(overlay, 'pointerup', 380, 320);
    });

    const strokes = strokesIn(doc);
    expect(strokes).toHaveLength(2);
    const [first, second] = strokes;
    expect(first.color).toBe('black');
    expect(first.thickness).toBe('medium');
    expect(second.color).toBe('red');
    expect(second.thickness).toBe('thick');
  });
});

describe('PenToolbar component tests', () => {
  it('renders six colour swatches and three thickness buttons with pressed state', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();
    render(<PenToolbar color="red" thickness="thick" onColor={onColor} onThickness={onThickness} />);

    for (const c of ['black', 'blue', 'red', 'green', 'orange', 'purple']) {
      const btn = screen.getByLabelText(`${c} pen`);
      expect(btn).toBeTruthy();
      expect(btn.getAttribute('aria-pressed')).toBe(c === 'red' ? 'true' : 'false');
    }
    for (const [label, t] of [
      ['Thin', 'thin'],
      ['Medium', 'medium'],
      ['Thick', 'thick'],
    ] as const) {
      const btn = screen.getByLabelText(label);
      expect(btn).toBeTruthy();
      expect(btn.getAttribute('aria-pressed')).toBe(t === 'thick' ? 'true' : 'false');
    }

    act(() => {
      screen.getByLabelText('green pen').click();
    });
    expect(onColor).toHaveBeenCalledWith('green');
    act(() => {
      screen.getByLabelText('Thin').click();
    });
    expect(onThickness).toHaveBeenCalledWith('thin');
  });
});

describe('usePenOptions session state', () => {
  it('defaults to black/medium and remembers choices for the session', () => {
    const { result } = renderHook(() => usePenOptions());
    expect(result.current.color).toBe('black');
    expect(result.current.thickness).toBe('medium');

    act(() => {
      result.current.setColor('purple');
      result.current.setThickness('thin');
    });
    expect(result.current.color).toBe('purple');
    expect(result.current.thickness).toBe('thin');
  });
});
