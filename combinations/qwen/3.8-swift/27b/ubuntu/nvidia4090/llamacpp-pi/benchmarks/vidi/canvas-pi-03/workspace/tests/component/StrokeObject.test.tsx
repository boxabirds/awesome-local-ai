/**
 * Story 11 component tests — stroke rendering (TC-15), line-based selection
 * semantics (TC-16) and delete-while-selected (TC-21).
 *
 * jsdom assumptions (as in the other component tests): a 1024x768 window,
 * the initial camera is resetCamera(viewport), so world (0,0) sits at screen
 * (512,384) and world = screen - (512,384) at zoom 1.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { allObjects, deleteObjects } from 'src/shared/board-model';
import { createStroke, getStroke } from 'src/shared/objects/stroke';
import { hitObjectAt } from 'src/client/objects/registry';
import { PEN_COLORS, STICKY_SIZE_WORLD } from 'src/shared/config';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

describe('stroke.ui (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-15: a stroke renders a smooth path (d from M…Q), round caps, the PEN_COLORS colour, the thickness width and fill none; announced as "Drawing"', () => {
    const doc = getDoc();

    // Create a blue thick stroke directly in the model: a shallow "U".
    let id: string | null = null;
    act(() => {
      id = createStroke(
        doc,
        {
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 40 },
            { x: 100, y: 0 },
          ],
          color: 'blue',
          thickness: 'thick',
        },
        'test',
      );
    });
    expect(id).not.toBeNull();

    // The stroke object renders ...
    const el = screen.getByTestId('stroke-object');
    expect(el).toHaveAttribute('data-note-id', id!);
    // ... and is announced as "Drawing".
    expect(el).toHaveAttribute('aria-label', 'Drawing');

    // The visible path: smooth (M … Q …), round caps/joins, the blue colour,
    // the thickness in world units, fill none.
    const path = screen.getByTestId('stroke-path');
    const d = path.getAttribute('d')!;
    expect(d.startsWith('M')).toBe(true);
    expect(d).toContain('Q');
    expect(path.getAttribute('fill')).toBe('none');
    expect(path.getAttribute('stroke')).toBe(PEN_COLORS.blue);
    expect(path.getAttribute('stroke-width')).toBe('8');
    expect(path.getAttribute('stroke-linecap')).toBe('round');
    expect(path.getAttribute('stroke-linejoin')).toBe('round');
    // The path ends at the last point (bbox-relative).
    const s = getStroke(doc, id!)!;
    expect(d.endsWith(`L ${100 - s.x} ${0 - s.y}`)).toBe(true);
  });

  it('TC-16: a click inside the stroke bbox far from the line over a sticky selects the sticky (line-distance hit test)', async () => {
    const doc = getDoc();

    // A sticky centred on world (0,0) spans [-100,100]².
    const user = userEvent.setup();
    await user.keyboard('n');
    // End editing so the board renders the plain note.
    fireEvent.keyDown(screen.getByTestId('sticky-note-textarea'), { key: 'Escape' });
    const sticky = allObjects(doc).find((o) => o.type === 'sticky')!;
    expect(sticky.x).toBeCloseTo(-STICKY_SIZE_WORLD / 2);

    // A diagonal stroke crossing the sticky's bbox: world (-150,-150) →
    // (150,150); its bbox (-152,-152)–(152,152) fully covers the sticky.
    const strokeId = createStroke(
      doc,
      {
        points: [
          { x: -150, y: -150 },
          { x: 150, y: 150 },
        ],
        color: 'black',
        thickness: 'medium',
      },
      'test',
    )!;

    // A point on the line (and inside the sticky): the topmost STROKE wins.
    expect(hitObjectAt(doc, { x: 0, y: 0 }, 1)).toBe(strokeId);
    // A point inside the stroke bbox but 70 world units from the line (and
    // inside the sticky): the stroke is missed, the sticky is hit.
    expect(hitObjectAt(doc, { x: 100, y: 0 }, 1)).toBe(sticky.id);
    // Far outside both: nothing.
    expect(hitObjectAt(doc, { x: 400, y: 400 }, 1)).toBeNull();
  });

  it('TC-21: deleting a selected stroke clears the selection and renders without exceptions', async () => {
    const doc = getDoc();

    // Draw a stroke with the pen tool.
    const user = userEvent.setup();
    await user.keyboard('p');
    const layer = screen.getByTestId('pen-tool-layer');
    fireEvent.pointerDown(layer, { button: 0, clientX: 612, clientY: 434 });
    fireEvent.pointerMove(layer, { clientX: 712, clientY: 494 });
    fireEvent.pointerMove(layer, { clientX: 682, clientY: 564 });
    fireEvent.pointerUp(layer, { button: 0, clientX: 812, clientY: 554 });
    const [stroke] = allObjects(doc);
    expect(stroke.type).toBe('stroke');

    // Select it: press the (wide invisible) hit path.
    const strokeEl = screen.getByTestId('stroke-object');
    const hitPath = strokeEl.querySelector('path') as SVGPathElement;
    fireEvent.pointerDown(hitPath, { button: 0, clientX: 700, clientY: 500 });
    expect(strokeEl).toHaveAttribute('data-selected');

    // Delete it through the model while selected: no exception, the object
    // and the selection are gone.
    act(() => {
      deleteObjects(doc, [stroke.id]);
    });
    expect(screen.queryByTestId('stroke-object')).toBeNull();
    expect(allObjects(doc)).toHaveLength(0);
    // The selection overlay (handles / bounding box) is gone too.
    expect(screen.queryByTestId('selection-overlay')).toBeNull();
  });
});
