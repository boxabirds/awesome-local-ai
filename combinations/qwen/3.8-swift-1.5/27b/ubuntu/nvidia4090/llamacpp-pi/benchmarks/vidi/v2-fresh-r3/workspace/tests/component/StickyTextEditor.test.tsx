import { describe, it, expect, afterEach } from 'vitest';
import { screen, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getStickyText } from '../../src/shared/board-model';
import { renderApp, pointerEvent, windowKeyDown, type AppHarness } from './appHarness';

afterEach(() => {
  cleanup();
});

function getViewport(): HTMLElement {
  return screen.getByTestId('board-viewport');
}

function getEditor() {
  return screen.queryByTestId('sticky-text-editor');
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByTestId('sticky-textarea') as HTMLTextAreaElement;
}

/** Selects the note with a short press, then starts editing with Enter. */
function startEditing(app: AppHarness, id: string) {
  const note = app.note(id);
  act(() => {
    pointerEvent(note, 'pointerdown', 100, 100);
  });
  act(() => {
    pointerEvent(note, 'pointerup', 100, 100);
  });
  act(() => {
    windowKeyDown('Enter');
  });
}

describe('sticky.text (ui-component)', async () => {
  it('TC-23: Enter on selected note → Editing; textarea focused, caret at end', async () => {
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    act(() => {
      getStickyText(app.doc, id)!.insert(0, 'hello');
    });

    startEditing(app, id);

    const textarea = getTextarea();
    expect(getEditor()).not.toBeNull();
    expect(textarea.value).toBe('hello');
    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
  });

  it('TC-24: Escape while editing → Selected; text preserved', async () => {
    const user = userEvent.setup();
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    act(() => {
      getStickyText(app.doc, id)!.insert(0, 'hello');
    });

    startEditing(app, id);
    await user.type(getTextarea(), 'X');
    expect(getTextarea().value).toBe('helloX');

    act(() => {
      getTextarea().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }),
      );
    });

    // Editing ended, note still selected
    expect(getEditor()).toBeNull();
    expect(app.note(id).getAttribute('data-selected')).toBe('true');
    // Text preserved
    expect(getStickyText(app.doc, id)!.toString()).toBe('helloX');
    expect(app.notes().find((n) => n.id === id)!.text).toBe('helloX');
  });

  it('TC-26: Backspace while editing "ab" → note present, text "a" (negative: no delete)', async () => {
    const user = userEvent.setup();
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });
    act(() => {
      getStickyText(app.doc, id)!.insert(0, 'ab');
    });

    startEditing(app, id);
    expect(getTextarea().value).toBe('ab');

    // Backspace edits the text, it must NOT delete the note
    await user.keyboard('{Backspace}');

    expect(app.noteOrNull(id)).not.toBeNull(); // note still present
    expect(getStickyText(app.doc, id)!.toString()).toBe('a');
    expect(getEditor()).not.toBeNull(); // still editing
  });

  it('TC-38: type "abc" then click outside → editor unmounted, Y.Text "abc", Unselected', async () => {
    const user = userEvent.setup();
    const app = await renderApp();
    const id = app.addNote({ x: 200, y: 200 });

    startEditing(app, id);
    await user.type(getTextarea(), 'abc');
    expect(getTextarea().value).toBe('abc');

    // Click outside the note (empty board space)
    act(() => {
      pointerEvent(getViewport(), 'pointerdown', 500, 400);
    });

    expect(getEditor()).toBeNull(); // editor unmounted
    expect(getStickyText(app.doc, id)!.toString()).toBe('abc'); // text kept
    expect(app.note(id).getAttribute('data-selected')).toBe('false'); // unselected
  });
});
