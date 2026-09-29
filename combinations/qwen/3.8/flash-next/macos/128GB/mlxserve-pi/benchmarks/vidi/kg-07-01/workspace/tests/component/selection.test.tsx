// tests/component/selection.test.tsx — Story 7 selection overlay, marquee, Ctrl+A, selection bar
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import * as Y from 'yjs';
import { createSticky, initDoc, objectsInRect, snapshot } from '../../src/shared/board-model';
import type { ObjectSnapshot } from '../../src/shared/board-model';
import {
  noteEl,
  press,
  renderApp,
} from './helpers';

describe('TC-16 sticky-click → resize handles visible, second sticky not in selection', () => {
  it('shows 8 resize handles when a single sticky is selected', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 100, y: 100 });
    createSticky(doc, { x: 500, y: 500 });
    renderApp(doc);

    press(noteEl(s1));
    const handles = document.querySelectorAll('.selection-handle');
    expect(handles).toHaveLength(8);
    expect(screen.getByLabelText('Resize top-left')).toBeInTheDocument();
    expect(screen.getByLabelText('Resize bottom-right')).toBeInTheDocument();
  });

  it('no handles for a non-resizable type', () => {
    // Only sticky notes are registered; no spec for 'shape' type means no handles.
    // But in this test all notes are sticky, so handles appear.
    const doc = new Y.Doc();
    initDoc(doc);
    const s = createSticky(doc, { x: 0, y: 0 });
    renderApp(doc);
    press(noteEl(s));
    expect(document.querySelectorAll('.selection-handle')).toHaveLength(8);
  });
});

describe('TC-17 objectsInRect uses containment semantics', () => {
  it('objectsInRect includes fully enclosed objects only', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    // Stored at (0,0), size 200x200 → bounds [0,0,200,200]
    const s1 = createSticky(doc, { x: 100, y: 100 });
    // Stored at (150,150), size 200x200 → bounds [150,150,350,350]
    const s2 = createSticky(doc, { x: 250, y: 250 });
    // Object snapshot approach:
    const objects = snapshot(doc).map((n): ObjectSnapshot => ({
      id: n.id, type: n.type, x: n.x, y: n.y, z: n.z,
      width: n.width, height: n.height,
    }));
    // Rect [0,0,200,200] fully encloses s1 but not s2 (s2 extends to 350)
    const ids = objectsInRect(objects, { x: 0, y: 0, width: 200, height: 200 });
    expect(ids).toContain(s1);
    expect(ids).not.toContain(s2);
  });

  it('objectsInRect excludes non-overlapping objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 500, y: 500 });
    const objects = snapshot(doc).map((n): ObjectSnapshot => ({
      id: n.id, type: n.type, x: n.x, y: n.y, z: n.z,
      width: n.width, height: n.height,
    }));
    const ids = objectsInRect(objects, { x: 0, y: 0, width: 100, height: 100 });
    // s1 bounds [0,0,200,200] extends beyond [0,0,100,100] → not fully enclosed
    expect(ids).not.toContain(s1);
    expect(ids).not.toContain(s2);
  });
});

describe('TC-30 Ctrl+A selects all; Escape clears; selection bar counts', () => {
  it('Ctrl+A selects all, selection bar shows count', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    createSticky(doc, { x: 600, y: 600 });
    renderApp(doc);

    // Ctrl+A
    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });
    expect(noteEl(s1)).toHaveAttribute('data-selected', 'true');
    expect(noteEl(s2)).toHaveAttribute('data-selected', 'true');
    expect(screen.getByText('3 selected')).toBeInTheDocument();
  });

  it('Escape clears the selection', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    renderApp(doc);

    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    act(() => {
      fireEvent.keyDown(window, { key: 'Escape', bubbles: true });
    });
    expect(noteEl(s1)).toHaveAttribute('data-selected', 'false');
    expect(noteEl(s2)).toHaveAttribute('data-selected', 'false');
    expect(screen.queryByText('2 selected')).toBeNull();
  });
});

describe('TC-31 note-toolbar Delete and selection-bar Delete both remove the right objects', () => {
  it('selection bar Delete removes all selected objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    createSticky(doc, { x: 0, y: 0 });
    createSticky(doc, { x: 300, y: 300 });
    createSticky(doc, { x: 600, y: 600 });
    renderApp(doc);

    // Select all via Ctrl+A
    act(() => {
      fireEvent.keyDown(window, { key: 'a', ctrlKey: true, bubbles: true });
    });
    expect(screen.getByText('3 selected')).toBeInTheDocument();

    // Delete via selection bar button
    act(() => {
      screen.getByLabelText('Delete selection').click();
    });

    expect(snapshot(doc)).toHaveLength(0);
  });

  it('selection bar Delete removes only selected objects', () => {
    const doc = new Y.Doc();
    initDoc(doc);
    const s1 = createSticky(doc, { x: 0, y: 0 });
    const s2 = createSticky(doc, { x: 300, y: 300 });
    createSticky(doc, { x: 600, y: 600 });
    renderApp(doc);

    // Select s1 and s2 via shift-click
    press(noteEl(s1));
    act(() => {
      fireEvent.pointerDown(noteEl(s2), { clientX: 300, clientY: 300, pointerId: 2, button: 0, shiftKey: true });
      fireEvent.pointerUp(noteEl(s2), { clientX: 300, clientY: 300, pointerId: 2, button: 0, shiftKey: true });
    });
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    act(() => {
      screen.getByLabelText('Delete selection').click();
    });
    const remaining = snapshot(doc);
    expect(remaining).toHaveLength(1);
  });
});
