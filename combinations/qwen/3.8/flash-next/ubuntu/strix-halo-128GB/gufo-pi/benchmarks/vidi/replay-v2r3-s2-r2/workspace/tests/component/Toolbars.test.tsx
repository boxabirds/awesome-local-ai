import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { StickyHarness } from './StickyHarness';
import { createSticky, snapshot } from '../../src/shared/board-model';

function harness() {
  const h = window.__harness;
  if (!h) throw new Error('harness not ready');
  return h;
}

function firstNote(): HTMLElement {
  return screen.getAllByTestId('sticky-note')[0] as HTMLElement;
}

function addNote(x = 300, y = 200): string {
  let id = '';
  act(() => {
    id = createSticky(harness().doc, { x, y });
  });
  return id;
}

function tap(el: HTMLElement, x = 100, y = 100) {
  fireEvent.pointerDown(el, { clientX: x, clientY: y, pointerId: 1 });
  fireEvent.pointerUp(el, { clientX: x, clientY: y, pointerId: 1 });
}

beforeEach(() => {
  window.__harness = undefined;
});
afterEach(() => cleanup());

describe('sticky.toolbar', () => {
  it('TC-27: clicking the Pink swatch recolours the note and keeps it selected', () => {
    render(<StickyHarness />);
    const id = addNote();
    tap(firstNote()); // select

    fireEvent.click(screen.getByLabelText('Pink colour'));

    const note = snapshot(harness().doc).find((n) => n.id === id)!;
    expect(note.color).toBe('pink');
    expect(harness().getSelectedId()).toBe(id);
    expect(firstNote().getAttribute('data-selected')).toBe('true');
  });

  it('TC-28: the Sticky note button creates a note centred on the viewport in edit mode', () => {
    render(<StickyHarness />); // viewport 1280x800, camera at origin
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));

    const notes = snapshot(harness().doc);
    expect(notes).toHaveLength(1);
    // centred on viewport centre (640,400) minus half size (100)
    expect(notes[0].x).toBe(540);
    expect(notes[0].y).toBe(300);
    // Editing immediately
    expect(screen.queryByTestId('sticky-textarea')).toBeTruthy();
    expect(harness().getEditingId()).toBe(notes[0].id);
  });

  it('TC-29: the bin button deletes the selected note and clears the selection', () => {
    render(<StickyHarness />);
    const id = addNote();
    tap(firstNote());
    expect(screen.getByTestId('note-toolbar')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Delete note'));

    expect(snapshot(harness().doc)).toHaveLength(0);
    expect(screen.queryAllByTestId('sticky-note')).toHaveLength(0);
    expect(harness().getSelectedId()).toBeNull();
  });
});
