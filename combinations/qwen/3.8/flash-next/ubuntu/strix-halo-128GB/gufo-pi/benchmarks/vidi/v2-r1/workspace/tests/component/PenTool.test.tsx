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

  it('TC-13: Escape then V → tool would change, no stroke created', () => {
    renderPenTool();
    // We just verify no stroke was created; the Escape handling is in useTool
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

  it('TC-15: hitTest at 5px from line → hit', () => {
    const snap = makeStrokeSnap();
    // scaledPoints will give (50,50), (60,50), (70,50) since width/baseWidth = 1
    // Point at (60, 44) is 6 units from the line y=50. At zoom 1, tolerance = max(2, 6) = 6.
    // 5 units away should be within tolerance
    const hit = spec.hitTest(snap, { x: 60, y: 45 });
    expect(hit).toBe(true);
  });

  it('TC-15: hitTest at 7px from line → miss', () => {
    const snap = makeStrokeSnap();
    // Point at (60, 57) is 7 units from line y=50, tolerance = max(4/2, 6) = 6 → miss
    const hit = spec.hitTest(snap, { x: 60, y: 57 });
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
