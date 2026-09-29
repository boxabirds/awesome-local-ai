import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, act, cleanup, screen } from '@testing-library/react';
import { TestBoard, HarnessHandle, VIEWPORT } from './harness';
import { snapshot } from '@shared/board-model';
import { STICKY_SIZE_WORLD } from '@shared/config';

function setup(initialNotes: { x: number; y: number; text?: string }[] = []) {
  const handle: HarnessHandle = { current: null };
  const utils = render(<TestBoard handle={handle} initialNotes={initialNotes} />);
  return { handle, ...utils };
}

function selectNote(container: HTMLElement, handle: HarnessHandle): string {
  const id = snapshot(handle.current!.doc)[0].id;
  const note = container.querySelector<HTMLElement>('[data-testid="sticky-note"]')!;
  fireEvent.pointerDown(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
  fireEvent.pointerUp(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
  return id;
}

describe('Toolbars', () => {
  afterEach(cleanup);

  describe('TC-27: colour swatch recolours and keeps selection', () => {
    it('clicking the Pink swatch sets the note colour to pink', () => {
      const { handle, container } = setup([{ x: 200, y: 200, text: 'stay' }]);
      const id = selectNote(container, handle);
      const before = snapshot(handle.current!.doc).find((n) => n.id === id)!;

      const pink = container.querySelector<HTMLButtonElement>('[aria-label="Pink colour"]')!;
      expect(pink).not.toBeNull();
      fireEvent.click(pink);

      const after = snapshot(handle.current!.doc).find((n) => n.id === id)!;
      expect(after.color).toBe('pink');
      expect(after.text).toBe(before.text);
      expect(after.x).toBe(before.x);
      expect(after.y).toBe(before.y);
      expect(handle.current!.selection.selectedId).toBe(id);
      expect(pink.getAttribute('aria-pressed')).toBe('true');
    });

    it('swatches are distinguishable by accessible name, not only colour', () => {
      const { handle, container } = setup([{ x: 200, y: 200 }]);
      selectNote(container, handle);
      const names = ['Yellow', 'Orange', 'Green', 'Blue', 'Pink', 'Violet'];
      for (const n of names) {
        const el = container.querySelector(`[aria-label="${n} colour"]`);
        expect(el, `missing swatch ${n}`).not.toBeNull();
        expect(el!.getAttribute('aria-pressed')).toBe(n.toLowerCase() === 'yellow' ? 'true' : 'false');
      }
    });
  });

  describe('TC-28: Sticky note button creates a centred note in edit mode', () => {
    it('creates one note at the viewport centre and starts editing', () => {
      const { handle, container } = setup([]);
      const button = screen.getByRole('button', { name: 'Sticky note' });

      fireEvent.click(button);

      const notes = snapshot(handle.current!.doc);
      expect(notes.length).toBe(1);
      // Default camera centred on world origin → viewport centre is world (0,0),
      // so the note's top-left is -STICKY_SIZE_WORLD/2.
      expect(notes[0].x).toBeCloseTo(-STICKY_SIZE_WORLD / 2);
      expect(notes[0].y).toBeCloseTo(-STICKY_SIZE_WORLD / 2);
      expect(notes[0].color).toBe('yellow');
      expect(handle.current!.selection.editingId).toBe(notes[0].id);
      expect(container.querySelector('[data-testid="sticky-textarea"]')).not.toBeNull();
    });

    it('button has the tooltip text from the PRD', () => {
      setup([]);
      const button = screen.getByRole('button', { name: 'Sticky note' });
      expect(button.getAttribute('title')).toBe('Sticky note – or double-click the board');
    });
  });

  describe('TC-29: bin button deletes and clears selection', () => {
    it('removes the note', () => {
      const { handle, container } = setup([{ x: 200, y: 200 }]);
      const id = selectNote(container, handle);

      const bin = container.querySelector<HTMLButtonElement>('[aria-label="Delete note"]')!;
      expect(bin).not.toBeNull();
      fireEvent.click(bin);

      expect(snapshot(handle.current!.doc).find((n) => n.id === id)).toBeUndefined();
      expect(container.querySelector('[data-testid="note-toolbar"]')).toBeNull();
      // Stale selection is dropped by the App/harness guard
      expect(handle.current!.selection.selectedId).toBeNull();
    });
  });

  describe('double-click on empty board creates a note', () => {
    it('centred at the clicked point, editing active', () => {
      const { handle, container } = setup([]);
      const viewport = screen.getByTestId('board-viewport');

      fireEvent.doubleClick(viewport, { clientX: 300, clientY: 200 });

      const notes = snapshot(handle.current!.doc);
      expect(notes.length).toBe(1);
      // Camera at reset: world = screen - viewport/2 (zoom 1) → click world (-340,-200)
      expect(notes[0].x).toBeCloseTo(300 - VIEWPORT.width / 2 - STICKY_SIZE_WORLD / 2);
      expect(notes[0].y).toBeCloseTo(200 - VIEWPORT.height / 2 - STICKY_SIZE_WORLD / 2);
      expect(handle.current!.selection.editingId).toBe(notes[0].id);
      expect(container.querySelector('[data-testid="sticky-textarea"]')).not.toBeNull();
    });
  });
});
