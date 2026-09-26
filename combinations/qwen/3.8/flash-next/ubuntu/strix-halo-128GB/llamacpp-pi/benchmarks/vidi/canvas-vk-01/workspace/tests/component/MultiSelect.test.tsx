import { describe, it, expect, beforeEach } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import * as Y from 'yjs';

import { BoardApp } from '../../src/client/App';
import { deleteObjects, initDoc, snapshot } from '../../src/shared/board-model';
import { NUDGE_LARGE_STEP_WORLD, NUDGE_STEP_WORLD } from '../../src/shared/config';
import { fireKey, firePointer } from './helpers';

interface NoteSeed {
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
}

function renderNotes(notes: NoteSeed[]) {
  const doc = new Y.Doc();
  initDoc(doc);
  const objects = doc.getMap('objects') as unknown as Y.Map<Y.Map<unknown>>;
  doc.transact(() => {
    notes.forEach((n, i) => {
      const map = new Y.Map<unknown>();
      map.set('type', 'sticky');
      map.set('x', n.x);
      map.set('y', n.y);
      map.set('color', 'yellow');
      map.set('text', new Y.Text(''));
      map.set('z', i + 1);
      map.set('createdAt', 0);
      if (n.width !== undefined) map.set('width', n.width);
      if (n.height !== undefined) map.set('height', n.height);
      objects.set(n.id, map);
    });
  });
  const view = render(<BoardApp doc={doc} />);
  return {
    ...view,
    doc,
    async settle() {
      await act(async () => {
        await new Promise((r) => setTimeout(r, 30));
      });
    },
    selectedIds() {
      return Array.from(document.querySelectorAll('[data-selected="true"]')).length;
    },
    clickNote(id: string, x: number, y: number, shift = false) {
      firePointer(screen.getByTestId(`sticky-note-${id}`), 'pointerdown', x, y, { shiftKey: shift });
      firePointer(screen.getByTestId(`sticky-note-${id}`), 'pointerup', x, y, { shiftKey: shift });
    },
  };
}

beforeEach(cleanup);

describe('Multi-select: bar, marquee and keyboard (TC-16 to TC-31)', () => {
  it('TC-16: remote deletion of every selected object clears the selection and hides the bar', async () => {
    const { doc, settle, selectedIds } = renderNotes([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 400, y: 100 },
    ]);
    await settle();
    fireKey({ key: 'a', ctrlKey: true });
    await settle();
    expect(selectedIds()).toBe(2);

    act(() => {
      deleteObjects(doc, ['a', 'b']);
    });
    await settle();
    expect(selectedIds()).toBe(0);
    expect(screen.queryByTestId('selection-bar')).toBeNull();
  });

  it('TC-17: two selected shows a polite live count and a Delete button', async () => {
    const { settle } = renderNotes([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 400, y: 100 },
    ]);
    await settle();
    fireKey({ key: 'a', ctrlKey: true });
    await settle();

    const count = screen.getByTestId('selection-count');
    expect(count.textContent).toBe('2 selected');
    expect(count.getAttribute('aria-live')).toBe('polite');
    expect(screen.getByTestId('delete-selection')).not.toBeNull();
  });

  it('TC-18: a single selected sticky shows the NoteToolbar, never the selection bar', async () => {
    const { settle, clickNote } = renderNotes([{ id: 'a', x: 100, y: 100 }]);
    await settle();
    clickNote('a', 150, 150);
    await settle();
    expect(screen.queryByTestId('selection-bar')).toBeNull();
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
  });

  it('TC-19: a click on empty space (no drag) clears the selection', async () => {
    const { settle, selectedIds } = renderNotes([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 400, y: 100 },
    ]);
    await settle();
    fireKey({ key: 'a', ctrlKey: true });
    await settle();
    expect(selectedIds()).toBe(2);

    const viewport = screen.getByTestId('board-viewport');
    firePointer(viewport, 'pointerdown', 900, 900);
    firePointer(viewport, 'pointerup', 900, 900);
    await settle();
    expect(selectedIds()).toBe(0);
  });

  it('TC-20: a Shift+drag adds the enclosed objects to the current selection', async () => {
    const { settle, clickNote } = renderNotes([
      { id: 'a', x: 100, y: 100, width: 40, height: 40 },
      { id: 'b', x: 500, y: 100, width: 40, height: 40 },
      { id: 'c', x: 560, y: 100, width: 40, height: 40 },
    ]);
    await settle();
    clickNote('a', 120, 120); // selection = {a}
    await settle();
    expect(document.querySelectorAll('[data-selected="true"]').length).toBe(1);

    const viewport = screen.getByTestId('board-viewport');
    firePointer(viewport, 'pointerdown', 460, 60, { shiftKey: true });
    firePointer(viewport, 'pointermove', 620, 180, { shiftKey: true });
    firePointer(viewport, 'pointerup', 620, 180, { shiftKey: true });
    await settle();

    // additive: a is retained, b and c are enclosed and added
    expect(screen.getByTestId('sticky-note-a').dataset.selected).toBe('true');
    expect(screen.getByTestId('sticky-note-b').dataset.selected).toBe('true');
    expect(screen.getByTestId('sticky-note-c').dataset.selected).toBe('true');
  });

  it('TC-21: a plain drag on empty space pans and does not start a marquee', async () => {
    const { settle, selectedIds } = renderNotes([
      { id: 'a', x: 100, y: 100, width: 40, height: 40 },
      { id: 'b', x: 400, y: 100, width: 40, height: 40 },
    ]);
    await settle();
    fireKey({ key: 'a', ctrlKey: true });
    await settle();
    expect(selectedIds()).toBe(2);

    const viewport = screen.getByTestId('board-viewport');
    // No shift modifier: this is a pan, so the selection is untouched.
    firePointer(viewport, 'pointerdown', 20, 700);
    firePointer(viewport, 'pointermove', 600, 200);
    firePointer(viewport, 'pointerup', 600, 200);
    await settle();

    expect(screen.queryByTestId('marquee-rect')).toBeNull();
    expect(selectedIds()).toBe(2); // both still selected, nothing marquee-added/removed
  });

  it('TC-22: pointercancel mid-marquee leaves the selection unchanged', async () => {
    const { settle, selectedIds } = renderNotes([
      { id: 'a', x: 100, y: 100, width: 40, height: 40 },
      { id: 'b', x: 300, y: 100, width: 40, height: 40 },
    ]);
    await settle();
    fireKey({ key: 'a', ctrlKey: true });
    await settle();
    expect(selectedIds()).toBe(2);

    const viewport = screen.getByTestId('board-viewport');
    firePointer(viewport, 'pointerdown', 20, 20, { shiftKey: true });
    firePointer(viewport, 'pointermove', 800, 800, { shiftKey: true });
    // Cancel before the drop would commit.
    firePointer(viewport, 'pointercancel', 800, 800, { shiftKey: true });
    await settle();
    expect(selectedIds()).toBe(2);
  });

  it('TC-27: Ctrl/Cmd+A selects every object and is preventDefault-ed', async () => {
    const { settle, selectedIds } = renderNotes([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 400, y: 100 },
      { id: 'c', x: 700, y: 100 },
    ]);
    await settle();
    const event = fireKey({ key: 'a', metaKey: true });
    await settle();
    expect(event.defaultPrevented).toBe(true);
    expect(selectedIds()).toBe(3);
  });

  it('TC-28: Ctrl/Cmd+A on an empty board selects nothing and does not throw', async () => {
    const { settle, selectedIds } = renderNotes([]);
    await settle();
    expect(() => fireKey({ key: 'a', ctrlKey: true })).not.toThrow();
    await settle();
    expect(selectedIds()).toBe(0);
  });

  it('TC-29: arrows nudge by NUDGE_STEP_WORLD, Shift uses the large step, both preventDefault', async () => {
    const { doc, settle } = renderNotes([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 400, y: 100 },
    ]);
    await settle();
    fireKey({ key: 'a', ctrlKey: true });
    await settle();

    const right = fireKey({ key: 'ArrowRight' });
    await settle();
    expect(right.defaultPrevented).toBe(true);
    let snap = snapshot(doc);
    expect(snap.find((o) => o.id === 'a')?.x).toBeCloseTo(100 + NUDGE_STEP_WORLD, 3);

    const up = fireKey({ key: 'ArrowUp', shiftKey: true });
    await settle();
    expect(up.defaultPrevented).toBe(true);
    snap = snapshot(doc);
    expect(snap.find((o) => o.id === 'a')?.y).toBeCloseTo(100 - NUDGE_LARGE_STEP_WORLD, 3);
  });

  it('TC-30: Backspace while editing text is not a delete (objects are kept)', async () => {
    const { doc, settle, clickNote } = renderNotes([{ id: 'a', x: 100, y: 100 }]);
    await settle();
    clickNote('a', 150, 150);
    await settle();
    // Enter puts the single selected sticky into edit mode.
    fireKey({ key: 'Enter' });
    await settle();
    // Backspace is now text editing, so nothing is deleted.
    fireKey({ key: 'Backspace' });
    await settle();
    expect(snapshot(doc)).toHaveLength(1);
  });

  it('TC-31: Delete removes every selected object at once and clears the selection', async () => {
    const { doc, settle, selectedIds } = renderNotes([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 400, y: 100 },
      { id: 'c', x: 700, y: 100 },
    ]);
    await settle();
    fireKey({ key: 'a', ctrlKey: true });
    await settle();
    fireKey({ key: 'Delete' });
    await settle();
    expect(snapshot(doc)).toHaveLength(0);
    expect(selectedIds()).toBe(0);
  });
});
