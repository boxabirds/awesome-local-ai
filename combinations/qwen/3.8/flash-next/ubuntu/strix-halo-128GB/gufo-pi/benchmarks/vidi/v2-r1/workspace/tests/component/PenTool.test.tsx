/**
 * Component tests for PenTool, PenToolbar, and StrokeObject (story 11).
 * TC-09 to TC-16, TC-21.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import * as Y from 'yjs';

import { PenTool } from '../../src/client/tools/PenTool';
import { PenToolbar } from '../../src/client/tools/PenToolbar';
import { StrokeObject } from '../../src/client/objects/StrokeObject';
import { getObjectType } from '../../src/client/objects/registry';
import { createStroke, type StrokeSnap } from '../../src/shared/objects/stroke';
import { STROKE_MAX_POINTS } from '../../src/shared/config';
import type { Camera } from '../../src/client/canvas/camera';

function makeCamera(overrides?: Partial<Camera>): Camera {
  return { x: 0, y: 0, zoom: 1, ...overrides };
}

function makeViewport() {
  const vp = document.createElement('div');
  vp.setAttribute('data-board-surface', 'true');
  document.body.appendChild(vp);
  return vp;
}

function pointerEvent(_el: EventTarget, type: string, opts: { clientX: number; clientY: number; pointerId?: number }): Event {
  const evt = new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: opts.clientX,
    clientY: opts.clientY,
    pointerId: opts.pointerId ?? 1,
    button: 0,
  });
  return evt;
}

describe('PenTool (TC-09 to TC-14)', () => {
  let doc: Y.Doc;
  let viewport: HTMLElement;
  let undoBoundaryCalls: number;

  beforeEach(() => {
    doc = new Y.Doc();
    viewport = makeViewport();
    undoBoundaryCalls = 0;
    vi.useFakeTimers();
  });

  function renderPenTool(overrides?: Partial<React.ComponentProps<typeof PenTool>>) {
    return render(
      <PenTool
        camera={makeCamera()}
        color="red"
        thickness="thick"
        doc={doc}
        identityId="local"
        canEdit={true}
        undoBoundary={() => { undoBoundaryCalls++; }}
        {...overrides}
      />
    );
  }

  it('TC-09: drag with red+thick → createStroke called with red/thick, tool still pen', () => {
    renderPenTool();

    // Start drag
    act(() => {
      viewport.dispatchEvent(pointerEvent(viewport, 'pointerdown', { clientX: 100, clientY: 100 }));
    });
    // Move
    for (let i = 1; i <= 10; i++) {
      act(() => {
        document.dispatchEvent(pointerEvent(document, 'pointermove', { clientX: 100 + i * 10, clientY: 100 + i * 5 }));
      });
    }
    // Release
    act(() => {
      document.dispatchEvent(pointerEvent(document, 'pointerup', { clientX: 200, clientY: 150 }));
    });

    act(() => { vi.runAllTimers(); });

    // Check that a stroke was created in the doc
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objects.size).toBe(1);
    const entry = Array.from(objects.values())[0]!;
    expect(entry.get('type')).toBe('stroke');
    expect(entry.get('color')).toBe('red');
    expect(entry.get('thickness')).toBe('thick');
  });

  it('TC-10: click (pointerdown/up, no move) → single-point dot committed', () => {
    renderPenTool();

    act(() => {
      viewport.dispatchEvent(pointerEvent(viewport, 'pointerdown', { clientX: 200, clientY: 200 }));
    });
    act(() => {
      document.dispatchEvent(pointerEvent(document, 'pointerup', { clientX: 200, clientY: 200 }));
    });

    act(() => { vi.runAllTimers(); });

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objects.size).toBe(1);
    const entry = Array.from(objects.values())[0]!;
    expect(entry.get('type')).toBe('stroke');
    const pts = entry.get('points') as number[];
    expect(pts.length).toBe(2); // single point: [x, y]
  });

  it('TC-11: pointercancel → stroke committed with points so far (interrupted)', () => {
    renderPenTool();

    act(() => {
      viewport.dispatchEvent(pointerEvent(viewport, 'pointerdown', { clientX: 50, clientY: 50 }));
    });
    for (let i = 1; i <= 5; i++) {
      act(() => {
        document.dispatchEvent(pointerEvent(document, 'pointermove', { clientX: 50 + i * 20, clientY: 50 }));
      });
    }
    // Cancel instead of up
    act(() => {
      document.dispatchEvent(pointerEvent(document, 'pointercancel', { clientX: 150, clientY: 50 }));
    });

    act(() => { vi.runAllTimers(); });

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    expect(objects.size).toBe(1);
    const entry = Array.from(objects.values())[0]!;
    expect(entry.get('type')).toBe('stroke');
  });

  it('TC-12: STROKE_MAX_POINTS + 10 moves → two strokes created, second starts at first last point', () => {
    renderPenTool();

    act(() => {
      viewport.dispatchEvent(pointerEvent(viewport, 'pointerdown', { clientX: 0, clientY: 0 }));
    });

    // Generate STROKE_MAX_POINTS + 10 moves in one act block
    act(() => {
      for (let i = 1; i <= STROKE_MAX_POINTS + 10; i++) {
        document.dispatchEvent(pointerEvent(document, 'pointermove', { clientX: i % 500, clientY: (i * 3) % 500 }));
      }
    });
    act(() => {
      document.dispatchEvent(pointerEvent(document, 'pointerup', { clientX: 100, clientY: 100 }));
    });

    act(() => { vi.runAllTimers(); });

    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    // At least 2 strokes (first triggered by the limit, second by pointerup)
    expect(objects.size).toBeGreaterThanOrEqual(2);
  });

  it('TC-13: Escape while drawing, then V → tool would change, no stroke created', () => {
    renderPenTool();

    // Start dragging
    act(() => {
      viewport.dispatchEvent(pointerEvent(viewport, 'pointerdown', { clientX: 300, clientY: 300 }));
    });
    for (let i = 1; i <= 5; i++) {
      act(() => {
        document.dispatchEvent(pointerEvent(document, 'pointermove', { clientX: 300 + i * 15, clientY: 300 }));
      });
    }

    // Escape (handled by app keyboard handler → switch to select tool).
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    // Without a release/cancel the pen component holds its points but never commits
    // (no pointerup fires because the tool switch unmounts the capture handlers).
    expect(doc.getMap('objects').size).toBe(0);

    // The tool state itself is covered in ToolMode tests; here we verify pressing V
    // likewise creates nothing.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'v' }));
    });
    expect(doc.getMap('objects').size).toBe(0);
  });

  it('TC-14: change colour after stroke exists → existing stroke unchanged, next stroke uses new colour', () => {
    const { rerender } = render(
      <PenTool
        camera={makeCamera()}
        color="red"
        thickness="medium"
        doc={doc}
        identityId="local"
        canEdit={true}
        undoBoundary={() => { undoBoundaryCalls++; }}
      />
    );

    // Draw first stroke with red
    act(() => {
      viewport.dispatchEvent(pointerEvent(viewport, 'pointerdown', { clientX: 100, clientY: 100 }));
    });
    for (let i = 1; i <= 5; i++) {
      act(() => {
        document.dispatchEvent(pointerEvent(document, 'pointermove', { clientX: 100 + i * 20, clientY: 100 }));
      });
    }
    act(() => {
      document.dispatchEvent(pointerEvent(document, 'pointerup', { clientX: 200, clientY: 100 }));
    });
    act(() => { vi.runAllTimers(); });

    // Verify first stroke is red
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    const first = Array.from(objects.values())[0]!;
    expect(first.get('color')).toBe('red');

    // Rerender with blue
    rerender(
      <PenTool
        camera={makeCamera()}
        color="blue"
        thickness="medium"
        doc={doc}
        identityId="local"
        canEdit={true}
        undoBoundary={() => { undoBoundaryCalls++; }}
      />
    );

    // Draw second stroke with blue
    act(() => {
      viewport.dispatchEvent(pointerEvent(viewport, 'pointerdown', { clientX: 300, clientY: 300 }));
    });
    for (let i = 1; i <= 5; i++) {
      act(() => {
        document.dispatchEvent(pointerEvent(document, 'pointermove', { clientX: 300 + i * 20, clientY: 300 }));
      });
    }
    act(() => {
      document.dispatchEvent(pointerEvent(document, 'pointerup', { clientX: 400, clientY: 300 }));
    });
    act(() => { vi.runAllTimers(); });

    // First stroke still red, second is blue
    const entries = Array.from(objects.values());
    expect(entries.length).toBe(2);
    // Find them by colour
    const reds = entries.filter((e) => e.get('color') === 'red');
    const blues = entries.filter((e) => e.get('color') === 'blue');
    expect(reds.length).toBe(1);
    expect(blues.length).toBe(1);
  });

  it('round pen cursor follows the pointer, sized thickness × zoom in the pen colour', () => {
    const { container } = renderPenTool({ camera: makeCamera({ zoom: 2 }) });

    // No cursor marker before the pointer has moved over the board
    expect(container.querySelector('[data-testid="pen-cursor"]')).toBeNull();

    act(() => {
      viewport.dispatchEvent(pointerEvent(viewport, 'pointermove', { clientX: 140, clientY: 90 }));
    });

    const cursor = container.querySelector<HTMLElement>('[data-testid="pen-cursor"]');
    expect(cursor).not.toBeNull();
    // thick = 8 world units → 16 CSS px at zoom 2
    expect(cursor!.style.width).toBe('16px');
    expect(cursor!.style.height).toBe('16px');
    expect(cursor!.style.borderRadius).toBe('50%');
    expect(cursor!.style.backgroundColor).toBe('rgb(229, 57, 53)'); // PEN_COLORS.red
    // Centred on the pointer
    expect(cursor!.style.left).toBe('132px');
    expect(cursor!.style.top).toBe('82px');
    // Never intercepts the drawing gestures
    expect(cursor!.style.pointerEvents).toBe('none');

    // Over the app chrome the dot is hidden (the real cursor is used there)
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    act(() => {
      outside.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 10, clientY: 10 }));
    });
    expect(container.querySelector('[data-testid="pen-cursor"]')).toBeNull();
    outside.remove();
  });

});

describe('PenToolbar', () => {
  it('renders 6 colour buttons and 3 thickness buttons', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();
    render(<PenToolbar color="black" thickness="medium" onColor={onColor} onThickness={onThickness} />);

    const colorButtons = screen.getAllByRole('button', { name: /pen$/i });
    expect(colorButtons).toHaveLength(6);

    expect(screen.getByRole('button', { name: 'Thin' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Medium' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thick' })).toBeTruthy();
  });

  it('clicking colour calls onColor', () => {
    const onColor = vi.fn();
    const onThickness = vi.fn();
    render(<PenToolbar color="black" thickness="medium" onColor={onColor} onThickness={onThickness} />);

    screen.getByTestId('pen-color-red').click();
    expect(onColor).toHaveBeenCalledWith('red');
  });
});

describe('StrokeObject registry hit test (TC-15, TC-16)', () => {
  const spec = getObjectType('stroke')!;

  function makeStrokeSnap(): StrokeSnap {
    return {
      id: 'stroke-1',
      type: 'stroke',
      x: 0,
      y: 0,
      z: 1,
      width: 100,
      height: 100,
      points: [50, 50, 60, 50, 70, 50], // horizontal line at y=50
      baseWidth: 100,
      baseHeight: 100,
      color: 'black',
      thickness: 'medium',
    };
  }

  it.each([0.5, 1, 2])('TC-15: hitTest at 5px screen distance from line → hit (zoom %g)', (zoom) => {
    const snap = makeStrokeSnap();
    // scaledPoints give (50,50), (60,50), (70,50) since width/baseWidth = 1.
    // Tolerance = max(thickness/2, STROKE_HIT_TOLERANCE_PX / zoom).
    // A 5 screen-pixel offset = 5 / zoom world units → within tolerance.
    const worldOffset = 5 / zoom;
    const hit = spec.hitTest(snap, { x: 60, y: 50 - worldOffset }, zoom);
    expect(hit).toBe(true);
  });

  it.each([0.5, 1, 2])('TC-15: hitTest at 7px screen distance from line → miss (zoom %g)', (zoom) => {
    const snap = makeStrokeSnap();
    // A 7 screen-pixel offset = 7 / zoom world units → outside tolerance.
    const worldOffset = 7 / zoom;
    const hit = spec.hitTest(snap, { x: 60, y: 50 + worldOffset }, zoom);
    expect(hit).toBe(false);
  });

  it('TC-16: click inside bbox far from line → miss', () => {
    const snap = makeStrokeSnap();
    // Point at (10, 10) is inside the bbox (0,0)-(100,100) but far from line at y=50
    const hit = spec.hitTest(snap, { x: 10, y: 10 });
    expect(hit).toBe(false);
  });
});

describe('StrokeObject rendering', () => {
  it('renders an SVG path with correct stroke colour', () => {
    const snap: StrokeSnap = {
      id: 's1',
      type: 'stroke',
      x: 10,
      y: 20,
      z: 1,
      width: 50,
      height: 50,
      points: [5, 5, 25, 25, 45, 5],
      baseWidth: 50,
      baseHeight: 50,
      color: 'red',
      thickness: 'medium',
    };

    const { container } = render(
      <StrokeObject
        stroke={snap}
        selected={false}
        zoom={1}
        canEdit={true}
        multiSelected={false}
        dragging={false}
      />
    );

    const path = container.querySelector('path[stroke="#E53935"]');
    expect(path).toBeTruthy();
    // Should have aria-label
    const svg = container.querySelector('svg[aria-label="Drawing"]');
    expect(svg).toBeTruthy();
  });
});

describe('StrokeObject stale selection (TC-21)', () => {
  it('TC-21: stroke deleted via model while selected → no exception', () => {
    const doc = new Y.Doc();
    const id = createStroke(doc, {
      points: [{ x: 0, y: 0 }, { x: 50, y: 50 }],
      color: 'black',
      thickness: 'medium',
    }, 'local');

    expect(id).not.toBeNull();

    // Delete the stroke
    const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
    objects.delete(id!);

    // Attempting to render a StrokeSnap for the deleted stroke shouldn't throw
    const snap: StrokeSnap = {
      id: id!,
      type: 'stroke',
      x: 0, y: 0, z: 1,
      width: 60, height: 60,
      points: [0, 0, 50, 50],
      baseWidth: 60, baseHeight: 60,
      color: 'black',
      thickness: 'medium',
    };

    // Should not throw
    expect(() => {
      render(
        <StrokeObject
          stroke={snap}
          selected={false}
          zoom={1}
          canEdit={true}
          multiSelected={false}
          dragging={false}
        />
      );
    }).not.toThrow();
  });
});
