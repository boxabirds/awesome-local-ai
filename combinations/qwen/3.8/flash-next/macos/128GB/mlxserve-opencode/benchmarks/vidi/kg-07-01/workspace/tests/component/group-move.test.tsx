// tests/component/group-move.test.tsx — Story 7 multi-select, group move, keyboard nudge, delete
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, initDoc, snapshot } from '../../src/shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '../../src/shared/config';
import {
  nextFrame,
  noteEl,
  pointer,
  press,
  renderApp,
} from './helpers';

describe('TC-22 shift-click adds without panning', () => {
  it('shift-click on a note adds it to selection, board does not pan', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    const { viewport } = renderApp(doc);

    // Select s1 normally
    press(noteEl(s1));
    expect(noteEl(s1)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(s2)).toHaveAttribute('data-selected', 'false');

    // Shift-click s2
    act(() => {
      fireEvent.pointerDown(noteEl(s2), { clientX: 310, clientY: 310, pointerId: 2, button: 0, buttons: 1, shiftKey: true });
      fireEvent.pointerUp(noteEl(s2), { clientX: 310, clientY: 310, pointerId: 2, button: 0, buttons: 0, shiftKey: true });
    });

    expect(noteEl(s1)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(s2)).toHaveAttribute('data-selected', 'true');
    // Camera unchanged (board did not pan)
    expect(viewport).toHaveAttribute('data-state', 'idle');
  });

  it('shift-click on selected note removes it', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    renderApp(doc);

    press(noteEl(s1));
    act(() => {
      fireEvent.pointerDown(noteEl(s2), { clientX: 310, clientY: 310, pointerId: 2, button: 0, buttons: 1, shiftKey: true });
      fireEvent.pointerUp(noteEl(s2), { clientX: 310, clientY: 310, pointerId: 2, button: 0, buttons: 0, shiftKey: true });
    });
    // Both selected; toggle s2 off
    act(() => {
      fireEvent.pointerDown(noteEl(s2), { clientX: 310, clientY: 310, pointerId: 3, button: 0, buttons: 1, shiftKey: true });
      fireEvent.pointerUp(noteEl(s2), { clientX: 310, clientY: 310, pointerId: 3, button: 0, buttons: 0, shiftKey: true });
    });
    expect(noteEl(s1)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(s2)).toHaveAttribute('data-selected', 'false');
  });
});

describe('TC-23 marquee then single click → only clicked', () => {
  it('single click after multi-select replaces selection with only clicked', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    const s3 = createSticky(doc, { x: 600, y: 600 });
    renderApp(doc);

    // Select all
    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });
    expect(noteEl(s1)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(s2)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(s3)).toHaveAttribute('data-selected', 'true');

    // Click on s2 only (not shift)
    press(noteEl(s2), 310, 310);
    expect(noteEl(s1)).toHaveAttribute('data-selected', 'false');
    expect(noteEl(s2)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(s3)).toHaveAttribute('data-selected', 'false');
  });
});

describe('TC-24 group move applies one transaction', () => {
  it('dragging a multi-selected group moves all by same amount', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    renderApp(doc);

    // Select all via Ctrl+A
    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });

    const before1 = snapshot(doc).find((n) => n.id === s1)!;
    const before2 = snapshot(doc).find((n) => n.id === s2)!;

    // Drag from s1
    pointer(noteEl(s1), 'down', 10, 10);
    pointer(noteEl(s1), 'move', 100, 50);
    nextFrame();
    pointer(noteEl(s1), 'up', 100, 50);

    const after1 = snapshot(doc).find((n) => n.id === s1)!;
    const after2 = snapshot(doc).find((n) => n.id === s2)!;

    // Both should have moved by (90, 40) in world coords (camera zoom=1)
    expect(after1.x - before1.x).toBeCloseTo(90);
    expect(after1.y - before1.y).toBeCloseTo(40);
    expect(after2.x - before2.x).toBeCloseTo(90);
    expect(after2.y - before2.y).toBeCloseTo(40);
  });
});

describe('TC-26 keyboard arrows nudge all; Shift+arrow uses NUDGE_LARGE_STEP_WORLD', () => {
  it('ArrowRight nudges all selected by NUDGE_STEP_WORLD', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 100, y: 100 });
    const s2 = createSticky(doc, { x: 400, y: 400 });
    renderApp(doc);

    const before1 = snapshot(doc).find((n) => n.id === s1)!;
    const before2 = snapshot(doc).find((n) => n.id === s2)!;

    // Select all
    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });

    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight', bubbles: true, cancelable: true });
    });

    const a1 = snapshot(doc).find((n) => n.id === s1)!;
    const a2 = snapshot(doc).find((n) => n.id === s2)!;
    expect(a1.x - before1.x).toBeCloseTo(NUDGE_STEP_WORLD);
    expect(a2.x - before2.x).toBeCloseTo(NUDGE_STEP_WORLD);
    expect(a1.y).toBeCloseTo(before1.y);
    expect(a2.y).toBeCloseTo(before2.y);
  });

  it('Shift+ArrowRight nudges by NUDGE_LARGE_STEP_WORLD', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 100, y: 100 });
    const s2 = createSticky(doc, { x: 400, y: 400 });
    renderApp(doc);

    const before1 = snapshot(doc).find((n) => n.id === s1)!;
    const before2 = snapshot(doc).find((n) => n.id === s2)!;

    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true });
    });

    const a1 = snapshot(doc).find((n) => n.id === s1)!;
    const a2 = snapshot(doc).find((n) => n.id === s2)!;
    expect(a1.x - before1.x).toBeCloseTo(NUDGE_LARGE_STEP_WORLD);
    expect(a2.x - before2.x).toBeCloseTo(NUDGE_LARGE_STEP_WORLD);
  });

  it('arrow keys are ignored when editing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 100, y: 100 });
    renderApp(doc);

    press(noteEl(s1));
    // Start editing
    act(() => {
      fireEvent.doubleClick(noteEl(s1));
    });
    expect(noteEl(s1)).toHaveAttribute('data-state', 'editing');

    const before = snapshot(doc).find((n) => n.id === s1)!;
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight', bubbles: true, cancelable: true });
    });
    const a1 = snapshot(doc).find((n) => n.id === s1)!;
    expect(a1.x).toBeCloseTo(before.x); // unchanged
  });
});

describe('TC-27 single Delete; selection cleared', () => {
  it('Delete key removes selected objects and clears selection', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    const s3 = createSticky(doc, { x: 600, y: 600 });
    renderApp(doc);

    // Select only s1 and s2 (click s1, shift-click s2)
    press(noteEl(s1));
    act(() => {
      fireEvent.pointerDown(noteEl(s2), { clientX: 310, clientY: 310, pointerId: 2, button: 0, buttons: 1, shiftKey: true });
      fireEvent.pointerUp(noteEl(s2), { clientX: 310, clientY: 310, pointerId: 2, button: 0, buttons: 0, shiftKey: true });
    });
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    // Delete
    act(() => {
      fireEvent.keyDown(window, { key: 'Delete', bubbles: true, cancelable: true });
    });

    expect(snapshot(doc)).toHaveLength(1);
    expect(noteEl(s3)).toHaveAttribute('data-selected', 'false');
  });

  it('Delete with nothing selected does nothing', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    renderApp(doc);

    act(() => {
      fireEvent.keyDown(window, { key: 'Delete', bubbles: true, cancelable: true });
    });
    expect(snapshot(doc)).toHaveLength(1);
  });
});

describe('TC-28 mixed group move via keyboard', () => {
  it('group nudge moves all selected notes', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 300 });
    createSticky(doc, { x: 600, y: 600 });
    renderApp(doc);

    // Select all
    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });

    const before = snapshot(doc).map((n) => ({ id: n.id, x: n.x }));

    // Nudge right
    act(() => {
      fireEvent.keyDown(window, { key: 'ArrowRight', bubbles: true, cancelable: true });
    });

    const after = snapshot(doc);
    for (let i = 0; i < before.length; i++) {
      expect(after[i].x - before[i].x).toBeCloseTo(NUDGE_STEP_WORLD);
    }
  });
});
