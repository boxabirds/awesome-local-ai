// sel.interaction + sel.keyboard (story 7): TC-16 to TC-19, TC-27 to TC-31.
//
// Full-app tests: selection bar, prune on remote deletion, clear on
// empty-space click, and the board keyboard shortcuts.

import { act, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteObjects, type ObjectSnapshot } from '../../src/shared/board-model';
import { installResizeObserverMock } from './helpers';
import { board, dispatchOn, keyedPointerEvent, liveNotes, noteAt, noteEls, selectionBar, selectionCount } from './story7-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
});

function clickNote(el: HTMLElement): void {
  dispatchOn(el, keyedPointerEvent('pointerdown', 640, 400));
  dispatchOn(el, keyedPointerEvent('pointerup', 640, 400));
}

function clickEmpty(container: HTMLElement): void {
  const vp = container.querySelector<HTMLElement>('[data-testid="board-viewport"]');
  if (vp === null) throw new Error('viewport not found');
  dispatchOn(vp, keyedPointerEvent('pointerdown', 100, 100));
  dispatchOn(vp, keyedPointerEvent('pointerup', 100, 100));
}

function selectAll(container: HTMLElement): void {
  void container;
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
  });
}

describe('sel.interaction — selection bar + prune + clear', () => {
  it('TC-16 all selected notes deleted (remote) → selection empty, bar hidden', async () => {
    const { container, doc } = await board();
    let ids: string[] = [];
    act(() => {
      ids = [noteAt(0, 0), noteAt(300, 0)];
    });
    selectAll(container);
    expect(selectionCount(container)).toBe('2 selected');

    // A remote client deletes both notes: the selection prunes itself.
    act(() => {
      deleteObjects(doc, ids);
    });
    expect(noteEls(container)).toHaveLength(0);
    expect(selectionBar(container)).toBeNull();
    expect(selectionCount(container)).toBeNull();
  });

  it('TC-17 two selected → "2 selected" + Delete; aria-live announcement; Delete removes both', async () => {
    const { container } = await board();
    act(() => {
      noteAt(0, 0);
      noteAt(300, 0);
    });
    selectAll(container);

    const count = container.querySelector<HTMLElement>('[data-testid="selection-count"]');
    expect(count).not.toBeNull();
    expect(count?.textContent).toBe('2 selected');
    expect(count?.getAttribute('aria-live')).toBe('polite');
    const bar = selectionBar(container);
    expect(bar).not.toBeNull();
    expect(bar?.getAttribute('aria-label')).toBe('Selection actions');

    const del = bar!.querySelector<HTMLButtonElement>('button[aria-label="Delete selection"]');
    expect(del).not.toBeNull();
    act(() => {
      del!.click();
    });
    expect(noteEls(container)).toHaveLength(0);
    expect(selectionBar(container)).toBeNull();
  });

  it('TC-18 one sticky selected → the NoteToolbar, not the multi-select bar', async () => {
    const { container } = await board();
    act(() => {
      noteAt(0, 0);
    });
    const [a] = noteEls(container);
    clickNote(a!);
    expect(selectionBar(container)).toBeNull();
    expect(container.querySelector('[data-testid="note-toolbar"]')).not.toBeNull();
  });

  it('TC-19 empty-space click without drag clears the selection', async () => {
    const { container } = await board();
    act(() => {
      noteAt(0, 0);
      noteAt(300, 0);
    });
    selectAll(container);
    expect(selectionCount(container)).toBe('2 selected');

    clickEmpty(container);
    expect(selectionBar(container)).toBeNull();
    expect(noteEls(container).every((n) => !n.hasAttribute('data-selected'))).toBe(true);
  });
});

describe('sel.keyboard — Ctrl+A, nudge, Delete, editing guard', () => {
  it('TC-27 Ctrl+A selects every object; preventDefault stops page selection', async () => {
    const { container } = await board();
    act(() => {
      noteAt(0, 0);
      noteAt(300, 0);
      noteAt(0, 300);
    });
    const event = new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(selectionCount(container)).toBe('3 selected');
    expect(noteEls(container).filter((n) => n.hasAttribute('data-selected'))).toHaveLength(3);
  });

  it('TC-28 Ctrl+A on an empty board → no selection, no error', async () => {
    const { container } = await board();
    selectAll(container);
    expect(selectionBar(container)).toBeNull();
    expect(noteEls(container)).toHaveLength(0);
  });

  it('TC-29 ArrowRight nudges +1; Shift+ArrowUp nudges -10; preventDefault stops page scroll', async () => {
    const { container } = await board();
    act(() => {
      noteAt(0, 0);
    });
    selectAll(container);

    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(right);
    });
    expect(right.defaultPrevented).toBe(true);
    let note = liveNotes()[0] as ObjectSnapshot;
    expect(note.x).toBe(1);
    expect(note.y).toBe(0);

    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(up);
    });
    expect(up.defaultPrevented).toBe(true);
    note = liveNotes()[0] as ObjectSnapshot;
    expect(note.x).toBe(1);
    expect(note.y).toBe(-10);
  });

  it('TC-30 Backspace while editing text edits the text, never deletes the objects', async () => {
    const { container } = await board();
    let id = '';
    act(() => {
      id = noteAt(0, 0);
    });

    // Double-click enters edit mode.
    const el = noteEls(container)[0];
    dispatchOn(el, new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: 640, clientY: 400 }));
    const ta = document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-editor"] textarea');
    expect(ta).not.toBeNull();
    act(() => {
      ta!.value = 'ab';
      ta!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Backspace inside the editor is consumed by the textarea (the board
    // keys are inert while editing): it edits the text, not the board.
    act(() => {
      ta!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }));
    });
    act(() => {
      ta!.value = 'a';
      ta!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    // Escape ends editing; the note survives with its (edited) text.
    act(() => {
      ta!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(noteEls(container)).toHaveLength(1);
    expect(noteEls(container)[0].dataset.id).toBe(id);
    expect(liveNotes()[0]?.text).toBe('a');
  });

  it('TC-31 Delete removes every selected object; selection empties', async () => {
    const { container } = await board();
    act(() => {
      noteAt(0, 0);
      noteAt(300, 0);
    });
    selectAll(container);
    expect(selectionCount(container)).toBe('2 selected');

    const del = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    act(() => {
      window.dispatchEvent(del);
    });
    expect(del.defaultPrevented).toBe(true);
    expect(noteEls(container)).toHaveLength(0);
    expect(selectionBar(container)).toBeNull();
  });
});
