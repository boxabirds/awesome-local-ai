import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, act, cleanup, renderHook } from '@testing-library/react';
import * as Y from 'yjs';
import { initDoc, objects, objectBounds } from '../../src/shared/board-model';
import type { StrokeSnap } from '../../src/shared/objects/stroke';
import { PenTool } from '../../src/client/tools/PenTool';
import { PenToolbar } from '../../src/client/tools/PenToolbar';
import { usePenOptions } from '../../src/client/tools/usePenOptions';
import { useActiveTool } from '../../src/client/tools/useActiveTool';
import type { Camera } from '../../src/client/canvas/camera';
import {
  STROKE_MAX_POINTS,
  type PenColor,
  type PenThickness,
} from '../../src/shared/config';

beforeEach(() => {
  // Mock PointerEvent (jsdom lacks one)
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
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const camera: Camera = { x: 0, y: 0, zoom: 1 };

interface PenSetup {
  doc: Y.Doc;
  overlay: HTMLElement;
  toolHook: { result: { current: ReturnType<typeof useActiveTool> } };
  strokes(): StrokeSnap[];
}

function setupPen(opts: { color?: PenColor; thickness?: PenThickness } = {}): PenSetup {
  const doc = new Y.Doc();
  initDoc(doc);
  const toolHook = renderHook(() => useActiveTool({ canEdit: true, select: () => {} }));
  act(() => {
    toolHook.result.current.setTool('pen');
  });
  const view = render(
    <PenTool
      camera={camera}
      color={opts.color ?? 'black'}
      thickness={opts.thickness ?? 'medium'}
      doc={doc}
      identityId="user1"
    />,
  );
  const overlay = view.container.querySelector('[data-testid="pen-tool-overlay"]') as HTMLElement | null;
  if (!overlay) throw new Error('pen overlay not found');
  return {
    doc,
    overlay,
    toolHook,
    strokes: () => objects(doc).filter((o): o is StrokeSnap => o.type === 'stroke'),
  };
}

function drawStroke(overlay: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }) {
  act(() => {
    fireEvent.pointerDown(overlay, { clientX: from.x, clientY: from.y, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: (from.x + to.x) / 2, clientY: (from.y + to.y) / 2, button: 0 });
    fireEvent.pointerMove(overlay, { clientX: to.x, clientY: to.y, button: 0 });
    fireEvent.pointerUp(overlay, { clientX: to.x, clientY: to.y, button: 0 });
  });
}

describe('TC-09: drawing a stroke with the pen', () => {
  it('pointerdown/moves/up with red + thick → one stroke with red/thick; the tool stays pen', () => {
    const { doc, overlay, toolHook, strokes } = setupPen({ color: 'red', thickness: 'thick' });
    drawStroke(overlay, { x: 100, y: 100 }, { x: 200, y: 160 });

    const s = strokes();
    expect(s).toHaveLength(1);
    expect(s[0].color).toBe('red');
    expect(s[0].thickness).toBe('thick');
    // The stroke spans the drag (bbox covers both ends).
    const b = objectBounds(s[0]);
    expect(b.x).toBeLessThanOrEqual(100);
    expect(b.y).toBeLessThanOrEqual(100);
    expect(b.x + b.width).toBeGreaterThanOrEqual(200);
    expect(b.y + b.height).toBeGreaterThanOrEqual(160);
    // The tool stays active (pen.stay_active).
    expect(toolHook.result.current.tool).toBe('pen');
    void doc;
  });
});

describe('TC-10: a tap draws a dot', () => {
  it('pointerdown/up without movement → a single-point stroke', () => {
    const { overlay, strokes } = setupPen();
    act(() => {
      fireEvent.pointerDown(overlay, { clientX: 200, clientY: 150, button: 0 });
      fireEvent.pointerUp(overlay, { clientX: 200, clientY: 150, button: 0 });
    });
    const s = strokes();
    expect(s).toHaveLength(1);
    expect(s[0].points).toHaveLength(2);
    expect(s[0].points).toEqual([2, 2]); // medium thickness square, point centred
    const b = objectBounds(s[0]);
    expect(b.width).toBe(4);
    expect(b.height).toBe(4);
  });
});

describe('TC-11: an interrupted stroke is kept', () => {
  it('pointerdown, moves, pointercancel → the points so far are committed', () => {
    const { overlay, strokes } = setupPen();
    act(() => {
      fireEvent.pointerDown(overlay, { clientX: 50, clientY: 50, button: 0 });
      fireEvent.pointerMove(overlay, { clientX: 90, clientY: 70, button: 0 });
      fireEvent.pointerMove(overlay, { clientX: 130, clientY: 90, button: 0 });
      fireEvent.pointerCancel(overlay, { button: 0 });
    });
    const s = strokes();
    expect(s).toHaveLength(1);
    const b = objectBounds(s[0]);
    expect(b.x).toBeLessThanOrEqual(50);
    expect(b.x + b.width).toBeGreaterThanOrEqual(130);
  });
});

describe('TC-12: very long strokes commit in parts', () => {
  it('STROKE_MAX_POINTS + 10 moves → two commits; the second starts at the first’s last point', () => {
    const { overlay, strokes } = setupPen();
    act(() => {
      fireEvent.pointerDown(overlay, { clientX: 0, clientY: 0, button: 0 });
      for (let i = 1; i <= STROKE_MAX_POINTS + 10; i++) {
        // A diagonal so no two points coincide.
        fireEvent.pointerMove(overlay, { clientX: i * 0.01, clientY: i * 0.01, button: 0 });
      }
      fireEvent.pointerUp(overlay, { clientX: (STROKE_MAX_POINTS + 10) * 0.01, clientY: (STROKE_MAX_POINTS + 10) * 0.01, button: 0 });
    });
    const s = strokes();
    expect(s).toHaveLength(2);
    // Part 1 was the first STROKE_MAX_POINTS raw points; part 2 starts where
    // part 1 ends (the shared join point), so the two bboxes touch.
    const b1 = objectBounds(s[0]);
    const b2 = objectBounds(s[1]);
    const joinX = (STROKE_MAX_POINTS - 1) * 0.01;
    const joinY = (STROKE_MAX_POINTS - 1) * 0.01;
    // Part 1 covers from the start to the join; part 2 from the join on.
    expect(b1.x).toBeLessThanOrEqual(0);
    expect(b1.x + b1.width).toBeGreaterThanOrEqual(joinX - 0.005);
    expect(b2.x).toBeLessThanOrEqual(joinX + 0.005);
    expect(b2.x + b2.width).toBeGreaterThanOrEqual((STROKE_MAX_POINTS + 10) * 0.01 - 0.005);
    expect(b1.y + b1.height).toBeGreaterThanOrEqual(joinY - 0.005);
    expect(b2.y).toBeLessThanOrEqual(joinY + 0.005);
  });
});

describe('TC-13: Escape leaves the pen; nothing is created', () => {
  it('Escape then V → tool select; no stroke exists', () => {
    const { overlay, toolHook, strokes } = setupPen();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(toolHook.result.current.tool).toBe('select');
    act(() => {
      fireEvent.keyDown(window, { key: 'v' });
    });
    expect(toolHook.result.current.tool).toBe('select');
    expect(strokes()).toHaveLength(0);
    void overlay;
  });
});

describe('TC-14: options never restyle existing strokes', () => {
  it('change colour after a stroke → the first stays black, the next is red', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const view = render(
      <PenTool camera={camera} color="black" thickness="medium" doc={doc} identityId="user1" />,
    );
    const overlay = view.container.querySelector('[data-testid="pen-tool-overlay"]') as HTMLElement;
    drawStroke(overlay, { x: 100, y: 100 }, { x: 200, y: 120 });

    act(() => {
      view.rerender(
        <PenTool camera={camera} color="red" thickness="medium" doc={doc} identityId="user1" />,
      );
    });
    drawStroke(overlay, { x: 300, y: 300 }, { x: 400, y: 340 });

    const s = objects(doc).filter((o): o is StrokeSnap => o.type === 'stroke');
    expect(s).toHaveLength(2);
    expect(s[0].color).toBe('black');
    expect(s[1].color).toBe('red');
  });
});

describe('PenToolbar: options UI', () => {
  it('shows six colour buttons and three thickness buttons with pressed state', () => {
    const { result } = renderHook(() => usePenOptions());
    const { container } = render(
      <PenToolbar
        color={result.current.color}
        thickness={result.current.thickness}
        onColor={result.current.setColor}
        onThickness={result.current.setThickness}
      />,
    );
    for (const label of ['Black pen', 'Blue pen', 'Red pen', 'Green pen', 'Orange pen', 'Purple pen']) {
      const btn = container.querySelector(`button[aria-label="${label}"]`);
      expect(btn, label).not.toBeNull();
    }
    for (const label of ['Thin', 'Medium', 'Thick']) {
      const btn = container.querySelector(`button[aria-label="${label}"]`);
      expect(btn, label).not.toBeNull();
    }
    // Defaults: black + medium pressed.
    expect(container.querySelector('button[aria-label="Black pen"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('button[aria-label="Medium"]')?.getAttribute('aria-pressed')).toBe('true');

    // Changing the colour updates the pressed state.
    act(() => {
      fireEvent.click(container.querySelector('button[aria-label="Red pen"]') as HTMLElement);
    });
    expect(result.current.color).toBe('red');
  });
});
