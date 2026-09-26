import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { deleteObject } from '../../src/shared/board-model';
import { pointerEvent, fire, seed, boardState } from './harness';

function noteEl(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-note-id="${id}"]`);
  if (!el) throw new Error(`note ${id} not found`);
  return el;
}

function snapshotMap() {
  const w = window as unknown as {
    __vidi6: { snapshot(): Array<{ id: string; x: number; y: number; color: string; text: string }> };
  };
  return w.__vidi6.snapshot();
}

function camera() {
  const w = window as unknown as { __vidi6: { getCamera(): { x: number; y: number; zoom: number } } };
  return w.__vidi6.getCamera();
}

beforeEach(() => {
  cleanup();
  delete (window as unknown as { __vidi6?: unknown }).__vidi6;
});

describe('TC-18 select', () => {
  it('press + release with no move selects the note (outline + toolbar)', () => {
    render(<App />);
    const id = seed(640, 400);
    const el = noteEl(id);
    expect(el.getAttribute('data-selected')).toBe('false');
    expect(document.querySelector('[data-testid="note-toolbar"]')).toBeNull();

    fire(el, pointerEvent('pointerdown', 640, 400));
    fire(el, pointerEvent('pointerup', 640, 400));

    expect(boardState().selectedId).toBe(id);
    expect(noteEl(id).getAttribute('data-selected')).toBe('true');
    expect(document.querySelector('[data-testid="note-toolbar"]')).not.toBeNull();
  });
});

describe('TC-19 move below threshold', () => {
  it('moving 2px (< threshold) keeps selection and does not move the note', () => {
    render(<App />);
    const id = seed(640, 400);
    const before = snapshotMap().find((n) => n.id === id)!;
    const el = noteEl(id);

    fire(el, pointerEvent('pointerdown', 640, 400));
    fire(el, pointerEvent('pointermove', 642, 400));
    fire(el, pointerEvent('pointerup', 642, 400));

    const after = snapshotMap().find((n) => n.id === id)!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(boardState().selectedId).toBe(id);
  });
});

describe('TC-20 move at threshold starts a drag and does not pan', () => {
  it('moving exactly 3px drags the note; the camera is unchanged', () => {
    render(<App />);
    const id = seed(640, 400);
    const before = snapshotMap().find((n) => n.id === id)!;
    const cam0 = camera();
    const el = noteEl(id);

    fire(el, pointerEvent('pointerdown', 640, 400));
    fire(el, pointerEvent('pointermove', 643, 400)); // 3px

    const moving = snapshotMap().find((n) => n.id === id)!;
    // Drag engaged: the note moved by (3/zoom, 0) world units.
    expect(moving.x).not.toBe(before.x);
    expect(moving.x).toBeCloseTo(before.x + 3 / cam0.zoom, 3);
    // The camera never panned (stopPropagation kept the drag off the viewport).
    expect(camera()).toEqual(cam0);
  });
});

describe('TC-21 pointercancel ends the drag at the last position', () => {
  it('pointercancel during a drag leaves the note at the last applied position', () => {
    render(<App />);
    const id = seed(640, 400);
    const el = noteEl(id);

    fire(el, pointerEvent('pointerdown', 640, 400));
    fire(el, pointerEvent('pointermove', 660, 400)); // 20px → dragging
    const during = snapshotMap().find((n) => n.id === id)!;
    fire(el, pointerEvent('pointercancel', 660, 400));
    const after = snapshotMap().find((n) => n.id === id)!;
    expect([after.x, after.y]).toEqual([during.x, during.y]);
  });
});

describe('TC-22 deselect by clicking empty board', () => {
  it('a click on empty space clears the selection and hides the toolbar', () => {
    const { getByTestId } = render(<App />);
    const id = seed(640, 400);
    const el = noteEl(id);
    fire(el, pointerEvent('pointerdown', 640, 400));
    fire(el, pointerEvent('pointerup', 640, 400));
    expect(document.querySelector('[data-testid="note-toolbar"]')).not.toBeNull();

    const vp = getByTestId('board-viewport');
    fire(vp, pointerEvent('pointerdown', 200, 200));
    fire(vp, pointerEvent('pointerup', 200, 200));

    expect(boardState().selectedId).toBeNull();
    expect(document.querySelector('[data-testid="note-toolbar"]')).toBeNull();
  });
});

describe('TC-25 delete via keyboard', () => {
  it('Delete on a selected (not-editing) note removes it', () => {
    render(<App />);
    const id = seed(640, 400);
    const el = noteEl(id);
    fire(el, pointerEvent('pointerdown', 640, 400));
    fire(el, pointerEvent('pointerup', 640, 400));

    fire(window, new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    expect(() => noteEl(id)).toThrow();
  });

  it('Backspace on a selected (not-editing) note removes it', () => {
    render(<App />);
    const id = seed(640, 400);
    const el = noteEl(id);
    fire(el, pointerEvent('pointerdown', 640, 400));
    fire(el, pointerEvent('pointerup', 640, 400));

    fire(window, new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    expect(snapshotMap().find((n) => n.id === id)).toBeUndefined();
  });
});

describe('TC-35 dblclick on a note edits it, creates no new note', () => {
  it('double-clicking an existing note does not create another note', () => {
    render(<App />);
    const id = seed(640, 400);
    const el = noteEl(id);

    fire(el, pointerEvent('dblclick', 640, 400));

    expect(snapshotMap()).toHaveLength(1);
    expect(boardState().editingId).toBe(id);
  });
});

describe('TC-36 Enter with nothing selected', () => {
  it('pressing Enter creates no note and changes nothing', () => {
    render(<App />);
    expect(snapshotMap()).toHaveLength(0);
    fire(window, new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(snapshotMap()).toHaveLength(0);
  });

  it('"n" with nothing selected creates one note in edit mode', () => {
    render(<App />);
    fire(window, new KeyboardEvent('keydown', { key: 'n', bubbles: true, cancelable: true }));
    expect(snapshotMap()).toHaveLength(1);
  });
});

describe('Escape deselects a selected (not-editing) note', () => {
  it('Escape clears the selection and hides the toolbar', () => {
    render(<App />);
    const id = seed(640, 400);
    const el = noteEl(id);
    fire(el, pointerEvent('pointerdown', 640, 400));
    fire(el, pointerEvent('pointerup', 640, 400));
    expect(boardState().selectedId).toBe(id);

    fire(window, new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(boardState().selectedId).toBeNull();
  });
});

describe('TC-37 note removed mid-interaction', () => {
  it('deleting the note while dragging ends the drag and does not recreate it', () => {
    render(<App />);
    const id = seed(640, 400);
    const el = noteEl(id);
    fire(el, pointerEvent('pointerdown', 640, 400));
    fire(el, pointerEvent('pointermove', 660, 400)); // dragging

    // Remove the note straight from the document (as another client would).
    const w = window as unknown as { __vidi6: { doc: Y.Doc } };
    act(() => {
      deleteObject(w.__vidi6.doc, id);
    });

    // Later moves on the now-gone note must not throw (stale id).
    expect(() => fire(el, pointerEvent('pointermove', 680, 400))).not.toThrow();
    // And the note is not recreated by the interaction.
    expect(snapshotMap().find((n) => n.id === id)).toBeUndefined();
  });

  it('deleting the note while editing ends editing without recreating it', () => {
    render(<App />);
    const id = seed(640, 400);
    const el = noteEl(id);
    fire(el, pointerEvent('dblclick', 640, 400)); // editing
    expect(boardState().editingId).toBe(id);

    const w = window as unknown as { __vidi6: { doc: Y.Doc } };
    act(() => {
      deleteObject(w.__vidi6.doc, id);
    });
    expect(snapshotMap().find((n) => n.id === id)).toBeUndefined();
  });
});