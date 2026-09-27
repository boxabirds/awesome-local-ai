// sticky.text editing (story 2): TC-23, TC-24, TC-26, TC-38.
//
// Enter starts editing with the caret at the end; Escape ends editing and
// keeps the text; Backspace while editing edits the text (not the note);
// clicking outside ends editing with the text preserved.

import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  click,
  dispatch,
  inputValue,
  installResizeObserverMock,
  keyOn,
  pointerEvent,
  renderApp,
  viewportEl,
  windowKey,
} from './helpers';

const NOTE_CENTRE = { x: 640, y: 400 };

beforeEach(() => {
  vi.useFakeTimers();
  installResizeObserverMock();
});

afterEach(() => {
  cleanup();
});

function noteEls(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[data-testid="sticky-note"]'));
}

function firstNote(container: HTMLElement): HTMLElement {
  const el = noteEls(container)[0];
  if (el === undefined) throw new Error('no sticky note rendered');
  return el;
}

function createNoteViaButton(): void {
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="Sticky note"]');
  if (button === null) throw new Error('toolbar button not rendered');
  click(button);
}

function clickEmpty(container: HTMLElement): void {
  const vp = viewportEl(container);
  dispatch(vp, pointerEvent('pointerdown', 100, 100));
  dispatch(vp, pointerEvent('pointerup', 100, 100));
}

function clickNote(container: HTMLElement): void {
  const note = firstNote(container);
  dispatch(note, pointerEvent('pointerdown', NOTE_CENTRE.x, NOTE_CENTRE.y));
  dispatch(note, pointerEvent('pointerup', NOTE_CENTRE.x, NOTE_CENTRE.y));
}

function editingTextarea(): HTMLTextAreaElement {
  const el = document.querySelector<HTMLTextAreaElement>('[data-testid="sticky-editor"] textarea');
  if (el === null) throw new Error('no editor textarea rendered');
  return el;
}

function stickyTextEl(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-testid="sticky-text"]');
  if (el === null) throw new Error('no sticky text rendered');
  return el;
}

function typeInEditor(value: string): void {
  inputValue(editingTextarea(), value);
}

describe('sticky.text — editing', () => {
  it('TC-23 Enter on a selected note starts editing with the caret at the end', async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    typeInEditor('ab');
    keyOn(editingTextarea(), 'Escape');
    clickEmpty(container);
    clickNote(container);
    expect(document.querySelector('[data-testid="sticky-editor"]')).toBeNull();

    windowKey('Enter');

    const ta = editingTextarea();
    expect(ta.value).toBe('ab');
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(ta.value.length);
    expect(ta.selectionEnd).toBe(ta.value.length);
  });

  it('TC-24 Escape ends editing and keeps the text; the note stays selected', async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    typeInEditor('Hello world');

    keyOn(editingTextarea(), 'Escape');

    expect(document.querySelector('[data-testid="sticky-editor"]')).toBeNull();
    expect(stickyTextEl().textContent).toBe('Hello world');
    expect(firstNote(container).hasAttribute('data-selected')).toBe(true);
  });

  it("TC-26 Backspace while editing 'ab' edits the text, never deletes the note", async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    typeInEditor('ab');
    const ta = editingTextarea();

    const keyEvent = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    ta.dispatchEvent(keyEvent);
    expect(keyEvent.defaultPrevented).toBe(false);
    inputValue(ta, 'a');

    expect(noteEls(container)).toHaveLength(1);
    expect(document.querySelector('[data-testid="sticky-editor"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="sticky-text"]')).toBeNull(); // still editing

    keyOn(ta, 'Escape');
    expect(stickyTextEl().textContent).toBe('a');
    expect(noteEls(container)).toHaveLength(1);
  });

  it("TC-38 type 'abc' then click outside: editor unmounted, text kept, unselected", async () => {
    const { container } = await renderApp();
    createNoteViaButton();
    typeInEditor('abc');

    const vp = viewportEl(container);
    dispatch(vp, pointerEvent('pointerdown', 100, 100));

    expect(document.querySelector('[data-testid="sticky-editor"]')).toBeNull();
    expect(stickyTextEl().textContent).toBe('abc');
    expect(firstNote(container).hasAttribute('data-selected')).toBe(false);
    expect(container.querySelector('[data-testid="note-toolbar"]')).toBeNull();
  });
});
