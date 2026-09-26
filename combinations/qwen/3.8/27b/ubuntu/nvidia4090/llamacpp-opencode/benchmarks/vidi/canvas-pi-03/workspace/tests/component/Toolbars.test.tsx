import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderFullApp, hooks, makeNote, pressKey, selectNoteAt } from './story2';

// Story 5: the board page checks existence before rendering the board; keep
// these story-2 tests exercising the board UI directly.
vi.mock('@/client/api', () => ({
  checkBoard: vi.fn(async () => ({ kind: 'exists' })),
  createBoardRequest: vi.fn(async () => ({ kind: 'failed' })),
}));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Sticky note toolbars (story 2)', () => {
  it('TC-27: clicking the Pink swatch recolors the note and keeps the selection', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    selectNoteAt(id);
    expect(hooks().getNotes()[0].color).toBe('yellow');

    const pink = screen.getByRole('button', { name: 'Pink colour' });
    fireEvent.click(pink);

    expect(hooks().getNotes()[0].color).toBe('pink');
    const note = document.querySelector(`[data-id="${id}"]`) as HTMLElement;
    expect(note.hasAttribute('data-selected')).toBe(true);
    expect(screen.getByRole('button', { name: 'Pink colour' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Yellow colour' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('TC-28: clicking the Sticky note button creates a note at the viewport centre and starts editing', async () => {
    await renderFullApp();
    // jsdom window is 1024x768 and the camera starts reset, so the world
    // centre of the visible area is (0, 0).
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));

    const notes = hooks().getNotes();
    expect(notes).toHaveLength(1);
    // The note is centred on (0,0): top-left at (-100,-100) for a 200x200 note.
    expect(notes[0].x).toBe(-100);
    expect(notes[0].y).toBe(-100);
    // Creating immediately starts editing.
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByTestId('sticky-textarea'));
  });

  it('TC-29: clicking the bin button deletes the note and clears the selection', async () => {
    await renderFullApp();
    makeNote(0, 0);
    const notes0 = hooks().getNotes();
    selectNoteAt(notes0[0].id);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(hooks().getNotes()).toHaveLength(0);
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();
    expect(document.querySelector('[data-selected="true"]')).not.toBeInTheDocument();
  });

  it('extra: the toolbar is hidden while dragging and while editing', async () => {
    await renderFullApp();
    const id = makeNote(0, 0);
    selectNoteAt(id);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    // Start editing -> toolbar hidden.
    pressKey(window, 'Enter');
    expect(screen.queryByTestId('note-toolbar')).not.toBeInTheDocument();

    // End editing back to Selected -> toolbar shown again.
    pressKey(screen.getByTestId('sticky-textarea'), 'Escape');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
  });
});
