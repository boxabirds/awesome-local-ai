/**
 * Story 7 component tests — sel.marquee_ui (TC-20 to TC-22): Shift+drag
 * marquee on empty space, additive selection, pan-vs-marquee disambiguation
 * and pointercancel.
 *
 * jsdom viewport is 1024×768 with the reset camera: world (0,0) renders at
 * screen (512, 384) and zoom is 1, so screen px == world units offset.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as Y from 'yjs';
import { App } from 'src/client/App';
import { boardReady } from './ready';
import { createSticky, snapshot } from 'src/shared/board-model';

function getDoc(): Y.Doc {
  const w = window as unknown as { __vidi6: { doc: Y.Doc } };
  return w.__vidi6.doc;
}

/** Direct doc mutations wrapped in act() so the re-render flushes. */
function makeNote(x: number, y: number, color: 'yellow' | 'orange', text: string): string {
  const doc = getDoc();
  let id = '';
  act(() => {
    id = createSticky(doc, { x, y }, color, text)!;
  });
  return id;
}

/** Shift+drag a marquee from screen a to screen b on the viewport. */
function marqueeDrag(viewport: HTMLElement, a: { x: number; y: number }, b: { x: number; y: number }) {
  fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: a.x, clientY: a.y, shiftKey: true });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2, shiftKey: true });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: b.x, clientY: b.y, shiftKey: true });
  fireEvent.pointerUp(viewport, { pointerId: 1, clientX: b.x, clientY: b.y, shiftKey: true });
}

describe('sel.marquee_ui (component)', () => {
  beforeEach(async () => {
    render(<App />);
    await boardReady();
  });

  it('TC-20: Shift+drag around objects with {a} selected → fully-inside ids added (additive)', async () => {
    // Notes are 200×200 centred on `at`: a → world [-100,-100]–[100,100],
    // b → world [200,-100]–[400,100].
    makeNote(0, 0, 'yellow', 'a');
    makeNote(300, 0, 'orange', 'b');
    const [noteA, noteB] = screen.getAllByTestId('sticky-note');

    const user = userEvent.setup();
    await user.click(noteA);
    expect(noteA.hasAttribute('data-selected')).toBe(true);
    expect(noteB.hasAttribute('data-selected')).toBe(false);

    const viewport = screen.getByTestId('board-viewport');
    // Marquee world rect [150,-150]–[450,150] fully contains b but not a.
    // Screen = world + (512, 384) at zoom 1 → (662, 234) to (962, 534).
    marqueeDrag(viewport, { x: 662, y: 234 }, { x: 962, y: 534 });

    // Additive: a stays selected, b is added.
    expect(noteA.hasAttribute('data-selected')).toBe(true);
    expect(noteB.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('selection-count')).toHaveTextContent('2 selected');
    // The marquee rectangle is gone after release.
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });

  it('TC-21: plain drag on empty space pans; no marquee (negative)', async () => {
    makeNote(0, 0, 'yellow', 'a');

    const viewport = screen.getByTestId('board-viewport');
    const gridBefore = viewport.style.backgroundPosition;

    // No Shift: pan, not marquee.
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 500, clientY: 300 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 560, clientY: 340 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 560, clientY: 340 });

    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    // The board panned (grid background moved).
    expect(viewport.style.backgroundPosition).not.toBe(gridBefore);
    // Nothing was selected by the pan.
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryAllByTestId('sticky-note')[0].hasAttribute('data-selected')).toBe(false);
  });

  it('TC-22: pointercancel mid-marquee → selection unchanged (error path: gesture cancelled)', async () => {
    const doc = getDoc();
    makeNote(0, 0, 'yellow', 'a');
    makeNote(300, 0, 'orange', 'b');
    const [noteA, noteB] = screen.getAllByTestId('sticky-note');

    const user = userEvent.setup();
    await user.click(noteA);

    const viewport = screen.getByTestId('board-viewport');
    // Begin a marquee over b… then cancel before release.
    fireEvent.pointerDown(viewport, { pointerId: 1, button: 0, clientX: 662, clientY: 234, shiftKey: true });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 900, clientY: 450, shiftKey: true });
    expect(screen.getByTestId('marquee-rect')).toBeTruthy(); // drawing in progress

    fireEvent.pointerCancel(viewport, { pointerId: 1, clientX: 900, clientY: 450, shiftKey: true });

    // Cancelled: only the pre-existing selection remains; no bar, rect gone.
    expect(noteA.hasAttribute('data-selected')).toBe(true);
    expect(noteB.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    // The doc is untouched.
    expect(snapshot(doc)).toHaveLength(2);
  });
});
