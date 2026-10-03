import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, act } from '@testing-library/react';
import { deleteObject } from '../../src/shared/board-model';
import { renderApp, pointerEvent, doubleClick, windowKeyDown } from './appHarness';

afterEach(() => {
  cleanup();
});

function getViewport(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function getWorldLayer(): HTMLElement {
  return screen.getByTestId('world-layer');
}

function getEditor() {
  return screen.queryByTestId('sticky-texteditor') ?? screen.queryByTestId('sticky-text-editor');
}

describe('sticky.interaction (ui-component)', async () => {
  it('TC-18: press+release without move → Selected; outline and NoteToolbar rendered', async () => {
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    const note = app.note(id);

    act(() => {
      pointerEvent(note, 'pointerdown', 100, 100);
    });
    act(() => {
      pointerEvent(note, 'pointerup', 100, 100);
    });

    expect(note.getAttribute('data-selected')).toBe('true');
    // Blue outline
    expect((note as HTMLElement).style.outline).toContain('solid');
    // Note toolbar visible
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
  });

  it('TC-19: move 2px (< DRAG_THRESHOLD_PX) → Selected, no moveObject (boundary)', async () => {
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 }); // top-left (100,100)
    const note = app.note(id);
    const xBefore = app.notes().find((n) => n.id === id)!.x;

    act(() => {
      pointerEvent(note, 'pointerdown', 100, 100);
    });
    act(() => {
      pointerEvent(note, 'pointermove', 102, 100); // 2px
    });
    act(() => {
      pointerEvent(note, 'pointerup', 102, 100);
    });

    expect(note.getAttribute('data-selected')).toBe('true');
    expect(app.notes().find((n) => n.id === id)!.x).toBe(xBefore);
    expect(app.notes().find((n) => n.id === id)!.y).toBe(100);
  });

  it('TC-20: move 3px (= DRAG_THRESHOLD_PX) → Dragging; board camera unchanged (no pan)', async () => {
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    const note = app.note(id);

    act(() => {
      pointerEvent(note, 'pointerdown', 100, 100);
    });
    act(() => {
      pointerEvent(note, 'pointermove', 103, 100); // exactly 3px
    });

    expect(note.getAttribute('data-dragging')).toBe('true');
    // The board camera must not move while dragging a note
    expect(getWorldLayer().style.transform).toBe('scale(1) translate(0px, 0px)');

    act(() => {
      pointerEvent(note, 'pointerup', 103, 100);
    });
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(note.getAttribute('data-dragging')).toBeNull();
    // Final position flushed: +3 world px at zoom 1
    expect(app.notes().find((n) => n.id === id)!.x).toBe(103);
  });

  it('TC-21: pointercancel during drag → Selected at last applied position', async () => {
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    const note = app.note(id);

    act(() => {
      pointerEvent(note, 'pointerdown', 100, 100);
    });
    act(() => {
      pointerEvent(note, 'pointermove', 103, 100);
    });
    // Let the rAF-throttled write apply
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(app.notes().find((n) => n.id === id)!.x).toBe(103);

    act(() => {
      pointerEvent(note, 'pointercancel', 103, 100);
    });

    expect(note.getAttribute('data-selected')).toBe('true');
    expect(note.getAttribute('data-dragging')).toBeNull();
    const xAfterCancel = app.notes().find((n) => n.id === id)!.x;

    // Further moves are ignored (the drag is over)
    act(() => {
      pointerEvent(note, 'pointermove', 300, 300);
    });
    expect(app.notes().find((n) => n.id === id)!.x).toBe(xAfterCancel);
  });

  it('TC-22: click empty board → Unselected; toolbar gone', async () => {
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    const note = app.note(id);

    // Select the note
    act(() => {
      pointerEvent(note, 'pointerdown', 100, 100);
    });
    act(() => {
      pointerEvent(note, 'pointerup', 100, 100);
    });
    expect(note.getAttribute('data-selected')).toBe('true');
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();

    // Click empty board space
    const viewport = getViewport();
    act(() => {
      pointerEvent(viewport, 'pointerdown', 500, 400);
    });
    act(() => {
      pointerEvent(viewport, 'pointerup', 500, 400);
    });

    expect(note.getAttribute('data-selected')).toBe('false');
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-25a: Delete key on selected note → note removed', async () => {
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    const note = app.note(id);

    act(() => {
      pointerEvent(note, 'pointerdown', 100, 100);
    });
    act(() => {
      pointerEvent(note, 'pointerup', 100, 100);
    });
    expect(note.getAttribute('data-selected')).toBe('true');

    act(() => {
      windowKeyDown('Delete');
    });

    expect(app.noteOrNull(id)).toBeNull();
    expect(app.notes()).toHaveLength(0);
  });

  it('TC-25b: Backspace key on selected note → note removed', async () => {
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    const note = app.note(id);

    act(() => {
      pointerEvent(note, 'pointerdown', 100, 100);
    });
    act(() => {
      pointerEvent(note, 'pointerup', 100, 100);
    });

    act(() => {
      windowKeyDown('Backspace');
    });

    expect(app.noteOrNull(id)).toBeNull();
    expect(app.notes()).toHaveLength(0);
  });

  it('TC-35: dblclick on an existing note → no new note, edits the existing one (negative)', async () => {
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    const note = app.note(id);

    act(() => {
      doubleClick(note, 100, 100);
    });

    expect(app.notes()).toHaveLength(1); // no second note created
    expect(getEditor()).not.toBeNull(); // the existing note is being edited
  });

  it('TC-36: Enter while nothing is selected → nothing happens (negative)', async () => {
    const app = await renderApp();

    act(() => {
      windowKeyDown('Enter');
    });

    expect(app.notes()).toHaveLength(0); // no note created
    expect(getEditor()).toBeNull(); // nothing edited
  });

  it('TC-37a: note deleted via model while Dragging → interaction ends, no exception, not recreated', async () => {
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    const note = app.note(id);

    act(() => {
      pointerEvent(note, 'pointerdown', 100, 100);
    });
    act(() => {
      pointerEvent(note, 'pointermove', 103, 100);
    });
    expect(note.getAttribute('data-dragging')).toBe('true');

    // Delete the note mid-drag (must not throw)
    await act(async () => {
      deleteObject(app.doc, id);
    });

    expect(app.noteOrNull(id)).toBeNull();
    expect(app.notes()).toHaveLength(0); // not re-created

    // A later pointer event must not throw (component is unmounted)
    expect(() => pointerEvent(getViewport(), 'pointermove', 200, 200)).not.toThrow();
  });

  it('TC-37b: note deleted via model while Editing → interaction ends, no exception, not recreated', async () => {
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    const note = app.note(id);

    act(() => {
      doubleClick(note, 100, 100);
    });
    expect(getEditor()).not.toBeNull();

    // Delete the note mid-edit (must not throw)
    await act(async () => {
      deleteObject(app.doc, id);
    });

    expect(app.noteOrNull(id)).toBeNull();
    expect(app.notes()).toHaveLength(0); // not re-created
    expect(getEditor()).toBeNull();
  });
});
