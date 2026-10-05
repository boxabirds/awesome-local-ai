import { describe, expect, it } from 'vitest';
import { act, fireEvent, screen, within } from '@testing-library/react';
import * as Y from 'yjs';
import { deleteObjects, snapshot } from '../../src/shared/board-model';
import {
  boardSurface,
  clickNote,
  clickSurface,
  dragOn,
  noteEl,
  renderBoard,
  seedSticky,
  selectedIds,
  shiftClickAt,
  stubViewportSize,
  textarea,
  withPeer,
} from './boardHarness';

stubViewportSize();

/**
 * Story 7, sel.interaction: the selection is a set with one control above it.
 *
 * The camera is at its default (origin top-left of the viewport, zoom 1), so
 * screen pixels and board units are the same number in these tests.
 */
describe('selection set and selection bar (sel.interaction)', () => {
  it('TC-16 somebody else deleting every selected note empties the selection and hides the bar', () => {
    const { doc, peer } = withPeer();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const b = seedSticky(doc, { x: 300, y: 0 });
    const untouched = seedSticky(doc, { x: 600, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    shiftClickAt(noteEl(container, b));
    expect(container.querySelector('[data-selection-count]')?.textContent).toBe('2 selected');

    // Another person deletes both.
    act(() => {
      deleteObjects(peer, [a, b]);
    });

    expect(container.querySelector('[data-selection-count]')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
    expect(selectedIds(container)).toEqual([]);

    // The empty selection means Delete is nobody's business: the third note stays.
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(snapshot(doc).map((note) => note.id)).toEqual([untouched]);
  });

  it('TC-17 two selected notes: one bar counts them and one delete removes both', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const b = seedSticky(doc, { x: 300, y: 0 });
    const kept = seedSticky(doc, { x: 600, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    shiftClickAt(noteEl(container, b));

    const bar = screen.getByRole('toolbar', { name: 'Selection' });
    expect(within(bar).getByText('2 selected')).toBeTruthy();
    expect(within(bar).getByRole('button', { name: 'Delete selection' })).toBeTruthy();
    // A group gets one control, not a toolbar on each note.
    expect(screen.queryByRole('toolbar', { name: 'Sticky note options' })).toBeNull();

    // The count is announced for a selection made without the focus moving.
    const live = container.querySelector('[data-selection-live]');
    expect(live?.getAttribute('aria-live')).toBe('polite');
    expect(live?.textContent).toBe('2 objects selected');

    fireEvent.click(within(bar).getByRole('button', { name: 'Delete selection' }));

    expect(snapshot(doc).map((note) => note.id)).toEqual([kept]);
    expect(selectedIds(container)).toEqual([]);
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
    expect(container.querySelector('[data-selection-live]')?.textContent).toBe('Selection cleared');
    expect(container.querySelector(`[data-note-id="${a}"]`)).toBeNull();
  });

  it('TC-17 the bar offers no controls while the group is being moved', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const b = seedSticky(doc, { x: 300, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    shiftClickAt(noteEl(container, b));
    expect(screen.getByRole('toolbar', { name: 'Selection' })).toBeTruthy();

    // Mid-drag (no release yet): a control there would be a target the pointer
    // could fall onto, and story 2 already hid the toolbar while dragging.
    dragOn(noteEl(container, a), { x: 20, y: 20 }, { x: 60, y: 60 }, { hold: true });
    expect(noteEl(container, a).dataset.dragging).toBe('true');
    expect(noteEl(container, b).dataset.dragging).toBe('true');
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
    // The live region stays mounted so later changes are still announced.
    expect(container.querySelector('[data-selection-live]')).toBeTruthy();
  });

  it('TC-18 one sticky selected: the note toolbar, not the count bar', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 }, { text: 'Hello' });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));

    const toolbar = screen.getByRole('toolbar', { name: 'Sticky note options' });
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
    expect(container.querySelector('[data-selection-count]')).toBeNull();
    // Story 2's swatches work exactly as before, from the selection's control.
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Green colour' }));
    expect((snapshot(doc)[0] as any).color).toBe('green');
    // Its bin deletes the one note.
    fireEvent.click(within(toolbar).getByRole('button', { name: 'Delete note' }));
    expect(snapshot(doc)).toEqual([]);
  });

  it('TC-18 the toolbar is out of the way while the text is being edited', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    expect(screen.getByRole('toolbar', { name: 'Sticky note options' })).toBeTruthy();

    fireEvent.doubleClick(noteEl(container, a));
    expect(textarea(container)).not.toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Sticky note options' })).toBeNull();

    // Escape closes the editor and the note is still selected.
    fireEvent.keyDown(textarea(container)!, { key: 'Escape' });
    expect(textarea(container)).toBeNull();
    expect(selectedIds(container)).toEqual([a]);
    expect(screen.getByRole('toolbar', { name: 'Sticky note options' })).toBeTruthy();
  });

  it('TC-19 a click on empty board space clears the selection', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const b = seedSticky(doc, { x: 300, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    shiftClickAt(noteEl(container, b));
    expect(selectedIds(container)).toEqual([a, b].sort());

    clickSurface(boardSurface(container), 700, 700);
    expect(selectedIds(container)).toEqual([]);
    expect(screen.queryByRole('toolbar', { name: 'Selection' })).toBeNull();
  });

  it('TC-19 panning the board is not a click and keeps the selection', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    dragOn(boardSurface(container), { x: 700, y: 700 }, { x: 640, y: 660 });

    expect(selectedIds(container)).toEqual([a]);
  });

  it('Shift+clicking a selected note takes only it out of the selection', () => {
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const b = seedSticky(doc, { x: 300, y: 0 });
    const c = seedSticky(doc, { x: 600, y: 0 });
    const { container } = renderBoard(doc);

    clickNote(noteEl(container, a));
    shiftClickAt(noteEl(container, b));
    shiftClickAt(noteEl(container, c));
    expect(selectedIds(container)).toEqual([a, b, c].sort());

    shiftClickAt(noteEl(container, b));
    expect(selectedIds(container)).toEqual([a, c].sort());
    expect(container.querySelector('[data-selection-count]')?.textContent).toBe('2 selected');
  });

  it('a note that disappears mid-drag does not take the drag down with it', () => {
    // Story 2's TC-37, now on the shared gesture: the pointer keeps moving over a
    // detached element, which must not throw and must not bring the note back.
    const doc = new Y.Doc();
    const a = seedSticky(doc, { x: 0, y: 0 });
    const { container } = renderBoard(doc);
    const el = noteEl(container, a);

    dragOn(el, { x: 20, y: 20 }, { x: 120, y: 120 }, { hold: true });
    act(() => {
      deleteObjects(doc, [a]);
    });
    fireEvent.pointerMove(el, { clientX: 200, clientY: 200, button: 0, pointerId: 3 });
    fireEvent.pointerUp(el, { clientX: 200, clientY: 200, button: 0, pointerId: 3 });

    expect(snapshot(doc)).toEqual([]);
    expect(container.querySelector(`[data-note-id="${a}"]`)).toBeNull();
  });
});
