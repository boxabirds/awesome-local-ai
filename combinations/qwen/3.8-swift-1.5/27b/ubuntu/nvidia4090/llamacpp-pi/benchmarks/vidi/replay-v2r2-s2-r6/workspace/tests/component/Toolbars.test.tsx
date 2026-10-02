import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { snapshot } from '../../src/shared/board-model';
import { renderApp, createNote } from './renderApp';
import { createPointerEvent } from './helpers';

function dispatchPointer(el: HTMLElement, type: string, props: { clientX?: number; clientY?: number; pointerId?: number; button?: number }) {
  act(() => {
    el.dispatchEvent(createPointerEvent(type, props));
  });
}

function selectNote(note: HTMLElement) {
  dispatchPointer(note, 'pointerdown', { clientX: 640, clientY: 400, pointerId: 1, button: 0 });
  dispatchPointer(note, 'pointerup', { clientX: 640, clientY: 400, pointerId: 1, button: 0 });
}

describe('toolbars (NoteToolbar + Toolbar)', () => {
  it('TC-27 pink swatch → model colour pink, selection retained', async () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    selectNote(note);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Pink colour' }));

    expect(snapshot(doc).find((n) => n.id === id)!.color).toBe('pink');
    expect(note).toHaveAttribute('data-selected');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    // The note background reflects the new colour (jsdom normalises 'pink')
    expect(note.style.backgroundColor).toBe('rgb(244, 143, 177)');
  });

  it('TC-28 sticky note button → exactly one note centred on the viewport centre, Editing', async () => {
    const { doc } = renderApp();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sticky note' }));

    const snap = snapshot(doc);
    expect(snap).toHaveLength(1);
    // Viewport centre (640,400) at the default camera maps to world (0,0),
    // so the note (200×200) is centred there: top-left (-100,-100).
    expect(snap[0].x).toBe(-100);
    expect(snap[0].y).toBe(-100);
    // The new note is immediately editable
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();
  });

  it('TC-29 bin button → note removed from model, selection cleared', async () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    selectNote(note);
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Delete note' }));

    expect(snapshot(doc).find((n) => n.id === id)).toBeUndefined();
    expect(screen.queryByTestId('sticky-note')).toBeNull();
    expect(screen.queryByTestId('note-toolbar')).toBeNull();
  });
});
