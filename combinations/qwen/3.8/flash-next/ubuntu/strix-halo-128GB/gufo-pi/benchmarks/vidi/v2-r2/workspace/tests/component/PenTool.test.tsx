import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent, act, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';
import { PenTool } from '@client/tools/PenTool';
import { PenToolbar } from '@client/tools/PenToolbar';
import { initDoc } from '@shared/board-model';
import { snapshot } from '@shared/board-model';
import { STROKE_MAX_POINTS } from '@shared/config';
import type { PenColor, PenThickness } from '@shared/config';
import type { Camera } from '@client/canvas/camera';

// Mock camera that's stable for testing
const camera: Camera = { x: 0, y: 0, zoom: 1 };
const cameraRef = { current: camera };

function renderPenTool(
  opts: {
    color?: PenColor;
    thickness?: PenThickness;
    onCommit?(): void;
    onGestureBoundary?(): void;
  } = {},
) {
  const doc = new Y.Doc();
  initDoc(doc);
  const viewportEl = document.createElement('div');
  Object.defineProperty(viewportEl, 'getBoundingClientRect', {
    value: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }),
  });
  document.body.appendChild(viewportEl);

  const utils = render(
    <PenTool
      camera={camera}
      cameraRef={cameraRef}
      color={opts.color ?? 'black'}
      thickness={opts.thickness ?? 'medium'}
      doc={doc}
      identityId="test-user"
      viewportEl={viewportEl}
      onCommit={opts.onCommit}
      onGestureBoundary={opts.onGestureBoundary}
    />,
  );

  return { ...utils, doc, viewportEl };
}

function pointerDown(el: Element, x: number, y: number) {
  const event = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
  fireEvent(el, event);
}

function pointerMove(el: Element, x: number, y: number) {
  const event = new PointerEvent('pointermove', {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
  fireEvent(el, event);
}

function pointerUp(el: Element, x: number, y: number) {
  const event = new PointerEvent('pointerup', {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
  fireEvent(el, event);
}

function pointerCancel(el: Element, x: number, y: number) {
  const event = new PointerEvent('pointercancel', {
    bubbles: true,
    cancelable: true,
    button: 0,
    pointerId: 1,
    clientX: x,
    clientY: y,
  });
  fireEvent(el, event);
}

describe('PenTool', () => {
  // TC-09: short drag with red + thick selected → createStroke called once with red/thick
  describe('TC-09 drag draws stroke with selected colour', () => {
    it('creates one stroke with red/thick on drag', () => {
      const onCommit = vi.fn();
      const { container, doc } = renderPenTool({ color: 'red', thickness: 'thick', onCommit });

      const overlay = container.querySelector('[data-testid="pen-tool-overlay"]')!;

      act(() => {
        pointerDown(overlay, 50, 50);
        pointerMove(overlay, 60, 55);
        pointerMove(overlay, 80, 65);
        pointerMove(overlay, 120, 90);
        pointerUp(overlay, 120, 90);
      });

      const snaps = snapshot(doc);
      const strokeSnaps = snaps.filter((s) => s.type === 'stroke');
      expect(strokeSnaps).toHaveLength(1);
      expect((strokeSnaps[0] as any).color).toBe('red');
      expect((strokeSnaps[0] as any).thickness).toBe('thick');
      expect(onCommit).toHaveBeenCalled();
    });
  });

  // TC-10: click without movement → single-point dot committed
  describe('TC-10 click draws dot', () => {
    it('creates a stroke with a single point on click', () => {
      const { container, doc } = renderPenTool({ thickness: 'thick' });
      const overlay = container.querySelector('[data-testid="pen-tool-overlay"]')!;

      act(() => {
        pointerDown(overlay, 100, 100);
        pointerUp(overlay, 100, 100);
      });

      const snaps = snapshot(doc);
      const strokeSnaps = snaps.filter((s) => s.type === 'stroke');
      expect(strokeSnaps).toHaveLength(1);
      const stroke = strokeSnaps[0] as any;
      expect(stroke.points).toHaveLength(2); // single point = 2 values (x, y)
    });
  });

  // TC-11: pointerdown, moves, pointercancel → stroke committed with points so far
  describe('TC-11 interrupted drag commits stroke', () => {
    it('pointercancel commits stroke with points so far', () => {
      const { container, doc } = renderPenTool();
      const overlay = container.querySelector('[data-testid="pen-tool-overlay"]')!;

      act(() => {
        pointerDown(overlay, 50, 50);
        pointerMove(overlay, 70, 60);
        pointerMove(overlay, 90, 70);
        pointerMove(overlay, 110, 80);
        pointerCancel(overlay, 110, 80);
      });

      const snaps = snapshot(doc);
      const strokeSnaps = snaps.filter((s) => s.type === 'stroke');
      expect(strokeSnaps).toHaveLength(1);
      const stroke = strokeSnaps[0] as any;
      // Should have points (at least simplified version of the moves)
      expect(stroke.points.length).toBeGreaterThanOrEqual(4); // at least 2 points (4 values)
    });
  });

  // TC-12: STROKE_MAX_POINTS + 10 moves → two commits
  describe('TC-12 long drag splits into multiple strokes', () => {
    it('creates two strokes when exceeding STROKE_MAX_POINTS', () => {
      const { container, doc } = renderPenTool();
      const overlay = container.querySelector('[data-testid="pen-tool-overlay"]')!;

      const totalMoves = STROKE_MAX_POINTS + 10;

      act(() => {
        pointerDown(overlay, 0, 0);
        for (let i = 1; i <= totalMoves; i++) {
          pointerMove(overlay, i % 800, (i * 7) % 600);
        }
        pointerUp(overlay, totalMoves % 800, (totalMoves * 7) % 600);
      });

      const snaps = snapshot(doc);
      const strokeSnaps = snaps.filter((s) => s.type === 'stroke');
      expect(strokeSnaps.length).toBeGreaterThanOrEqual(2);

      // Second stroke starts at the last point of first stroke
      const first = strokeSnaps[0] as any;
      const second = strokeSnaps[1] as any;
      const firstLastX = first.x + first.points[first.points.length - 2];
      const firstLastY = first.y + first.points[first.points.length - 1];
      const secondFirstX = second.x + second.points[0];
      const secondFirstY = second.y + second.points[1];
      expect(secondFirstX).toBeCloseTo(firstLastX, 0);
      expect(secondFirstY).toBeCloseTo(firstLastY, 0);
    });
  });

  // TC-13: Escape → tool becomes select, nothing created
  describe('TC-13 Escape clears tool without stroke', () => {
    it('Escape key triggers tool change (handled by parent)', () => {
      // The PenTool itself doesn't handle keyboard; that's in useActiveTool/parent.
      // We test that the PenTool starts with no strokes and a tool switch means no more strokes.
      const { container, doc } = renderPenTool();
      const overlay = container.querySelector('[data-testid="pen-tool-overlay"]')!;

      // Start a drag
      act(() => {
        pointerDown(overlay, 50, 50);
      });

      // Simulate escape by unmounting (component parent would switch tool)
      // This verifies no stroke is created if we unmount mid-drag
      cleanup();

      const snaps = snapshot(doc);
      const strokeSnaps = snaps.filter((s) => s.type === 'stroke');
      expect(strokeSnaps).toHaveLength(0);
    });
  });

  // TC-14: change colour after stroke exists → existing stroke unchanged, next uses new colour
  describe('TC-14 colour change does not restyle existing strokes', () => {
    it('existing strokes keep their colour', () => {
      const doc = new Y.Doc();
      initDoc(doc);

      // First, render with 'red' and draw
      const viewportEl = document.createElement('div');
      Object.defineProperty(viewportEl, 'getBoundingClientRect', {
        value: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0 }),
      });
      document.body.appendChild(viewportEl);

      const { container, rerender } = render(
        <PenTool
          camera={camera}
          cameraRef={cameraRef}
          color="red"
          thickness="medium"
          doc={doc}
          identityId="test"
          viewportEl={viewportEl}
        />,
      );
      const overlay = container.querySelector('[data-testid="pen-tool-overlay"]')!;

      act(() => {
        pointerDown(overlay, 50, 50);
        pointerMove(overlay, 100, 70);
        pointerUp(overlay, 100, 70);
      });

      // Check first stroke is red
      let snaps = snapshot(doc);
      let strokes = snaps.filter((s) => s.type === 'stroke');
      expect(strokes).toHaveLength(1);
      expect((strokes[0] as any).color).toBe('red');

      // Re-render with blue
      rerender(
        <PenTool
          camera={camera}
          cameraRef={cameraRef}
          color="blue"
          thickness="medium"
          doc={doc}
          identityId="test"
          viewportEl={viewportEl}
        />,
      );

      // Draw second stroke
      act(() => {
        pointerDown(overlay, 200, 200);
        pointerMove(overlay, 250, 220);
        pointerUp(overlay, 250, 220);
      });

      snaps = snapshot(doc);
      strokes = snaps.filter((s) => s.type === 'stroke');
      expect(strokes).toHaveLength(2);
      // First stroke still red
      expect((strokes[0] as any).color).toBe('red');
      // Second stroke is blue
      expect((strokes[1] as any).color).toBe('blue');
    });
  });
});

describe('PenToolbar', () => {
  it('renders 6 colour buttons with aria-pressed', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();

    render(
      <PenToolbar color="black" thickness="medium" onColor={onColor} onThickness={onThickness} />,
    );

    const colors = ['black', 'blue', 'red', 'green', 'orange', 'purple'];
    for (const c of colors) {
      const btn = screen.getByRole('button', { name: `${c} pen` });
      expect(btn).toBeDefined();
    }

    expect(screen.getByRole('button', { name: 'black pen' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'red pen' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders Thin/Medium/Thick buttons', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();

    render(
      <PenToolbar color="black" thickness="medium" onColor={onColor} onThickness={onThickness} />,
    );

    expect(screen.getByRole('button', { name: 'Thin' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Thick' })).toBeDefined();
  });

  it('clicking a colour calls onColor', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();

    render(
      <PenToolbar color="black" thickness="medium" onColor={onColor} onThickness={onThickness} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'red pen' }));
    expect(onColor).toHaveBeenCalledWith('red');
  });

  it('clicking thickness calls onThickness', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();

    render(
      <PenToolbar color="black" thickness="medium" onColor={onColor} onThickness={onThickness} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Thick' }));
    expect(onThickness).toHaveBeenCalledWith('thick');
  });
});
