import { describe, it, expect } from 'vitest';
import { act, screen } from '@testing-library/react';
import { createSticky, deleteObject, snapshot } from '../../src/shared/board-model';
import { getStickyText } from '../../src/shared/board-model';
import { renderApp, getNote, flushRaf } from './sticky-helpers';
import { createPointerEvent } from './helpers';

function pressAndRelease(el: HTMLElement, at: { x: number; y: number }) {
  act(() => {
    el.dispatchEvent(createPointerEvent('pointerdown', { ...at, pointerId: 1, button: 0 }));
  });
  act(() => {
    el.dispatchEvent(createPointerEvent('pointerup', { ...at, pointerId: 1, button: 0 }));
  });
}

function selectNote(app: ReturnType<typeof renderApp>, id: string, at = { x: 100, y: 100 }) {
  const el = getNote(id);
  expect(el).not.toBeNull();
  pressAndRelease(el!, at);
  return app;
}

function worldLayerTransform(): string {
  return (document.querySelector('[data-testid="world-layer"]') as HTMLElement).style.transform;
}

describe('sticky.interaction (ui-component)', () => {
  it('TC-18: press + release without move → Selected; outline and NoteToolbar rendered', () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
    });

    const el = getNote(id)!;
    expect(el.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();

    pressAndRelease(el, { x: 100, y: 100 });

    expect(el.hasAttribute('data-selected')).toBe(true);
    expect(el.style.outline).toBe('2px solid #2563eb');
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();
    // Swatches and delete button have accessible names.
    expect(screen.getByLabelText('Pink colour')).not.toBeNull();
    expect(screen.getByLabelText('Delete note')).not.toBeNull();
  });

  it('TC-19: move 2px (< DRAG_THRESHOLD_PX) → Selected, no moveObject (boundary)', async () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
    });
    const before = snapshot(doc).find((n) => n.id === id)!;

    const el = getNote(id)!;
    act(() => {
      el.dispatchEvent(createPointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
    });
    act(() => {
      el.dispatchEvent(createPointerEvent('pointermove', { clientX: 102, clientY: 100, pointerId: 1 }));
    });
    act(() => {
      el.dispatchEvent(createPointerEvent('pointerup', { clientX: 102, clientY: 100, pointerId: 1 }));
    });
    await flushRaf();

    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(getNote(id)!.hasAttribute('data-selected')).toBe(true);
  });

  it('TC-20: move 3px (= threshold) → Dragging; board camera unchanged (negative: no pan)', async () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
    });
    const before = snapshot(doc).find((n) => n.id === id)!;
    const transformBefore = worldLayerTransform();

    const el = getNote(id)!;
    act(() => {
      el.dispatchEvent(createPointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
    });
    act(() => {
      el.dispatchEvent(createPointerEvent('pointermove', { clientX: 103, clientY: 100, pointerId: 1 }));
    });
    await flushRaf();
    act(() => {
      el.dispatchEvent(createPointerEvent('pointerup', { clientX: 103, clientY: 100, pointerId: 1 }));
    });

    const after = snapshot(doc).find((n) => n.id === id)!;
    // Dragged by 3 screen px at zoom 1 → 3 world units.
    expect(after.x).toBeCloseTo(before.x + 3, 5);
    expect(after.y).toBeCloseTo(before.y, 5);
    // The board camera did not move.
    expect(worldLayerTransform()).toBe(transformBefore);
    expect(getNote(id)!.hasAttribute('data-selected')).toBe(true);
  });

  it('TC-21: pointercancel during drag → Selected at last position', async () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
    });
    const before = snapshot(doc).find((n) => n.id === id)!;

    const el = getNote(id)!;
    act(() => {
      el.dispatchEvent(createPointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
    });
    act(() => {
      el.dispatchEvent(createPointerEvent('pointermove', { clientX: 110, clientY: 105, pointerId: 1 }));
    });
    await flushRaf();
    act(() => {
      el.dispatchEvent(createPointerEvent('pointercancel', { clientX: 110, clientY: 105, pointerId: 1 }));
    });

    const after = snapshot(doc).find((n) => n.id === id)!;
    expect(after.x).toBeCloseTo(before.x + 10, 5);
    expect(after.y).toBeCloseTo(before.y + 5, 5);
    expect(getNote(id)!.hasAttribute('data-selected')).toBe(true);
  });

  it('TC-22: click empty board → Unselected, toolbar gone', () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
    });
    selectNote(app, id);
    const el = getNote(id)!;
    expect(el.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByTestId('note-toolbar')).not.toBeNull();

    const viewport = document.querySelector('[data-testid="board-viewport"]') as HTMLElement;
    pressAndRelease(viewport, { x: 400, y: 300 });

    expect(el.hasAttribute('data-selected')).toBe(false);
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });

  it('TC-25: Delete and Backspace on a selected note remove it (separate runs)', () => {
    // Run 1: Delete
    {
      const app = renderApp();
      const doc = app.getDoc();
      let id = '';
      act(() => {
        id = createSticky(doc, { x: 0, y: 0 }) as string;
      });
      selectNote(app, id);
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }));
      });
      expect(snapshot(doc)).toHaveLength(0);
      expect(getNote(id)).toBeNull();
    }
    // Run 2: Backspace
    {
      const app = renderApp();
      const doc = app.getDoc();
      let id = '';
      act(() => {
        id = createSticky(doc, { x: 0, y: 0 }) as string;
      });
      selectNote(app, id);
      act(() => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
      });
      expect(snapshot(doc)).toHaveLength(0);
      expect(getNote(id)).toBeNull();
    }
  });

  it('TC-35: dblclick on an existing note → no new note, edits existing (negative)', () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
    });
    const el = getNote(id)!;
    act(() => {
      el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });

    expect(snapshot(doc)).toHaveLength(1);
    expect(screen.getByTestId('sticky-editor')).not.toBeNull();
  });

  it('TC-36: Enter with nothing selected → nothing happens (negative)', () => {
    const app = renderApp();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(app.notes()).toHaveLength(0);
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
  });

  it('TC-37: note deleted via model while Dragging → interaction ends, no exception, not recreated', async () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
    });
    const el = getNote(id)!;
    act(() => {
      el.dispatchEvent(createPointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerId: 1 }));
    });
    act(() => {
      el.dispatchEvent(createPointerEvent('pointermove', { clientX: 120, clientY: 110, pointerId: 1 }));
    });
    await flushRaf();

    // Delete the note mid-drag via the model.
    act(() => {
      expect(deleteObject(doc, id)).toBe(true);
    });
    expect(snapshot(doc)).toHaveLength(0);

    // Releasing the pointer on the (now detached) element must not throw.
    act(() => {
      el.dispatchEvent(createPointerEvent('pointerup', { clientX: 120, clientY: 110, pointerId: 1 }));
    });

    expect(snapshot(doc)).toHaveLength(0);
    expect(getNote(id)).toBeNull();
  });

  it('TC-37: note deleted via model while Editing → interaction ends, no exception, not recreated', () => {
    const app = renderApp();
    const doc = app.getDoc();
    let id = '';
    act(() => {
      id = createSticky(doc, { x: 0, y: 0 }) as string;
    });
    selectNote(app, id);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    const editor = screen.getByTestId('sticky-editor') as HTMLTextAreaElement;
    act(() => {
      editor.value = 'abc';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(getStickyText(doc, id)!.toString()).toBe('abc');

    // Delete the note mid-edit via the model.
    act(() => {
      expect(deleteObject(doc, id)).toBe(true);
    });

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('sticky-editor')).toBeNull();
    expect(getNote(id)).toBeNull();
  });
});
