import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import {
  renderApp,
  dragNote,
  pressNote,
  shiftPressNote,
  windowKeyDown,
  pointerEvent,
  type AppHarness,
} from './appHarness';
import { objectBounds, setStickyColor, getStickyText, type ObjectSnapshot } from '../../src/shared/board-model';

function noteBounds(app: AppHarness, id: string) {
  const obj = app.notes().find((n) => n.id === id);
  if (!obj) throw new Error(`note ${id} not found`);
  return objectBounds(obj as ObjectSnapshot);
}

describe('undo.boundaries: gesture and typing (component TC-14 to TC-17)', () => {
  it('TC-14: 30-frame drag of a selection → one undo restores every object\'s start position', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const b = app.addNote({ x: 400, y: 100 });

    // Select both
    pressNote(app, a);
    shiftPressNote(app, b);

    const startA = noteBounds(app, a);
    const startB = noteBounds(app, b);

    // Simulate a 30-frame drag (multiple pointermove events)
    pressNote(app, a, 100, 100);
    for (let i = 1; i <= 30; i++) {
      act(() => {
        pointerEvent(window, 'pointermove', 100 + i * 2, 100 + i, 1);
      });
    }
    act(() => {
      pointerEvent(window, 'pointerup', 100 + 60, 100 + 30, 1);
    });

    // Notes should have moved
    const afterDragA = noteBounds(app, a);
    const afterDragB = noteBounds(app, b);
    expect(afterDragA.x).not.toBe(startA.x);
    expect(afterDragB.x).not.toBe(startB.x);

    // One undo should restore both to start positions
    act(() => {
      windowKeyDown('z', { ctrlKey: true });
    });

    const afterUndoA = noteBounds(app, a);
    const afterUndoB = noteBounds(app, b);
    expect(afterUndoA.x).toBe(startA.x);
    expect(afterUndoA.y).toBe(startA.y);
    expect(afterUndoB.x).toBe(startB.x);
    expect(afterUndoB.y).toBe(startB.y);
  });

  it('TC-15: drag ends, colour changed 200 ms later → two separate steps', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const startA = noteBounds(app, a);

    // Drag the note
    dragNote(app, a, 50, 30);
    const afterDrag = noteBounds(app, a);
    expect(afterDrag.x).toBe(startA.x + 50);

    // Change colour (the SelectionBar calls boundary before and after)
    act(() => {
      setStickyColor(app.doc, a, 'blue');
    });

    // Two undos needed: one for colour, one for drag
    act(() => {
      windowKeyDown('z', { ctrlKey: true });
    });
    // Colour undone, position still changed
    expect(app.notes().find((n) => n.id === a)!.color).toBe('yellow');
    expect(noteBounds(app, a).x).toBe(startA.x + 50);

    act(() => {
      windowKeyDown('z', { ctrlKey: true });
    });
    // Position restored
    expect(noteBounds(app, a).x).toBe(startA.x);
  });

  it('TC-16: edit a note, type, Ctrl+Z inside editor → typing undone; earlier move not undone', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const startX = noteBounds(app, a).x;

    // Move the note first
    dragNote(app, a, 30, 0);
    expect(noteBounds(app, a).x).toBe(startX + 30);

    // Start editing (double-click)
    const noteEl = app.note(a);
    act(() => {
      noteEl.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });

    // Type in the editor
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    act(() => {
      textarea.value = 'hello';
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Ctrl+Z inside the editor should undo the typing only
    act(() => {
      const e = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
      textarea.dispatchEvent(e);
    });

    // Typing is undone
    const ytext = getStickyText(app.doc, a);
    expect(ytext?.toString()).toBe('');

    // The earlier move is NOT undone (position still changed)
    expect(noteBounds(app, a).x).toBe(startX + 30);
  });

  it('TC-17: pointercancel mid-drag → one step restoring the start position', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const startA = noteBounds(app, a);

    // Start a drag and cancel it. We need to let rAF fire so a frame is
    // applied before the cancel (otherwise no move happens and undo would
    // target the creation step).
    pressNote(app, a, 100, 100);
    act(() => {
      pointerEvent(window, 'pointermove', 130, 120, 1);
    });
    // Let the rAF callback fire (applies the pending move)
    await new Promise((r) => setTimeout(r, 20));
    act(() => {
      pointerEvent(window, 'pointercancel', 130, 120, 1);
    });

    // The note should have moved (rAF frame was applied)
    const afterCancel = noteBounds(app, a);
    expect(afterCancel.x).not.toBe(startA.x);

    // One undo should restore the start position
    act(() => {
      windowKeyDown('z', { ctrlKey: true });
    });

    const afterUndo = noteBounds(app, a);
    expect(afterUndo.x).toBe(startA.x);
    expect(afterUndo.y).toBe(startA.y);
  });
});
