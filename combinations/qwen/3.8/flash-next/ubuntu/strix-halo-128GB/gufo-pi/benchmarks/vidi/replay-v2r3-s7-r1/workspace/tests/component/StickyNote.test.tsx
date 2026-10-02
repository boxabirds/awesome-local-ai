import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { createSticky, deleteObject, snapshot } from '../../src/shared/board-model';
import { STICKY_SIZE_WORLD } from '../../src/shared/config';
import { pointer, frames } from './pointerUtils';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup() {
  const handleRef = createRef<HarnessHandle | null>();
  render(<BoardHarness handleRef={handleRef} />);
  const handle = handleRef.current!;
  return {
    handle,
    doc: handle.doc,
    // Creating through act so the document observer's React update is flushed.
    create: (x: number, y: number) => {
      let id = '';
      act(() => {
        id = createSticky(handle.doc, { x, y });
      });
      return id;
    },
    board: () => document.querySelector<HTMLElement>('[data-grid-layer="true"]')!,
  };
}

const HALF = STICKY_SIZE_WORLD / 2;

describe('StickyNote: select, drag, keyboard', () => {
  it('TC-18: press and release without movement selects the note and shows the toolbar', () => {
    const { handle, create } = setup();
    const id = create(0, 0);
    frames();

    const note = screen.getByTestId('sticky-note');
    expect(note).toHaveAttribute('data-selected', 'false');
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();

    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointerup', 640, 400);
    frames();

    expect(handle.getSelectedId()).toBe(id);
    expect(note).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Sticky note' })).toBeInTheDocument();
  });

  it('TC-19: a 2px move stays under the threshold and does not move the note', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();
    const before = snapshot(doc)[0];

    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointermove', 642, 401);
    pointer(window, 'pointerup', 642, 401);
    frames();

    const after = snapshot(doc)[0];
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(after.z).toBe(before.z);
    expect(handle.getSelectedId()).toBe(id);
  });

  it('TC-20: a 3px move starts dragging, moves the note and leaves the camera alone', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();
    const cameraBefore = handle.getCamera();

    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointermove', 643, 400);
    frames();

    const moved = snapshot(doc)[0];
    expect(moved.x).toBeCloseTo(-HALF + 3, 6);
    expect(moved.y).toBeCloseTo(-HALF, 6);
    expect(handle.getCamera()).toEqual(cameraBefore);

    pointer(window, 'pointerup', 643, 400);
    frames();
    expect(handle.getSelectedId()).toBe(id);
  });

  it('TC-21: pointercancel ends the drag and keeps the last applied position', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();

    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 180, 130);
    frames();
    const applied = snapshot(doc)[0];

    pointer(window, 'pointercancel', 900, 900);
    frames();
    pointer(window, 'pointermove', 1200, 1200);
    frames();

    const after = snapshot(doc)[0];
    expect(after.x).toBe(applied.x);
    expect(after.y).toBe(applied.y);
    expect(handle.getSelectedId()).toBe(id);
  });

  it('TC-22: clicking empty board space clears the selection and the toolbar', () => {
    const { handle, create, board } = setup();
    create(0, 0);
    frames();

    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointerup', 640, 400);
    frames();
    expect(handle.getSelectedId()).not.toBeNull();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    const surface = board();
    pointer(surface, 'pointerdown', 300, 300);
    // The viewport captures the pointer, so the release arrives on the same layer.
    pointer(surface, 'pointerup', 300, 300);
    frames();

    expect(handle.getSelectedId()).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
  });

  it('TC-25: Delete removes the selected note', () => {
    const { handle, doc, create } = setup();
    create(0, 0);
    frames();

    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointerup', 640, 400);
    frames();

    fireEvent.keyDown(window, { key: 'Delete' });
    frames();

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).not.toBeInTheDocument();
    expect(handle.getSelectedId()).toBeNull();
  });

  it('TC-25b: Backspace removes the selected note', () => {
    const { handle, doc, create } = setup();
    create(0, 0);
    frames();

    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointerup', 640, 400);
    frames();

    fireEvent.keyDown(window, { key: 'Backspace' });
    frames();

    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getSelectedId()).toBeNull();
  });

  it('TC-35: double-clicking a note edits it instead of creating another', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();

    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointerup', 640, 400);
    fireEvent.doubleClick(note, { clientX: 640, clientY: 400 });
    frames();

    expect(snapshot(doc)).toHaveLength(1);
    expect(handle.getEditingId()).toBe(id);
    expect(screen.getByTestId('sticky-note-editor')).toBeInTheDocument();
  });

  it('TC-36: Enter with nothing selected creates and edits nothing', () => {
    const { handle, doc } = setup();
    frames();

    fireEvent.keyDown(window, { key: 'Enter' });
    frames();

    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getEditingId()).toBeNull();
    expect(screen.queryByTestId('sticky-note-editor')).not.toBeInTheDocument();
  });

  it('TC-37: a note deleted while dragging ends the interaction silently', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();

    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 200, 150);
    frames();

    expect(() => {
      act(() => {
        deleteObject(doc, id);
      });
      frames();
    }).not.toThrow();

    pointer(window, 'pointermove', 400, 400);
    frames();
    pointer(window, 'pointerup', 400, 400);
    frames();

    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByTestId('sticky-note')).not.toBeInTheDocument();
    expect(handle.getSelectedId()).toBeNull();
  });

  it('TC-37b: a note deleted while editing closes the editor silently', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();

    const note = screen.getByTestId('sticky-note');
    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointerup', 640, 400);
    fireEvent.doubleClick(note, { clientX: 640, clientY: 400 });
    frames();
    expect(screen.getByTestId('sticky-note-editor')).toBeInTheDocument();

    expect(() => {
      act(() => {
        deleteObject(doc, id);
      });
      frames();
    }).not.toThrow();

    expect(screen.queryByTestId('sticky-note-editor')).not.toBeInTheDocument();
    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getEditingId()).toBeNull();
  });

  it('dragging the bottom note raises it above the other one', () => {
    const { doc, create } = setup();
    const bottom = create(0, 0);
    const top = create(40, 0);
    frames();
    expect(snapshot(doc).map((n) => n.id)).toEqual([bottom, top]);

    const bottomEl = screen.getAllByTestId('sticky-note')[0];
    pointer(bottomEl, 'pointerdown', 100, 100);
    pointer(window, 'pointermove', 30, 100);
    frames();
    pointer(window, 'pointerup', 30, 100);
    frames();

    const ordered = snapshot(doc);
    expect(ordered.map((n) => n.id)).toEqual([top, bottom]);
    expect(ordered[1].z).toBeGreaterThan(ordered[0].z);
  });
});
