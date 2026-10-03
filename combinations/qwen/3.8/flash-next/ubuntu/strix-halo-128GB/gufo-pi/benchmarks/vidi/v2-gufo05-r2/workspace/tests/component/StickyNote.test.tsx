import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { deleteObject, snapshot } from '../../src/shared/board-model';
import {
  clickNote,
  dblClickNote,
  dragNote,
  fireKey,
  firePointer,
  flushFrames,
  noteEl,
  readCamera,
  renderApp,
  seedSticky,
  surface,
  textareaFor,
} from './stickyHarness';

describe('sticky.interaction — select and move', () => {
  it('TC-18: a short press selects the note and shows the outline and toolbar', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    clickNote(id);
    expect(noteEl(id).dataset.selected).toBe('true');
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pink colour' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete note' })).toBeTruthy();
    // The note is reachable and labelled for assistive tech.
    expect(noteEl(id).getAttribute('role')).toBe('group');
    expect(noteEl(id).getAttribute('aria-label')).toBe('Sticky note');
  });

  it('TC-19: a 2px move (below the threshold) selects without moving the note', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    const before = snapshot(doc)[0]!;
    const el = noteEl(id);
    firePointer(el, 'pointerdown', 100, 100);
    firePointer(el, 'pointermove', 102, 100);
    firePointer(el, 'pointerup', 102, 100);
    flushFrames();
    const after = snapshot(doc)[0]!;
    expect(after.x).toBe(before.x);
    expect(after.y).toBe(before.y);
    expect(noteEl(id).dataset.selected).toBe('true');
  });

  it('TC-20: a 3px move drags the note and leaves the board camera unchanged', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    const beforeCamera = readCamera();
    dragNote(id, { x: 100, y: 100 }, { x: 110, y: 100 });
    const after = snapshot(doc)[0]!;
    expect(after.x).toBeCloseTo(-90, 5); // moved by 10 world units at zoom 1
    const afterCamera = readCamera();
    expect(afterCamera.x).toBe(beforeCamera.x);
    expect(afterCamera.y).toBe(beforeCamera.y);
    expect(afterCamera.zoom).toBe(beforeCamera.zoom);
  });

  it('TC-21: pointercancel during a drag keeps the last position and selects', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    dragNote(id, { x: 100, y: 100 }, { x: 110, y: 100 });
    const moved = snapshot(doc)[0]!.x;
    firePointer(noteEl(id), 'pointercancel', 110, 100);
    flushFrames();
    expect(snapshot(doc)[0]!.x).toBe(moved);
    expect(noteEl(id).dataset.selected).toBe('true');
  });

  it('TC-22: clicking empty board space clears the selection and hides the toolbar', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    clickNote(id);
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();
    firePointer(surface(), 'pointerdown', 500, 500);
    firePointer(surface(), 'pointerup', 500, 500);
    flushFrames();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
    expect(noteEl(id).dataset.selected).toBe('false');
  });
});

describe('sticky.interaction — delete and edit entry', () => {
  it('TC-25: Delete on a selected note removes it', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    clickNote(id);
    fireKey('Delete');
    flushFrames();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-25: Backspace on a selected note removes it', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    clickNote(id);
    fireKey('Backspace');
    flushFrames();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-35: double-clicking a note edits it and creates nothing new', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    dblClickNote(id);
    expect(snapshot(doc)).toHaveLength(1);
    expect(textareaFor(id)).not.toBeNull();
  });

  it('TC-36: Enter with nothing selected does nothing', () => {
    const doc = renderApp();
    fireKey('Enter');
    flushFrames();
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});

describe('sticky.interaction — note removed mid-interaction', () => {
  it('TC-37: deleting a note mid-drag ends the drag without throwing or recreating', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    const el = noteEl(id);
    dragNote(id, { x: 100, y: 100 }, { x: 115, y: 100 });
    act(() => {
      deleteObject(doc, id);
    });
    expect(() => {
      firePointer(el, 'pointermove', 120, 100);
      firePointer(el, 'pointerup', 120, 100);
      flushFrames();
    }).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
  });

  it('TC-37: deleting a note mid-edit ends editing without throwing or recreating', () => {
    const doc = renderApp();
    const id = seedSticky(doc);
    dblClickNote(id);
    expect(textareaFor(id)).not.toBeNull();
    expect(() => {
      act(() => {
        deleteObject(doc, id);
      });
      flushFrames();
    }).not.toThrow();
    expect(snapshot(doc)).toHaveLength(0);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
  });
});