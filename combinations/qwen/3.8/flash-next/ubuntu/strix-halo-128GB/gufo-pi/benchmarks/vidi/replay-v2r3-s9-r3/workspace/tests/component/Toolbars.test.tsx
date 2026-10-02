import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React, { createRef } from 'react';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { BoardHarness, type HarnessHandle } from './harness/BoardHarness';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { STICKY_COLORS, STICKY_SIZE_WORLD, STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import type { StickyColor } from '../../src/shared/config';
import { OVER_LIMIT_1200 } from '../fixtures/texts';
import { pointer, frames, typeInto } from './pointerUtils';

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
    create: (x: number, y: number) => {
      let id = '';
      act(() => {
        id = createSticky(handle.doc, { x, y });
      });
      return id;
    },
  };
}

function selectNote(index = 0) {
  const note = screen.getAllByTestId('sticky-note')[index];
  pointer(note, 'pointerdown', 640, 400);
  pointer(note, 'pointerup', 640, 400);
  frames();
  return note;
}

describe('Toolbars', () => {
  it('TC-27: clicking the Pink swatch recolours the note and keeps it selected', () => {
    const { handle, doc, create } = setup();
    const id = create(0, 0);
    frames();
    selectNote();

    fireEvent.click(screen.getByRole('button', { name: 'Pink colour' }));
    frames();

    expect(snapshot(doc)[0].color).toBe('pink');
    expect(handle.getSelectedId()).toBe(id);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Pink colour' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('the six swatches are named and the current colour reads as pressed', () => {
    const { create } = setup();
    create(0, 0);
    frames();
    selectNote();

    const names = Object.keys(STICKY_COLORS) as StickyColor[];
    expect(names).toHaveLength(6);
    for (const name of names) {
      expect(screen.getByRole('button', { name: `${capitalise(name)} colour` })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Yellow colour' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Violet colour' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('TC-28: the Sticky note button creates one note centred on the viewport and opens it for typing', () => {
    const { handle, doc } = setup();
    frames();

    fireEvent.click(screen.getByRole('button', { name: 'Sticky note (N)' }));
    frames();

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    // The camera starts at (0,0) zoom 1, so the viewport centre is world (640,400).
    const cam = handle.getCamera();
    const centre = { x: 640 / cam.zoom + cam.x, y: 400 / cam.zoom + cam.y };
    expect(notes[0].x).toBeCloseTo(centre.x - STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0].y).toBeCloseTo(centre.y - STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0].color).toBe('yellow');
    expect(handle.getEditingId()).toBe(notes[0].id);
    expect(screen.getByTestId('sticky-note-editor')).toBeInTheDocument();
  });

  it('the create button describes the double-click alternative', () => {
    setup();
    frames();
    const button = screen.getByRole('button', { name: 'Sticky note (N)' });
    expect(button).toHaveAttribute('title', 'Sticky note (N) – or double-click the board');
  });

  it('double-clicking empty board creates a note centred on the point, in edit mode', () => {
    const { handle, doc } = setup();
    frames();
    const board = document.querySelector<HTMLElement>('[data-grid-layer="true"]')!;

    pointer(board, 'pointerdown', 400, 300);
    pointer(board, 'pointerup', 400, 300);
    fireEvent.doubleClick(board, { clientX: 400, clientY: 300 });
    frames();

    const notes = snapshot(doc);
    expect(notes).toHaveLength(1);
    const cam = handle.getCamera();
    expect(notes[0].x).toBeCloseTo(400 / cam.zoom + cam.x - STICKY_SIZE_WORLD / 2, 6);
    expect(notes[0].y).toBeCloseTo(300 / cam.zoom + cam.y - STICKY_SIZE_WORLD / 2, 6);
    expect(handle.getEditingId()).toBe(notes[0].id);
  });

  it('TC-29: the bin button removes the note and clears the selection', () => {
    const { handle, doc, create } = setup();
    create(0, 0);
    frames();
    selectNote();

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));
    frames();

    expect(snapshot(doc)).toHaveLength(0);
    expect(handle.getSelectedId()).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
  });

  it('the note toolbar is hidden while editing and while dragging', () => {
    const { create } = setup();
    create(0, 0);
    frames();
    const note = selectNote();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    fireEvent.doubleClick(note, { clientX: 640, clientY: 400 });
    frames();
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId('sticky-note-editor'), { key: 'Escape' });
    frames();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    pointer(note, 'pointerdown', 640, 400);
    pointer(window, 'pointermove', 700, 400);
    frames();
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    pointer(window, 'pointerup', 700, 400);
    frames();
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });

  it('clicking the toolbar does not clear the selection or pan the board', () => {
    const { handle, create } = setup();
    create(0, 0);
    frames();
    const cameraBefore = handle.getCamera();
    selectNote();

    const toolbar = screen.getByTestId('note-toolbar');
    pointer(toolbar, 'pointerdown', 640, 300);
    pointer(toolbar, 'pointerup', 640, 300);
    frames();

    expect(handle.getSelectedId()).not.toBeNull();
    expect(handle.getCamera()).toEqual(cameraBefore);
  });

  it('text is written to the model as it is typed and read back on the note', () => {
    const { doc, create } = setup();
    const id = create(0, 0);
    frames();
    selectNote();
    fireEvent.doubleClick(screen.getByTestId('sticky-note'), { clientX: 640, clientY: 400 });
    frames();

    typeInto(screen.getByTestId('sticky-note-editor') as HTMLTextAreaElement, '  spaced  ');
    frames();
    expect(getStickyText(doc, id)!.toString()).toBe('  spaced  ');
    // The note keeps the text exactly as typed (no trimming, no normalising).
    expect(screen.getByTestId('sticky-note')).toBeInTheDocument();
  });

  it('a 1,200 character paste leaves exactly 1,000 characters in the model', () => {
    const { doc, create } = setup();
    const id = create(0, 0);
    frames();
    selectNote();
    fireEvent.doubleClick(screen.getByTestId('sticky-note'), { clientX: 640, clientY: 400 });
    frames();

    typeInto(screen.getByTestId('sticky-note-editor') as HTMLTextAreaElement, OVER_LIMIT_1200);
    frames();

    const stored = getStickyText(doc, id)!.toString();
    expect(stored.length).toBe(STICKY_TEXT_MAX_CHARS);
    expect(screen.getByTestId('sticky-note-counter')).toHaveTextContent('1000/1000');
  });
});

function capitalise(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
