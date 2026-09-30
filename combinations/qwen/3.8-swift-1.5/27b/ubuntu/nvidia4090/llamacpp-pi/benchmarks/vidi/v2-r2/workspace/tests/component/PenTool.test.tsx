/**
 * Component tests for the pen tool (story 11, pen.tool).
 * TC-09 to TC-14. Real Y.Doc, synthetic pointer events, fake rAF timers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import { render, act } from '@testing-library/react';
import { PenTool } from '../../src/client/tools/PenTool';
import { PenToolbar } from '../../src/client/tools/PenToolbar';
import { usePenOptions } from '../../src/client/tools/usePenOptions';
import { useActiveTool } from '../../src/client/tools/useActiveTool';
import { initDoc, objectSnapshot } from '../../src/shared/board-model';
import { scaledPoints, type StrokeSnap } from '../../src/shared/objects/stroke';
import { STROKE_MAX_POINTS, PEN_THICKNESS_WORLD } from '../../src/shared/config';
import type { Camera } from '../../src/client/canvas/camera';
import { createPointerEvent } from './helpers';

const cam: Camera = { x: -640, y: -400, zoom: 1 };

function keydown(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/**
 * Harness: useActiveTool + usePenOptions + PenTool + PenToolbar, mirroring
 * how Board wires them (the Pen overlay/toolbar render while tool is 'pen').
 */
function PenHarness({ doc }: { doc: Y.Doc }) {
  const active = useActiveTool({});
  const opts = usePenOptions();
  return (
    <>
      <div data-testid="current-tool">{active.tool}</div>
      {active.tool === 'pen' && (
        <PenTool camera={cam} color={opts.color} thickness={opts.thickness} doc={doc} identityId="u1" />
      )}
      {active.tool === 'pen' && (
        <PenToolbar
          color={opts.color}
          thickness={opts.thickness}
          onColor={opts.setColor}
          onThickness={opts.setThickness}
        />
      )}
    </>
  );
}

function strokesOf(doc: Y.Doc): StrokeSnap[] {
  return objectSnapshot(doc).filter((o): o is StrokeSnap => o.type === 'stroke');
}

function click(el: Element | null) {
  if (!el) throw new Error('element not found');
  act(() => {
    el.dispatchEvent(new Event('click', { bubbles: true }));
  });
}

describe('pen.tool (TC-09 to TC-14)', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    vi.useFakeTimers();
    doc = new Y.Doc();
    initDoc(doc);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-09: pointerdown/moves/up with red + thick → one stroke in red/thick; tool stays pen', () => {
    const { container, getByTestId } = render(<PenHarness doc={doc} />);

    keydown('p');
    expect(getByTestId('current-tool').textContent).toBe('pen');

    // Pick red + thick on the pen toolbar.
    click(container.querySelector('[data-testid="pen-color-red"]'));
    click(container.querySelector('[data-testid="pen-thickness-thick"]'));

    const tool = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
    expect(tool).not.toBeNull();

    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, button: 0 }));
    });
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointermove', { clientX: 150, clientY: 120, pointerId: 1 }));
    });
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointermove', { clientX: 200, clientY: 160, pointerId: 1 }));
    });
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerup', { clientX: 200, clientY: 160, pointerId: 1 }));
    });

    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(1);
    expect(strokes[0].color).toBe('red');
    expect(strokes[0].thickness).toBe('thick');
    // A real drag commits a multi-point stroke, not a dot.
    expect(strokes[0].points.length / 2).toBeGreaterThanOrEqual(3);

    // The Pen stays active after the finished stroke.
    expect(getByTestId('current-tool').textContent).toBe('pen');
    // The local preview is cleared after commit.
    expect(container.querySelector('[data-testid="pen-preview"] path')).toBeNull();
  });

  it('a closed loop that ends at its start point → a full stroke, not a dot', () => {
    const { container } = render(<PenHarness doc={doc} />);
    keydown('p');

    const tool = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
    const loop = [
      { x: 100, y: 100 },
      { x: 200, y: 100 },
      { x: 200, y: 200 },
      { x: 100, y: 200 },
      { x: 100, y: 100 }, // back to the start
    ];
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerdown', { clientX: loop[0].x, clientY: loop[0].y, pointerId: 1, button: 0 }));
    });
    for (const p of loop.slice(1)) {
      act(() => {
        tool.dispatchEvent(createPointerEvent('pointermove', { clientX: p.x, clientY: p.y, pointerId: 1 }));
      });
    }
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerup', { clientX: loop[0].x, clientY: loop[0].y, pointerId: 1 }));
    });

    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(1);
    // The loop travelled far from its start point → not a dot.
    expect(strokes[0].points.length / 2).toBeGreaterThanOrEqual(4);
    expect(strokes[0].width).toBeGreaterThan(PEN_THICKNESS_WORLD.medium);
  });

  it('TC-10: pointerdown/up without movement → single-point dot with a thickness-square bbox', () => {
    const { container } = render(<PenHarness doc={doc} />);
    keydown('p');

    const tool = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, button: 0 }));
    });
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerup', { clientX: 100, clientY: 100, pointerId: 1 }));
    });

    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(1);
    const t = PEN_THICKNESS_WORLD.medium; // default thickness
    expect(strokes[0].width).toBe(t);
    expect(strokes[0].height).toBe(t);
    expect(strokes[0].points).toHaveLength(2);
    // The dot's bbox is a thickness square centred on the click
    // (world = screen + camera offset).
    expect(strokes[0].x).toBeCloseTo(100 + cam.x - t / 2, 5);
    expect(strokes[0].y).toBeCloseTo(100 + cam.y - t / 2, 5);
    const pts = scaledPoints(strokes[0]);
    expect(pts[0].x).toBeCloseTo(100 + cam.x, 5);
    expect(pts[0].y).toBeCloseTo(100 + cam.y, 5);
  });

  it('TC-11: pointerdown, moves, pointercancel → stroke committed with the points drawn so far', () => {
    const { container } = render(<PenHarness doc={doc} />);
    keydown('p');

    const tool = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1, button: 0 }));
    });
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointermove', { clientX: 160, clientY: 130, pointerId: 1 }));
    });
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointercancel', { clientX: 160, clientY: 130, pointerId: 1 }));
    });

    // The interrupted stroke is kept, not discarded.
    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(1);
    const pts = scaledPoints(strokes[0]);
    expect(pts.length).toBeGreaterThanOrEqual(2);
    // Ends where the interruption happened.
    expect(pts[pts.length - 1].x).toBeCloseTo(160 + cam.x, 5);
    expect(pts[pts.length - 1].y).toBeCloseTo(130 + cam.y, 5);
    // Preview cleared.
    expect(container.querySelector('[data-testid="pen-preview"] path')).toBeNull();
  });

  it('TC-12: STROKE_MAX_POINTS + 10 moves → two strokes; the second starts at the first’s last point', () => {
    const { container } = render(<PenHarness doc={doc} />);
    keydown('p');

    const tool = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
    act(() => {
      tool.dispatchEvent(createPointerEvent('pointerdown', { clientX: 0, clientY: 0, pointerId: 1, button: 0 }));
    });

    // One synthetic move carrying STROKE_MAX_POINTS + 10 coalesced events.
    const extra = STROKE_MAX_POINTS + 10;
    const coalesced = Array.from({ length: extra }, (_, i) => ({
      clientX: i + 1,
      clientY: (i % 7) * 3,
    }));
    const move = createPointerEvent('pointermove', {
      clientX: coalesced[extra - 1].clientX,
      clientY: coalesced[extra - 1].clientY,
      pointerId: 1,
    });
    Object.defineProperty(move, 'getCoalescedEvents', { value: () => coalesced });
    act(() => {
      tool.dispatchEvent(move);
    });
    act(() => {
      tool.dispatchEvent(
        createPointerEvent('pointerup', {
          clientX: coalesced[extra - 1].clientX,
          clientY: coalesced[extra - 1].clientY,
          pointerId: 1,
        })
      );
    });

    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(2);
    const first = scaledPoints(strokes[0]);
    const second = scaledPoints(strokes[1]);
    // The second stroke starts at the first's last point (seamless join).
    expect(second[0].x).toBeCloseTo(first[first.length - 1].x, 6);
    expect(second[0].y).toBeCloseTo(first[first.length - 1].y, 6);
  });

  it('TC-13: Escape then V → tool becomes select; nothing created (negative)', () => {
    const { container, getByTestId } = render(<PenHarness doc={doc} />);
    keydown('p');
    expect(getByTestId('current-tool').textContent).toBe('pen');

    keydown('Escape');
    keydown('v');
    expect(getByTestId('current-tool').textContent).toBe('select');

    // The pen overlay is gone and no stroke was created.
    expect(container.querySelector('[data-testid="pen-tool"]')).toBeNull();
    expect(objectSnapshot(doc)).toHaveLength(0);
  });

  it('TC-14: changing colour after a stroke exists → existing stroke unchanged; next stroke uses the new colour', () => {
    const { container } = render(<PenHarness doc={doc} />);
    keydown('p');

    const draw = (x0: number, y0: number, x1: number, y1: number) => {
      const tool = container.querySelector('[data-testid="pen-tool"]') as HTMLElement;
      act(() => {
        tool.dispatchEvent(createPointerEvent('pointerdown', { clientX: x0, clientY: y0, pointerId: 1, button: 0 }));
      });
      act(() => {
        tool.dispatchEvent(createPointerEvent('pointermove', { clientX: x1, clientY: y1, pointerId: 1 }));
      });
      act(() => {
        tool.dispatchEvent(createPointerEvent('pointerup', { clientX: x1, clientY: y1, pointerId: 1 }));
      });
    };

    // First stroke with the default (black).
    draw(100, 100, 200, 150);
    expect(strokesOf(doc)).toHaveLength(1);
    expect(strokesOf(doc)[0].color).toBe('black');

    // Switch to red, draw a second stroke.
    click(container.querySelector('[data-testid="pen-color-red"]'));
    draw(300, 300, 400, 350);

    const strokes = strokesOf(doc);
    expect(strokes).toHaveLength(2);
    expect(strokes[0].color).toBe('black'); // existing stroke not restyled
    expect(strokes[1].color).toBe('red'); // new choice used
  });
});

describe('pen.tool options (aria + session state)', () => {
  it('PenToolbar exposes six colour and three thickness buttons with accessible names and pressed state', () => {
    function Harness() {
      const opts = usePenOptions();
      return (
        <PenToolbar
          color={opts.color}
          thickness={opts.thickness}
          onColor={opts.setColor}
          onThickness={opts.setThickness}
        />
      );
    }
    const { getByRole } = render(<Harness />);

    for (const name of ['black', 'blue', 'red', 'green', 'orange', 'purple']) {
      const btn = getByRole('button', { name: `${name} pen` });
      expect(btn).toHaveAttribute('aria-pressed', name === 'black' ? 'true' : 'false');
    }
    expect(getByRole('button', { name: 'Thin' })).toHaveAttribute('aria-pressed', 'false');
    expect(getByRole('button', { name: 'Medium' })).toHaveAttribute('aria-pressed', 'true');
    expect(getByRole('button', { name: 'Thick' })).toHaveAttribute('aria-pressed', 'false');

    // Defaults are black/medium; choosing updates the pressed state.
    click(getByRole('button', { name: 'purple pen' }));
    click(getByRole('button', { name: 'Thick' }));
    expect(getByRole('button', { name: 'purple pen' })).toHaveAttribute('aria-pressed', 'true');
    expect(getByRole('button', { name: 'black pen' })).toHaveAttribute('aria-pressed', 'false');
    expect(getByRole('button', { name: 'Thick' })).toHaveAttribute('aria-pressed', 'true');
  });
});
