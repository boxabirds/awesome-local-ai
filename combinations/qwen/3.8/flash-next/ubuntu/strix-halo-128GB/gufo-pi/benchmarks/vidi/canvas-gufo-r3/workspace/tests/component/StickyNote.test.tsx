import { describe, it, expect, afterEach, vi } from 'vitest';
import React from 'react';
import { render, fireEvent, act, cleanup, screen } from '@testing-library/react';
import { TestBoard, HarnessHandle, VIEWPORT, flushFrames } from './harness';
import { deleteObject, snapshot } from '@shared/board-model';

function setup(initialNotes: { x: number; y: number; text?: string }[] = []) {
  const handle: HarnessHandle = { current: null };
  const utils = render(<TestBoard handle={handle} initialNotes={initialNotes} />);
  return { handle, ...utils };
}

function notesOf(handle: HarnessHandle) {
  const doc = handle.current!.doc;
  return snapshot(doc);
}

function getNoteElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]'));
}

describe('StickyNote interaction', () => {
  afterEach(cleanup);

  describe('TC-18: click selects', () => {
    it('press and release without movement selects, shows outline and toolbar', () => {
      const { container } = setup([{ x: 200, y: 200 }]);
      const note = getNoteElements(container)[0];

      fireEvent.pointerDown(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
      fireEvent.pointerUp(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });

      expect(note.dataset.selected).toBe('true');
      expect(container.querySelector('[data-testid="note-toolbar"]')).not.toBeNull();
      // Blue outline
      expect(note.style.outline).toContain('1976D2');
    });
  });

  describe('TC-19: 2px movement stays below drag threshold', () => {
    it('selects without moving the note', () => {
      const { handle, container } = setup([{ x: 200, y: 200 }]);
      const id = notesOf(handle)[0].id;
      const note = getNoteElements(container)[0];

      fireEvent.pointerDown(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
      fireEvent.pointerMove(note, { pointerId: 1, clientX: 252, clientY: 250, button: 0 });
      fireEvent.pointerUp(note, { pointerId: 1, clientX: 252, clientY: 250, button: 0 });

      const after = notesOf(handle).find((n) => n.id === id)!;
      expect(after.x).toBe(100);
      expect(after.y).toBe(100);
      expect(note.dataset.selected).toBe('true');
      expect(note.dataset.interaction).not.toBe('dragging');
    });
  });

  describe('TC-20: 3px movement starts a drag and does not pan the board', () => {
    it('dragging state active; camera unchanged', async () => {
      const { handle, container } = setup([{ x: 200, y: 200 }]);
      const id = notesOf(handle)[0].id;
      const camBefore = { ...handle.current!.camera };
      const world = screen.getByTestId('world-layer');
      const camXBefore = world.dataset.cameraX;
      const camYBefore = world.dataset.cameraY;

      const note = getNoteElements(container)[0];
      fireEvent.pointerDown(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
      fireEvent.pointerMove(note, { pointerId: 1, clientX: 253, clientY: 250, button: 0 });

      expect(note.dataset.interaction).toBe('dragging');

      await act(async () => {
        await flushFrames();
      });

      // Board camera untouched
      expect(world.dataset.cameraX).toBe(camXBefore);
      expect(world.dataset.cameraY).toBe(camYBefore);
      expect(handle.current!.camera.x).toBe(camBefore.x);
      expect(handle.current!.camera.y).toBe(camBefore.y);

      // The note moved by 3 world units (zoom 1)
      const after = notesOf(handle).find((n) => n.id === id)!;
      expect(after.x).toBeCloseTo(103, 5);
    });
  });

  describe('TC-21: pointercancel during drag keeps last position', () => {
    it('ends as selected at last applied position', async () => {
      const { handle, container } = setup([{ x: 200, y: 200 }]);
      const id = notesOf(handle)[0].id;
      const note = getNoteElements(container)[0];

      fireEvent.pointerDown(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
      fireEvent.pointerMove(note, { pointerId: 1, clientX: 260, clientY: 250, button: 0 });
      await act(async () => {
        await flushFrames();
      });
      const xAfterMove = notesOf(handle).find((n) => n.id === id)!.x;

      fireEvent.pointerCancel(note, { pointerId: 1 });
      fireEvent.pointerMove(note, { pointerId: 1, clientX: 999, clientY: 999, button: 0 });
      await act(async () => {
        await flushFrames();
      });

      const after = notesOf(handle).find((n) => n.id === id)!;
      expect(after.x).toBeCloseTo(xAfterMove, 5);
      expect(getNoteElements(container)[0].dataset.interaction).toBe('selected');
    });
  });

  describe('TC-22: click empty board clears selection', () => {
    it('deselects and removes the toolbar', () => {
      const { container } = setup([{ x: 200, y: 200 }]);
      const note = getNoteElements(container)[0];
      fireEvent.pointerDown(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
      fireEvent.pointerUp(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
      expect(container.querySelector('[data-testid="note-toolbar"]')).not.toBeNull();

      const viewport = screen.getByTestId('board-viewport');
      fireEvent.pointerDown(viewport, { pointerId: 2, clientX: 900, clientY: 600, button: 0 });
      fireEvent.pointerUp(viewport, { pointerId: 2, clientX: 900, clientY: 600, button: 0 });

      expect(container.querySelector('[data-testid="note-toolbar"]')).toBeNull();
      expect(getNoteElements(container)[0].dataset.selected).toBe('false');
    });
  });

  describe('TC-25: Delete / Backspace remove the selected note', () => {
    it('Delete removes it', () => {
      const { handle, container } = setup([{ x: 200, y: 200 }]);
      const note = getNoteElements(container)[0];
      fireEvent.pointerDown(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
      fireEvent.pointerUp(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      });
      expect(notesOf(handle).length).toBe(0);
      expect(getNoteElements(container).length).toBe(0);
    });

    it('Backspace removes it', () => {
      const { handle, container } = setup([{ x: 200, y: 200 }]);
      const note = getNoteElements(container)[0];
      fireEvent.pointerDown(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
      fireEvent.pointerUp(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
      });
      expect(notesOf(handle).length).toBe(0);
    });
  });

  describe('TC-35: double-click on an existing note edits it (no new note)', () => {
    it('note count unchanged, editing active', () => {
      const { handle, container } = setup([{ x: 200, y: 200, text: 'hello' }]);
      const note = getNoteElements(container)[0];

      fireEvent.doubleClick(note);

      expect(notesOf(handle).length).toBe(1);
      expect(handle.current!.selection.editingId).not.toBeNull();
      expect(container.querySelector('[data-testid="sticky-textarea"]')).not.toBeNull();
    });
  });

  describe('TC-36: Enter with nothing selected does nothing', () => {
    it('no note created', () => {
      const { handle } = setup([]);
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(notesOf(handle).length).toBe(0);
      expect(handle.current!.selection.editingId).toBeNull();
    });
  });

  describe('TC-37: note deleted mid-interaction ends silently', () => {
    it('deleted while dragging: no exception, no re-creation', async () => {
      const { handle, container } = setup([{ x: 200, y: 200 }]);
      const id = notesOf(handle)[0].id;
      const note = getNoteElements(container)[0];

      fireEvent.pointerDown(note, { pointerId: 1, clientX: 250, clientY: 250, button: 0 });
      fireEvent.pointerMove(note, { pointerId: 1, clientX: 270, clientY: 250, button: 0 });

      act(() => {
        deleteObject(handle.current!.doc, id);
      });

      let thrown: unknown = null;
      await act(async () => {
        try {
          fireEvent.pointerMove(note, { pointerId: 1, clientX: 300, clientY: 260, button: 0 });
          await flushFrames();
          fireEvent.pointerUp(note, { pointerId: 1, clientX: 300, clientY: 260, button: 0 });
        } catch (err) {
          thrown = err;
        }
      });
      expect(thrown).toBeNull();

      expect(notesOf(handle).find((n) => n.id === id)).toBeUndefined();
    });

    it('deleted while editing: editing ends, note not recreated', () => {
      const { handle, container } = setup([{ x: 200, y: 200, text: 'hi' }]);
      const id = notesOf(handle)[0].id;
      const note = getNoteElements(container)[0];
      fireEvent.doubleClick(note);
      expect(container.querySelector('[data-testid="sticky-textarea"]')).not.toBeNull();

      expect(() => {
        act(() => {
          deleteObject(handle.current!.doc, id);
        });
      }).not.toThrow();

      expect(container.querySelector('[data-testid="sticky-textarea"]')).toBeNull();
      expect(notesOf(handle).length).toBe(0);
      expect(handle.current!.selection.editingId).toBeNull();
    });
  });

  describe('Keyboard accessibility', () => {
    it('notes are reachable with Tab and focusing one selects it', () => {
      const { handle, container } = setup([{ x: 200, y: 200 }]);
      const note = getNoteElements(container)[0];
      expect(note.tabIndex).toBe(0);

      act(() => {
        note.focus();
      });
      const id = notesOf(handle)[0].id;
      expect(handle.current!.selection.selectedId).toBe(id);

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      expect(handle.current!.selection.editingId).toBe(id);
      expect(container.querySelector('[data-testid="sticky-textarea"]')).not.toBeNull();
    });

    it('Delete removes the focused note when not editing', () => {
      const { handle, container } = setup([{ x: 200, y: 200 }, { x: 500, y: 200 }]);
      const ids = notesOf(handle).map((n) => n.id);
      const second = container.querySelector(`[data-note-id="${ids[1]}"][data-testid="sticky-note"]`) as HTMLElement;
      act(() => {
        second.focus();
      });
      expect(handle.current!.selection.selectedId).toBe(ids[1]);

      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
      });
      expect(notesOf(handle).map((n) => n.id)).toEqual([ids[0]]);
    });

    it('Enter while editing inserts a newline instead of restarting editing', () => {
      const { handle, container } = setup([{ x: 200, y: 200, text: 'one' }]);
      const id = notesOf(handle)[0].id;
      const note = getNoteElements(container)[0];
      fireEvent.doubleClick(note);
      const ta = container.querySelector<HTMLTextAreaElement>('[data-testid="sticky-textarea"]')!;

      fireEvent.keyDown(ta, { key: 'Enter', bubbles: true, cancelable: true });
      fireEvent.input(ta, { target: { value: 'one\ntwo' } });

      expect(handle.current!.selection.editingId).toBe(id);
      expect(handle.current!.selection.selectedId).toBe(id);
      expect(notesOf(handle).find((n) => n.id === id)!.text).toBe('one\ntwo');
    });
  });
});
