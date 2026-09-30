/**
 * Component tests TC-14 to TC-17: undo.boundaries
 *
 * Tests gesture and typing boundaries in jsdom with a real Y.Doc, real
 * UndoController, and the story 7 gesture hook.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { App } from '../../src/client/App';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { worldToScreen } from '../../src/client/canvas/camera';

const HALF = STICKY_SIZE_WORLD / 2;
const CENTRE = { x: 640, y: 400 };

afterEach(() => {
  cleanup();
});

function getDoc(): Y.Doc {
  return window.__vidi6!.getDoc!();
}

function noteEls(): HTMLElement[] {
  return screen.queryAllByTestId('sticky-note') as HTMLElement[];
}

function notePos(index: number): { x: number; y: number } {
  const els = noteEls();
  return {
    x: Number(els[index]?.dataset.noteX ?? 0),
    y: Number(els[index]?.dataset.noteY ?? 0),
  };
}

function createNoteViaDblClick(at: { x: number; y: number } = CENTRE): void {
  const surface = screen.getByTestId('world-layer');
  fireEvent.doubleClick(surface, { clientX: at.x, clientY: at.y });
}

function centreOf(index: number): { x: number; y: number } {
  const pos = notePos(index);
  const cam = window.__vidi6!.getCamera();
  return worldToScreen(cam, { x: pos.x + HALF, y: pos.y + HALF });
}

function dragNote(index: number, dx: number, dy: number, steps = 10): void {
  const from = centreOf(index);
  const el = noteEls()[index]!;
  fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, pointerId: 1, button: 0 });
  for (let s = 1; s <= steps; s++) {
    fireEvent.pointerMove(window, {
      clientX: from.x + (dx * s) / steps,
      clientY: from.y + (dy * s) / steps,
      pointerId: 1,
      buttons: 1,
    });
  }
  fireEvent.pointerUp(window, {
    clientX: from.x + dx,
    clientY: from.y + dy,
    pointerId: 1,
    button: 0,
  });
}

describe('undo.boundaries component tests', () => {
  beforeEach(() => {
    render(<App boardId="test-undo-boundaries" />);
  });

  // TC-14: 30-frame drag → one undo restores start position
  it('TC-14: 30-frame drag of a note is one undo step', () => {
    createNoteViaDblClick({ x: 500, y: 400 });
    // Escape out of editing mode
    fireEvent.keyDown(screen.getByTestId('sticky-editor'), { key: 'Escape' });

    const startPos = notePos(0);

    // Drag across 30 frames
    dragNote(0, 100, 80, 30);

    const draggedPos = notePos(0);
    expect(draggedPos.x).not.toBe(startPos.x);

    // Undo → back to start
    const undoBtn = screen.getByLabelText('Undo');
    expect((undoBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(undoBtn);

    const restoredPos = notePos(0);
    expect(restoredPos.x).toBe(startPos.x);
    expect(restoredPos.y).toBe(startPos.y);
  });

  // TC-15: drag ends, then colour change → two separate steps
  it('TC-15: drag and colour change are two separate undo steps', () => {
    createNoteViaDblClick({ x: 500, y: 400 });
    fireEvent.keyDown(screen.getByTestId('sticky-editor'), { key: 'Escape' });

    const startPos = notePos(0);

    // Drag
    dragNote(0, 60, 40);

    // Select the note
    const at = centreOf(0);
    const el = noteEls()[0]!;
    fireEvent.pointerDown(el, { clientX: at.x, clientY: at.y, pointerId: 2, button: 0 });
    fireEvent.pointerUp(el, { clientX: at.x, clientY: at.y, pointerId: 2, button: 0 });

    // Click colour button (NoteToolbar should be visible)
    const blueBtn = screen.getByLabelText('Blue colour');
    fireEvent.click(blueBtn);

    // Undo once → colour reverts, position stays
    const undoBtn = screen.getByLabelText('Undo');
    fireEvent.click(undoBtn);

    const posAfterUndo = notePos(0);
    // Position should still be dragged (colour undo doesn't affect position)
    expect(posAfterUndo.x).not.toBe(startPos.x);

    // Undo again → position reverts
    fireEvent.click(undoBtn);
    const finalPos = notePos(0);
    expect(finalPos.x).toBe(startPos.x);
    expect(finalPos.y).toBe(startPos.y);
  });

  // TC-16: edit note, type, Ctrl+Z inside editor → typing undone, earlier move not undone
  it('TC-16: Ctrl+Z inside editor undoes typing not a previous move', () => {
    createNoteViaDblClick({ x: 500, y: 400 });
    fireEvent.keyDown(screen.getByTestId('sticky-editor'), { key: 'Escape' });

    const startPos = notePos(0);

    // Move the note
    dragNote(0, 50, 30);
    const movedPos = notePos(0);
    expect(movedPos.x).not.toBe(startPos.x);

    // Double-click to edit
    const at = centreOf(0);
    const el = noteEls()[0]!;
    fireEvent.doubleClick(el, { clientX: at.x, clientY: at.y });

    // Type text
    const textarea = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hello' } });

    // Ctrl+Z inside the editor → undoes typing, not the move
    fireEvent.keyDown(textarea, { key: 'z', ctrlKey: true });

    // After undo, the Y.Text is reverted
    const doc = getDoc();
    const objects = doc.getMap('objects');
    const noteId = noteEls()[0]!.dataset.noteId!;
    const entry = objects.get(noteId) as Y.Map<unknown>;
    const ytext = entry.get('text') as Y.Text;
    expect(ytext.toString()).not.toBe('hello');

    // Position should NOT be undone (still at moved position)
    const posAfter = notePos(0);
    expect(posAfter.x).toBe(movedPos.x);
    expect(posAfter.y).toBe(movedPos.y);
  });

  // TC-17: pointercancel mid-drag → one step restoring start
  it('TC-17: pointercancel mid-drag is one undo step', () => {
    createNoteViaDblClick({ x: 500, y: 400 });
    fireEvent.keyDown(screen.getByTestId('sticky-editor'), { key: 'Escape' });

    const startPos = notePos(0);

    // Start dragging then cancel
    const from = centreOf(0);
    const el = noteEls()[0]!;
    fireEvent.pointerDown(el, { clientX: from.x, clientY: from.y, pointerId: 1, button: 0 });
    for (let s = 1; s <= 5; s++) {
      fireEvent.pointerMove(window, {
        clientX: from.x + (60 * s) / 5,
        clientY: from.y + (40 * s) / 5,
        pointerId: 1,
        buttons: 1,
      });
    }
    // Cancel
    fireEvent.pointerCancel(window, {
      clientX: from.x + 60,
      clientY: from.y + 40,
      pointerId: 1,
    });

    // Undo → back to start
    const undoBtn = screen.getByLabelText('Undo');
    fireEvent.click(undoBtn);

    const restoredPos = notePos(0);
    expect(restoredPos.x).toBe(startPos.x);
    expect(restoredPos.y).toBe(startPos.y);
  });
});
