import { describe, it, expect } from 'vitest';
import { fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderBoard,
  createViaToolbar,
  escape,
  typeInto,
  pressWindow,
} from './stickyTestUtils.tsx';

describe('sticky.text editor (sticky.text)', () => {
  // TC-23: Enter on a selected note starts editing, textarea focused, caret at end.
  it('TC-23 starts editing with the caret at the end of the text', async () => {
    const h = renderBoard();
    createViaToolbar(h);
    typeInto(h, 'hello');
    escape(h);
    expect(h.editor()).toBeNull(); // editing ended, now just selected

    pressWindow('Enter');
    const ed = h.editor() as HTMLTextAreaElement | null;
    expect(ed).toBeTruthy();
    expect(document.activeElement).toBe(ed);
    expect(ed!.value).toBe('hello');
    expect(ed!.selectionStart).toBe(5);
    expect(ed!.selectionEnd).toBe(5);
  });

  // TC-24: Escape ends editing and keeps the typed text.
  it('TC-24 keeps text on Escape and returns to selected', () => {
    const h = renderBoard();
    createViaToolbar(h);
    typeInto(h, 'abc');
    escape(h);

    expect(h.editor()).toBeNull();
    const noteEl = h.note(0);
    expect(noteEl.getAttribute('data-selected')).toBe('true');
    expect(noteEl.textContent).toContain('abc');
  });

  // TC-26 (negative): Backspace while editing edits text, never deletes the note.
  it('TC-26 Backspace edits text without deleting the note', async () => {
    const user = userEvent.setup();
    const h = renderBoard();
    createViaToolbar(h);
    const ed0 = h.editor() as HTMLTextAreaElement;
    await user.type(ed0, 'ab');
    await user.keyboard('{Backspace}');

    expect(h.notes()).toHaveLength(1); // note still present
    const ed = h.editor() as HTMLTextAreaElement;
    expect(ed.value).toBe('a');
  });

  // TC-38: type 'abc' then click outside -> editor unmounted, Y.Text kept, Unselected.
  it('TC-38 commits text and deselects on an outside click', () => {
    const h = renderBoard();
    createViaToolbar(h);
    typeInto(h, 'abc');

    const vp = h.viewport();
    fireEvent.pointerDown(vp, { clientX: 20, clientY: 20, button: 0, pointerId: 2 });
    fireEvent.pointerUp(vp, { clientX: 20, clientY: 20, pointerId: 2 });

    expect(h.editor()).toBeNull();
    const noteEl = h.note(0);
    expect(noteEl.getAttribute('data-selected')).toBe('false');
    expect(noteEl.textContent).toContain('abc');
  });

  // The character counter appears only near the limit and shows n/1000.
  it('shows the counter only within the threshold of the limit', () => {
    const h = renderBoard();
    createViaToolbar(h);
    typeInto(h, 'short');
    expect(h.view.queryByTestId('sticky-counter')).toBeNull();

    typeInto(h, 'x'.repeat(960));
    const counter = h.view.getByTestId('sticky-counter');
    expect(counter.textContent).toBe('960/1000');
  });

  // Typing beyond the limit is clamped to 1,000 characters.
  it('clamps typed text to 1,000 characters', () => {
    const h = renderBoard();
    createViaToolbar(h);
    typeInto(h, 'y'.repeat(1200));
    const ed = h.editor() as HTMLTextAreaElement;
    expect(ed.value.length).toBe(1000);
    const counter = h.view.getByTestId('sticky-counter');
    expect(counter.textContent).toBe('1000/1000');
  });
});
