import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import {
  renderApp,
  dragNote,
  windowKeyDown,
  type AppHarness,
} from './appHarness';
import { moveObjects, type ObjectSnapshot } from '../../src/shared/board-model';

function noteX(app: AppHarness, id: string): number {
  const obj = app.notes().find((n) => n.id === id);
  if (!obj) throw new Error(`note ${id} not found`);
  return (obj as ObjectSnapshot).x;
}

describe('undo.controls: shortcuts, buttons and edit lock (component TC-18 to TC-21)', () => {
  it('TC-18: empty stacks → Undo and Redo buttons disabled', async () => {
    await renderApp();
    // No changes made → both buttons disabled
    const undoBtn = screen.getByTestId('undo-button') as HTMLButtonElement;
    const redoBtn = screen.getByTestId('redo-button') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);
    expect(undoBtn.getAttribute('aria-label')).toBe('Undo');
    expect(redoBtn.getAttribute('aria-label')).toBe('Redo');
  });

  it('TC-19: Ctrl+Z → undo with preventDefault; Ctrl+Shift+Z → redo; Ctrl+Y → redo; Cmd+Z → undo; Cmd+Shift+Z → redo', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const startX = noteX(app, a);

    // Drag the note (calls boundary at start and end, so it's a separate step
    // from the creation)
    dragNote(app, a, 50, 0);
    expect(noteX(app, a)).toBe(startX + 50);

    // Ctrl+Z → undo (preventDefault)
    let ev: KeyboardEvent;
    act(() => {
      ev = windowKeyDown('z', { ctrlKey: true });
    });
    expect(ev!.defaultPrevented).toBe(true);
    expect(noteX(app, a)).toBe(startX);

    // Ctrl+Shift+Z → redo (preventDefault)
    act(() => {
      ev = windowKeyDown('z', { ctrlKey: true, shiftKey: true });
    });
    expect(ev!.defaultPrevented).toBe(true);
    expect(noteX(app, a)).toBe(startX + 50);

    // Ctrl+Z again → undo
    act(() => {
      ev = windowKeyDown('z', { ctrlKey: true });
    });
    expect(ev!.defaultPrevented).toBe(true);
    expect(noteX(app, a)).toBe(startX);

    // Ctrl+Y → redo (preventDefault)
    act(() => {
      ev = windowKeyDown('y', { ctrlKey: true });
    });
    expect(ev!.defaultPrevented).toBe(true);
    expect(noteX(app, a)).toBe(startX + 50);

    // Cmd+Z → undo (preventDefault)
    act(() => {
      ev = windowKeyDown('z', { metaKey: true });
    });
    expect(ev!.defaultPrevented).toBe(true);
    expect(noteX(app, a)).toBe(startX);

    // Cmd+Shift+Z → redo (preventDefault)
    act(() => {
      ev = windowKeyDown('z', { metaKey: true, shiftKey: true });
    });
    expect(ev!.defaultPrevented).toBe(true);
    expect(noteX(app, a)).toBe(startX + 50);
  });

  it('TC-20: canEdit false (load failed) → shortcuts ignored, buttons disabled', async () => {
    const app = await renderApp({ canEdit: false });
    const a = app.addNote({ x: 100, y: 100 });
    const startX = noteX(app, a);

    // Make a change directly on the doc (bypassing canEdit)
    act(() => {
      moveObjects(app.doc, new Map([[a, { x: startX + 50, y: 100 }]]));
    });
    expect(noteX(app, a)).toBe(startX + 50);

    // Ctrl+Z should be ignored (canEdit is false)
    let ev: KeyboardEvent;
    act(() => {
      ev = windowKeyDown('z', { ctrlKey: true });
    });
    // Not prevented (ignored)
    expect(ev!.defaultPrevented).toBe(false);
    // Position unchanged
    expect(noteX(app, a)).toBe(startX + 50);

    // Buttons disabled
    const undoBtn = screen.getByTestId('undo-button') as HTMLButtonElement;
    const redoBtn = screen.getByTestId('redo-button') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);
  });

  it('TC-21: Ctrl+Z with focus in a non-board input → controller not called', async () => {
    const app = await renderApp();
    const a = app.addNote({ x: 100, y: 100 });
    const startX = noteX(app, a);

    // Drag the note (separate step from creation)
    dragNote(app, a, 50, 0);
    expect(noteX(app, a)).toBe(startX + 50);

    // Create an input element and focus it (simulating focus in a non-board input)
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();

    // Dispatch Ctrl+Z on the input (bubbles to window where useBoardKeys listens)
    let ev: KeyboardEvent;
    act(() => {
      ev = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });
      input.dispatchEvent(ev);
    });
    // Not prevented (ignored because focus/target is in an input)
    expect(ev!.defaultPrevented).toBe(false);
    // Position unchanged
    expect(noteX(app, a)).toBe(startX + 50);

    input.remove();
  });
});
