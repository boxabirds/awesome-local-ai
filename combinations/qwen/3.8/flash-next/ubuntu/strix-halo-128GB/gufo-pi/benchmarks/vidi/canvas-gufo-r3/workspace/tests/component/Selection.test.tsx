import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, act, screen, cleanup } from '@testing-library/react';
import React from 'react';
import * as Y from 'yjs';
import { TestBoard, HarnessHandle, VIEWPORT, flushFrames } from './harness';
import { snapshot, createSticky, getStickyText, deleteObject, deleteObjects, moveObjects, objectBounds } from '@shared/board-model';
import { NUDGE_STEP_WORLD, NUDGE_LARGE_STEP_WORLD } from '@shared/config';

describe('TC-16: all selected ids deleted remotely → bar hidden', () => {
  it('selection empty, bar hidden', () => {
    const handle: HarnessHandle = { current: null };
    const { container } = render(
      <TestBoard handle={handle} initialNotes={[{ x: 100, y: 100 }, { x: 400, y: 100 }]} />,
    );
    const notes = snapshot(handle.current!.doc);
    const id1 = notes[0].id;
    const id2 = notes[1].id;

    // Select both via API
    act(() => {
      handle.current!.selection.setMany([id1, id2], false);
    });

    // Bar visible
    expect(container.querySelector('[data-testid="selection-bar"]')).not.toBeNull();

    // Delete both remotely
    act(() => {
      deleteObjects(handle.current!.doc, [id1, id2]);
    });

    // Bar gone
    expect(container.querySelector('[data-testid="selection-bar"]')).toBeNull();
  });
});

describe('TC-17: two selected → "2 selected" + Delete selection button', () => {
  it('bar shows count and delete button with aria', () => {
    const handle: HarnessHandle = { current: null };
    const { container } = render(
      <TestBoard handle={handle} initialNotes={[{ x: 100, y: 100 }, { x: 400, y: 100 }]} />,
    );
    const notes = snapshot(handle.current!.doc);
    const id1 = notes[0].id;
    const id2 = notes[1].id;

    act(() => {
      handle.current!.selection.setMany([id1, id2], false);
    });

    const bar = container.querySelector('[data-testid="selection-bar"]')!;
    expect(bar).not.toBeNull();
    expect(bar.querySelector('[data-testid="selection-count"]')!.textContent).toBe('2 selected');

    const deleteBtn = bar.querySelector('[aria-label="Delete selection"]')!;
    expect(deleteBtn).not.toBeNull();

    // aria-live region announces count
    const countEl = bar.querySelector('[data-testid="selection-count"]')!;
    expect(countEl.getAttribute('aria-live')).toBe('polite');
  });
});

describe('TC-18: one sticky selected → NoteToolbar shown instead of bar', () => {
  it('NoteToolbar visible, no selection bar', () => {
    const handle: HarnessHandle = { current: null };
    const { container } = render(
      <TestBoard handle={handle} initialNotes={[{ x: 200, y: 200 }]} />,
    );
    const id = snapshot(handle.current!.doc)[0].id;

    act(() => {
      handle.current!.selection.click(id);
    });

    // No selection bar for single selection
    expect(container.querySelector('[data-testid="selection-bar"]')).toBeNull();
    // NoteToolbar present
    expect(container.querySelector('[data-testid="note-toolbar"]')).not.toBeNull();
  });
});

describe('TC-19: empty-space click clears selection', () => {
  it('clicking board background clears', () => {
    const handle: HarnessHandle = { current: null };
    const { container } = render(
      <TestBoard handle={handle} initialNotes={[{ x: 200, y: 200 }]} />,
    );
    const id = snapshot(handle.current!.doc)[0].id;

    act(() => {
      handle.current!.selection.click(id);
    });
    expect(handle.current!.selection.ids.size).toBe(1);

    // Click on empty viewport space
    const viewport = container.querySelector('[data-testid="board-viewport"]')!;
    fireEvent.pointerDown(viewport, { pointerId: 1, clientX: 50, clientY: 50, button: 0 });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 50, clientY: 50, button: 0 });

    expect(handle.current!.selection.ids.size).toBe(0);
  });
});

describe('TC-27: Ctrl/Cmd+A selects all', () => {
  it('selects all objects with preventDefault', () => {
    const handle: HarnessHandle = { current: null };
    render(
      <TestBoard handle={handle} initialNotes={[{ x: 100, y: 100 }, { x: 400, y: 100 }, { x: 700, y: 100 }]} />,
    );
    const notes = snapshot(handle.current!.doc);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'a',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(handle.current!.selection.ids.size).toBe(3);
  });
});

describe('TC-28: Ctrl/Cmd+A on empty board → empty, no error', () => {
  it('no error on empty board', () => {
    const handle: HarnessHandle = { current: null };
    render(<TestBoard handle={handle} initialNotes={[]} />);

    const event = new KeyboardEvent('keydown', {
      key: 'a',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(handle.current!.selection.ids.size).toBe(0);
  });
});

describe('TC-29: Arrow nudge', () => {
  it('ArrowRight moves by NUDGE_STEP_WORLD; Shift+ArrowUp by NUDGE_LARGE_STEP_WORLD', () => {
    const handle: HarnessHandle = { current: null };
    render(
      <TestBoard handle={handle} initialNotes={[{ x: 200, y: 200 }]} />,
    );
    const id = snapshot(handle.current!.doc)[0].id;

    act(() => {
      handle.current!.selection.click(id);
    });

    const before = snapshot(handle.current!.doc).find((n) => n.id === id)!;
    const origX = before.x;
    const origY = before.y;

    // ArrowRight
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    }));

    const after1 = snapshot(handle.current!.doc).find((n) => n.id === id)!;
    expect(after1.x).toBeCloseTo(origX + NUDGE_STEP_WORLD);

    // Shift+ArrowUp
    window.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));

    const after2 = snapshot(handle.current!.doc).find((n) => n.id === id)!;
    expect(after2.y).toBeCloseTo(after1.y - NUDGE_LARGE_STEP_WORLD);
  });

  it('preventDefault called (no page scroll)', () => {
    const handle: HarnessHandle = { current: null };
    render(
      <TestBoard handle={handle} initialNotes={[{ x: 200, y: 200 }]} />,
    );
    const id = snapshot(handle.current!.doc)[0].id;
    act(() => { handle.current!.selection.click(id); });

    let prevented = false;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        prevented = e.defaultPrevented;
      }
    };
    window.addEventListener('keydown', handler);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true,
        cancelable: true,
      }));
    });
    window.removeEventListener('keydown', handler);
    expect(prevented).toBe(true);
  });
});

describe('TC-30: Backspace while editing → text edited, objects kept', () => {
  it('objects kept when editing text', () => {
    const handle: HarnessHandle = { current: null };
    const { container } = render(
      <TestBoard handle={handle} initialNotes={[{ x: 200, y: 200, text: 'hello' }]} />,
    );
    const id = snapshot(handle.current!.doc)[0].id;

    // Start editing
    act(() => {
      handle.current!.selection.startEdit(id);
    });

    const before = snapshot(handle.current!.doc);
    expect(before.length).toBe(1);

    // Simulate Backspace key
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    // Object still exists
    const after = snapshot(handle.current!.doc);
    expect(after.length).toBe(1);
  });
});

describe('TC-31: Delete with selection → all removed, selection empty', () => {
  it('deletes selected objects', () => {
    const handle: HarnessHandle = { current: null };
    render(
      <TestBoard handle={handle} initialNotes={[{ x: 100, y: 100 }, { x: 400, y: 100 }]} />,
    );
    const notes = snapshot(handle.current!.doc);
    act(() => {
      handle.current!.selection.setMany([notes[0].id, notes[1].id], false);
    });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(snapshot(handle.current!.doc).length).toBe(0);
    expect(handle.current!.selection.ids.size).toBe(0);
  });
});
