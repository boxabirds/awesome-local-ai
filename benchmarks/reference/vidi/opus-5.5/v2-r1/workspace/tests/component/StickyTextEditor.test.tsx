import { cleanup, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStickyText } from '../../src/shared/board-model';
import { STICKY_TEXT_MAX_CHARS } from '../../src/shared/config';
import { LONG_PROSE_1000, RETRO_ITEM, prose } from '../fixtures/texts';
import { dispatchKey } from './helpers';
import {
  click,
  docWithNote,
  editor,
  noteEl,
  noteToolbar,
  notesOf,
  renderApp,
  selectNote,
} from './stickyHelpers';

// Only animation frames are faked: user-event awaits real timers between keystrokes.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const counter = () => document.querySelector('.sticky-counter');

describe('sticky.text editing', () => {
  it('TC-23 Enter on a selected note starts editing with the caret at the end', () => {
    const { doc } = docWithNote('Faster onboarding');
    renderApp(doc);
    selectNote();
    const event = dispatchKey({ key: 'Enter' });
    expect(event.defaultPrevented).toBe(true);
    const textarea = editor() as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe('Faster onboarding');
    expect(textarea.selectionStart).toBe('Faster onboarding'.length);
    expect(textarea.selectionEnd).toBe('Faster onboarding'.length);
    expect(noteToolbar()).toBeNull();
  });

  it('TC-24 Escape ends editing, keeps the text and leaves the note selected', async () => {
    const { doc, id } = docWithNote('Faster');
    const { user } = renderApp(doc);
    selectNote();
    dispatchKey({ key: 'Enter' });
    await user.keyboard(' onboarding');
    await user.keyboard('{Escape}');
    expect(editor()).toBeNull();
    expect(getStickyText(doc, id)!.toString()).toBe('Faster onboarding');
    expect(noteEl().dataset.selected).toBe('true');
    expect(noteEl().textContent).toContain('Faster onboarding');
    expect(document.activeElement).toBe(noteEl());
    expect(noteToolbar()).not.toBeNull();
  });

  it('Enter inside the note adds a new line', async () => {
    const { doc, id } = docWithNote();
    const { user } = renderApp(doc);
    selectNote();
    dispatchKey({ key: 'Enter' });
    await user.keyboard('What went well{Enter}Pairing');
    expect(getStickyText(doc, id)!.toString()).toBe('What went well\nPairing');
    expect(editor()).not.toBeNull();
  });

  it('TC-26 Backspace while editing deletes a character, not the note', async () => {
    const { doc, id } = docWithNote('ab');
    const { user } = renderApp(doc);
    selectNote();
    dispatchKey({ key: 'Enter' });
    await user.keyboard('{Backspace}');
    expect(notesOf(doc)).toHaveLength(1);
    expect(getStickyText(doc, id)!.toString()).toBe('a');
    await user.keyboard('{Delete}');
    expect(notesOf(doc)).toHaveLength(1);
  });

  it('TC-38 typing then clicking outside keeps the text and deselects', async () => {
    const { doc, id } = docWithNote();
    const { user, viewport } = renderApp(doc);
    selectNote();
    dispatchKey({ key: 'Enter' });
    await user.keyboard('abc');
    const updates = vi.fn();
    doc.on('update', updates);
    click(viewport, 700, 600);
    expect(editor()).toBeNull();
    expect(getStickyText(doc, id)!.toString()).toBe('abc');
    expect(noteEl().dataset.selected).toBe('false');
    // Every keystroke was already written: ending the edit writes nothing.
    expect(updates).not.toHaveBeenCalled();
  });

  it('a pasted 1,200 characters keep the first 1,000 and the counter shows 1000/1000', () => {
    const { doc, id } = docWithNote();
    renderApp(doc);
    selectNote();
    dispatchKey({ key: 'Enter' });
    const textarea = editor() as HTMLTextAreaElement;
    const pasted = prose(1200);
    fireEvent.change(textarea, { target: { value: pasted } });
    expect(getStickyText(doc, id)!.toString()).toBe(pasted.slice(0, STICKY_TEXT_MAX_CHARS));
    expect(textarea.value).toHaveLength(1000);
    expect(textarea.selectionStart).toBe(1000);
    expect(counter()?.textContent).toBe('1000/1000');
  });

  it('the counter appears only within 50 characters of the limit', () => {
    const { doc } = docWithNote(LONG_PROSE_1000.slice(0, 949));
    renderApp(doc);
    selectNote();
    dispatchKey({ key: 'Enter' });
    expect(counter()).toBeNull();
    const textarea = editor() as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: LONG_PROSE_1000.slice(0, 950) } });
    expect(counter()?.textContent).toBe('950/1000');
  });

  it('an empty note shows no placeholder when not editing', () => {
    const { doc } = docWithNote();
    renderApp(doc);
    expect(document.querySelector('.sticky-text')?.textContent).toBe('');
    expect(document.querySelector('[placeholder]')).toBeNull();
  });

  it('multi-line text is displayed with its line breaks', () => {
    const { doc } = docWithNote(RETRO_ITEM);
    renderApp(doc);
    expect(document.querySelector('.sticky-text')?.textContent).toBe(RETRO_ITEM);
  });
});
