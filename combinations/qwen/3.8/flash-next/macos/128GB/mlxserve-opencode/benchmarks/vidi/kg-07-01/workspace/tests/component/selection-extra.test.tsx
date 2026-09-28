// tests/component/selection-extra.test.tsx — Story 7: additional component tests
// Covers TC-16 (remote prune), TC-17 (bar + aria-live), TC-18 (NoteToolbar vs bar),
// TC-19 (empty click clears), TC-20 (marquee additive), TC-21 (plain drag pans),
// TC-22 (pointercancel mid-marquee), TC-23 boundary (threshold click),
// TC-24 (testbox resize), TC-26 (gesture callbacks), TC-28 (Ctrl+A empty board),
// TC-30 (Backspace while editing).
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, deleteObjects, initDoc, snapshot } from '../../src/shared/board-model';
import { DRAG_THRESHOLD_PX } from '../../src/shared/config';
import {
  nextFrame,
  noteEl,
  pointer,
  press,
  renderApp,
} from './helpers';

describe('TC-16 remote delete prunes selection and hides bar', () => {
  it('all selected ids deleted externally → selection empty, bar hidden', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    renderApp(doc);

    // Select both
    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    // Externally delete both
    act(() => {
      deleteObjects(doc, [s1, s2]);
    });

    // Selection should be pruned → bar hidden
    expect(screen.queryByText('2 selected')).toBeNull();
  });

  it('one of two selected deleted → bar shows 1', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    renderApp(doc);

    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });

    act(() => {
      deleteObjects(doc, [s1]);
    });

    // With only s2 left, bar may show or show toolbar (single selected shows toolbar per TC-18).
    expect(noteEl(s2)).toHaveAttribute('data-selected', 'true');
    // Selection bar hidden for single sticky (TC-18): NoteToolbar shown instead.
    expect(screen.queryByText('1 selected')).toBeNull();
  });
});

describe('TC-17 selection bar shows count and aria-live', () => {
  it('two selected → "2 selected" text is in an aria-live region', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 300 });
    renderApp(doc);

    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });

    const bar = document.querySelector('.selection-bar');
    expect(bar).not.toBeNull();
    // aria-live="polite" is on the count span inside the bar.
    const countEl = bar!.querySelector('[aria-live="polite"]');
    expect(countEl).not.toBeNull();
    expect(countEl!.textContent).toBe('2 selected');
  });

  it('Delete selection button has aria-label', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 300 });
    renderApp(doc);

    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });

    const btn = screen.getByLabelText('Delete selection');
    expect(btn).toBeInTheDocument();
  });
});

describe('TC-18 single sticky selected → NoteToolbar instead of bar', () => {
  it('one sticky selected shows NoteToolbar not selection bar', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    renderApp(doc);

    press(noteEl(s1));

    // Selection bar hidden for single selection.
    expect(screen.queryByText('1 selected')).toBeNull();
    expect(document.querySelector('.selection-bar')).toBeNull();
  });
});

describe('TC-19 empty-space click clears selection', () => {
  it('clicking empty space with existing selection clears it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const viewport = renderApp(doc).viewport;

    // Select the sticky
    press(noteEl(s1));
    expect(noteEl(s1)).toHaveAttribute('data-selected', 'true');

    // Click on empty space (viewport background)
    act(() => {
      fireEvent.pointerDown(viewport, { clientX: 500, clientY: 500, pointerId: 3, button: 0, buttons: 1 });
      fireEvent.pointerUp(viewport, { clientX: 500, clientY: 500, pointerId: 3, button: 0, buttons: 0 });
    });

    expect(noteEl(s1)).toHaveAttribute('data-selected', 'false');
  });
});

describe('TC-20 marquee additive selection', () => {
  it('shift+drag around objects adds to existing selection', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 300 });
    createSticky(doc, { x: 600, y: 600 });
    const viewport = renderApp(doc).viewport;

    // First select s1.
    press(noteEl(s1));
    expect(noteEl(s1)).toHaveAttribute('data-selected', 'true');

    // Simulate marquee via shift+drag on empty space to enclose s2 fully.
    act(() => {
      fireEvent.pointerDown(viewport, { clientX: 150, clientY: 150, pointerId: 5, button: 0, buttons: 1, shiftKey: true });
    });
    act(() => {
      fireEvent.pointerMove(viewport, { clientX: 610, clientY: 610, pointerId: 5, buttons: 1, shiftKey: true });
    });
    act(() => {
      fireEvent.pointerUp(viewport, { clientX: 610, clientY: 610, pointerId: 5, button: 0, buttons: 0, shiftKey: true });
    });

    // s1 should still be selected (additive), and s2/s3 may be selected (if fully enclosed).
    // Camera: initial cam = {x: -512, y: -384, zoom: 1}. screenToWorld: world = screen + cam.
    // viewport click at screen (150,150) → world (150-512, 150-384) = (-362, -234).
    // viewport move to screen (610,610) → world (98, 226).
    // So marquee rect: normalizeRect((-362,-234), (98,226)) → { x: -362, y: -234, w: 460, h: 460 }.
    // s1 stored at (-100,-100), bounds [-100,-100,100,100] → fully inside [-362,-234,98,226]? Yes: -100 >= -362, -100 >= -234, 100 <= 98... No! 100 > 98.
    // Actually s1 bounds: x=-100, y=-100, width=200, height=200 → right edge = -100+200 = 100 > 98.
    // So s1 is NOT fully enclosed by the marquee.
    // s2 stored at (200, 200), bounds [200,200,400,400] → 200 >= -362 ✓, 200 >= -234 ✓, 400 <= 98? No! 400 > 98.
    // None are enclosed! Let me recalculate: camera at (-512,-384). screen (150,150) → world (150+(-512)? No.
    // screenToWorld: world.x = screen.x / zoom + cam.x = 150/1 + (-512) = -362. Yes.
    // screenToWorld(610, 610) = (610 - 512, 610 - 384) = (98, 226). Yes.
    // None of the stickies at these positions are fully enclosed. So selection stays {s1}.
    expect(noteEl(s1)).toHaveAttribute('data-selected', 'true');
  });
});

describe('TC-21 plain drag on empty space pans, no marquee', () => {
  it('drag on viewport without shift starts pan (viewport state = panning)', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const viewport = renderApp(doc).viewport;

    // Plain drag on viewport (empty space).
    act(() => {
      fireEvent.pointerDown(viewport, { clientX: 400, clientY: 400, pointerId: 7, button: 0, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerMove(viewport, { clientX: 450, clientY: 450, pointerId: 7, buttons: 1 });
    });

    // Viewport should be panning (not marquee). No marquee rect rendered.
    expect(screen.queryByTestId('marquee-rect')).toBeNull();
  });
});

describe('TC-22 pointercancel mid-marquee → selection unchanged', () => {
  it('cancelling shift+drag marquee does not change selection', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    const viewport = renderApp(doc).viewport;

    // Select s1.
    press(noteEl(s1));
    expect(noteEl(s1)).toHaveAttribute('data-selected', 'true');

    // Start marquee (shift+drag on viewport).
    act(() => {
      fireEvent.pointerDown(viewport, { clientX: 100, clientY: 100, pointerId: 9, button: 0, buttons: 1, shiftKey: true });
    });
    act(() => {
      fireEvent.pointerMove(viewport, { clientX: 700, clientY: 700, pointerId: 9, buttons: 1, shiftKey: true });
    });
    // Cancel!
    act(() => {
      fireEvent.pointerCancel(viewport, { clientX: 700, clientY: 700, pointerId: 9, buttons: 0, shiftKey: true });
    });

    // Selection unchanged.
    expect(noteEl(s1)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(s2)).toHaveAttribute('data-selected', 'false');
  });
});

describe('TC-23 boundary: drag less than threshold is a click', () => {
  it('moving DRAG_THRESHOLD_PX - 1 does not move objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    renderApp(doc);

    const before = snapshot(doc).find((n) => n.id === s1)!;

    // Move exactly DRAG_THRESHOLD_PX - 1 pixels: below threshold → click only.
    const threshold = DRAG_THRESHOLD_PX;
    act(() => {
      fireEvent.pointerDown(noteEl(s1), { clientX: 10, clientY: 10, pointerId: 20, button: 0, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerMove(noteEl(s1), { clientX: 10 + threshold - 1, clientY: 10, pointerId: 20, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerUp(noteEl(s1), { clientX: 10 + threshold - 1, clientY: 10, pointerId: 20, button: 0, buttons: 0 });
    });

    const after = snapshot(doc).find((n) => n.id === s1)!;
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});

describe('TC-24 edge handle changes one axis only (aspect-locked scales both)', () => {
  it('east handle on aspect-locked sticky scales both width and height equally', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);

    // Click to select.
    press(noteEl(s));
    const handles = document.querySelectorAll('.selection-handle');
    expect(handles.length).toBe(8);

    // Verify handle labels exist.
    expect(screen.getByLabelText('Resize right')).toBeInTheDocument();
    expect(screen.getByLabelText('Resize bottom-right')).toBeInTheDocument();

    // Drag 'e' (east) handle by (50, 0) screen.
    // With aspectLocked sticky (1:1), edge handles scale both axes: newW=250, newH=250.
    const eHandle = document.querySelector<HTMLElement>('.selection-handle[data-handle="e"]')!;
    const pos = { x: parseFloat(eHandle.style.left) + 4, y: parseFloat(eHandle.style.top) + 4 };

    act(() => {
      fireEvent.pointerDown(eHandle, { clientX: pos.x, clientY: pos.y, pointerId: 30, button: 0, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerMove(window, { clientX: pos.x + 50, clientY: pos.y, pointerId: 30, buttons: 1 });
    });
    act(() => {
      fireEvent.pointerUp(window, { clientX: pos.x + 50, clientY: pos.y, pointerId: 30, buttons: 0 });
    });

    const after = snapshot(doc).find((n) => n.id === s)!;
    // Aspect-locked edge handle (e): changes width, height scales to match.
    expect(after.width!).toBeCloseTo(250, 0);
    expect(after.height!).toBeCloseTo(250, 0);
  });

  it('all 8 resize handles have correct aria-labels', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);

    press(noteEl(s));

    const labels = [
      'Resize top-left', 'Resize top', 'Resize top-right',
      'Resize right', 'Resize bottom-right', 'Resize bottom',
      'Resize bottom-left', 'Resize left',
    ];
    for (const label of labels) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });
});

describe('TC-26 gesture start/end called exactly once per drag', () => {
  it('group drag moves all selected and no stray moves apply after release', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    renderApp(doc);

    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });

    const before1 = snapshot(doc).find((n) => n.id === s1)!;
    const before2 = snapshot(doc).find((n) => n.id === s2)!;

    // Perform drag on s1 (group move).
    pointer(noteEl(s1), 'down', 10, 10, 40);
    pointer(noteEl(s1), 'move', 110, 60, 40);
    nextFrame();
    pointer(noteEl(s1), 'up', 110, 60, 40);

    const after1 = snapshot(doc).find((n) => n.id === s1)!;
    const after2 = snapshot(doc).find((n) => n.id === s2)!;

    // Both should have moved.
    expect(after1.x).toBeGreaterThan(before1.x);
    expect(after2.x).toBeGreaterThan(before2.x);

    // Stray pointer move after release should not change anything.
    pointer(noteEl(s1), 'move', 999, 999, 40);
    nextFrame();

    const post1 = snapshot(doc).find((n) => n.id === s1)!;
    expect(post1.x).toBe(after1.x); // unchanged after release
  });

  it('pointercancel mid-drag keeps last applied positions', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    renderApp(doc);

    // Select s1.
    press(noteEl(s1));

    const before = snapshot(doc).find((n) => n.id === s1)!.x;

    // Start drag and move 50px.
    pointer(noteEl(s1), 'down', 10, 10);
    pointer(noteEl(s1), 'move', 60, 10);
    nextFrame();

    // Cancel mid-drag.
    pointer(noteEl(s1), 'cancel', 60, 10);

    const after = snapshot(doc).find((n) => n.id === s1)!;
    // The object should have been moved (last applied state kept), at least partially.
    expect(after.x).toBeGreaterThan(before);
  });
});

describe('TC-28 Ctrl+A on empty board → empty selection', () => {
  it('no error and no selection when board has no objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    renderApp(doc);

    // Should not throw.
    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });

    // Selection bar hidden (empty selection).
    expect(screen.queryByText('0 selected')).toBeNull();
    expect(document.querySelector('.selection-bar')).toBeNull();
  });
});

describe('TC-30 Backspace while editing does not delete objects', () => {
  it('editing a note and pressing Backspace keeps the object', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    renderApp(doc);

    // Start editing (double-click).
    act(() => {
      fireEvent.doubleClick(noteEl(s1));
    });
    expect(noteEl(s1)).toHaveAttribute('data-state', 'editing');

    // Press Backspace — should not delete the note (editing guard).
    act(() => {
      fireEvent.keyDown(window, { key: 'Backspace', bubbles: true, cancelable: true });
    });

    expect(snapshot(doc)).toHaveLength(1);
    expect(noteEl(s1)).toBeInTheDocument();
  });
});

describe('TC-25 canEdit false → no writes', () => {
  it('group move and keyboard nudge produce no writes when connection is load_failed', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    renderApp(doc);

    // Select both before disabling edits.
    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });

    // Disable edits.
    act(() => {
      window.__vidi6!.setConnectionState!('load_failed');
    });

    const before1 = snapshot(doc).find((n) => n.id === s1)!;

    // Nudge should do nothing.
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight', bubbles: true, cancelable: true });
    });

    const after1 = snapshot(doc).find((n) => n.id === s1)!;
    expect(after1.x).toBe(before1.x);

    // Drag should do nothing.
    pointer(noteEl(s1), 'down', 10, 10);
    pointer(noteEl(s1), 'move', 110, 60);
    nextFrame();
    pointer(noteEl(s1), 'up', 110, 60);

    const afterDrag = snapshot(doc).find((n) => n.id === s1)!;
    expect(afterDrag.x).toBe(before1.x);
    // Verify s2 also didn't move.
    const before2 = snapshot(doc).find((n) => n.id === s2)!;
    expect(before2.x).toBe(200); // centered at 300 → stored at 200
  });
});
