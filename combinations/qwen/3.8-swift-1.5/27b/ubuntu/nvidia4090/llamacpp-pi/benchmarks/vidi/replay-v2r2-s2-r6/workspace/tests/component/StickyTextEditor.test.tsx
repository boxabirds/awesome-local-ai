import { describe, it, expect } from 'vitest';
import { screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { snapshot } from '../../src/shared/board-model';
import { renderApp, createNote, setNoteText } from './renderApp';
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

function startEditing(note: HTMLElement) {
  act(() => {
    note.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
}

function keyOnWindow(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

describe('sticky.editing (StickyTextEditor)', () => {
  it('TC-23 Enter on Selected note → Editing; textarea focused, caret at end', () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    setNoteText(doc, id, 'Hello');
    const note = screen.getByRole('group', { name: 'Sticky note' });
    selectNote(note);

    keyOnWindow('Enter');

    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
    expect(textarea).toHaveFocus();
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
  });

  it('TC-24 Escape while Editing → Selected; text preserved', () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    setNoteText(doc, id, 'Hello');
    const note = screen.getByRole('group', { name: 'Sticky note' });
    selectNote(note);
    keyOnWindow('Enter');
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;

    act(() => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(note).toHaveAttribute('data-selected');
    expect(screen.getByTestId('note-toolbar')).toBeInTheDocument();
    expect(snapshot(doc).find((n) => n.id === id)!.text).toBe('Hello');
  });

  it('TC-26 Backspace while Editing "ab" → note remains, text is "a" (negative)', async () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    setNoteText(doc, id, 'ab');
    const note = screen.getByRole('group', { name: 'Sticky note' });
    selectNote(note);
    keyOnWindow('Enter');
    const textarea = screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;

    const user = userEvent.setup();
    await user.click(textarea); // focus (mount already focused this)
    await user.keyboard('{Backspace}');

    expect(snapshot(doc).find((n) => n.id === id)!.text).toBe('a');
    expect(screen.getByRole('group', { name: 'Sticky note' })).toBeInTheDocument();
  });

  it('TC-38 type "abc" then click outside → editor unmounted; Y.Text is "abc"; note Unselected', async () => {
    const { doc } = renderApp();
    const id = createNote(doc);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    startEditing(note);
    expect(screen.getByTestId('sticky-textarea')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.keyboard('abc');
    expect(snapshot(doc).find((n) => n.id === id)!.text).toBe('abc');

    const viewport = screen.getByTestId('board-viewport');
    dispatchPointer(viewport, 'pointerdown', { clientX: 100, clientY: 100, pointerId: 1, button: 0 });

    expect(screen.queryByTestId('sticky-textarea')).toBeNull();
    expect(snapshot(doc).find((n) => n.id === id)!.text).toBe('abc');
    expect(note).not.toHaveAttribute('data-selected');
  });
});
