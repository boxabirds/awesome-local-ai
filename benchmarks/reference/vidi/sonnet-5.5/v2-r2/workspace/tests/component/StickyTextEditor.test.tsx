import { fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStickyText, snapshot } from '../../src/shared/board-model';
import { LONG_TEXT } from '../fixtures/texts';
import { click, notes, pointer, renderApp, viewport } from './helpers';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

function type(value: string) {
  const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
  fireEvent.input(ta, { target: { value } });
  return ta;
}

describe('sticky text editor', () => {
  it('TC-23 Enter on a selected note edits with the caret at the end', () => {
    const { doc, ids } = renderApp([{ x: 0, y: 0 }]);
    getStickyText(doc, ids[0])!.insert(0, 'hello');
    click(notes()[0], 500, 400);
    fireEvent.keyDown(window, { key: 'Enter' });
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(ta);
    expect(ta.value).toBe('hello');
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(5);
  });

  it('TC-24 Escape ends editing, keeps the text and the selection', () => {
    const { doc, ids } = renderApp([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(notes()[0]);
    const ta = type('Faster onboarding');
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(getStickyText(doc, ids[0])!.toString()).toBe('Faster onboarding');
    expect(notes()[0].getAttribute('data-selected')).toBe('true');
    expect(screen.getByText('Faster onboarding')).toBeTruthy();
  });

  it('TC-26 Backspace while editing edits text and does not delete the note', () => {
    const { doc, ids } = renderApp([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(notes()[0]);
    const ta = type('ab');
    fireEvent.keyDown(ta, { key: 'Backspace' });
    type('a');
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(snapshot(doc)).toHaveLength(1);
    expect(getStickyText(doc, ids[0])!.toString()).toBe('a');
  });

  it('TC-38 clicking outside ends editing and deselects', () => {
    const { doc, ids } = renderApp([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(notes()[0]);
    type('abc');
    pointer('pointerdown', viewport(), 5, 5);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(getStickyText(doc, ids[0])!.toString()).toBe('abc');
    expect(notes()[0].getAttribute('data-selected')).toBe('false');
  });

  it('TC-14/16 pasted text is cut at 1,000 characters and the counter shows 1000/1000', () => {
    const { doc, ids } = renderApp([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(notes()[0]);
    const ta = type(LONG_TEXT + LONG_TEXT.slice(0, 200));
    expect(ta.value).toBe(LONG_TEXT);
    expect(getStickyText(doc, ids[0])!.toString()).toBe(LONG_TEXT);
    expect(screen.getByTestId('note-counter').textContent).toBe('1000/1000');
    type(LONG_TEXT + 'x');
    expect(getStickyText(doc, ids[0])!.length).toBe(1000);
  });

  it('the counter only shows within 50 characters of the limit', () => {
    renderApp([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(notes()[0]);
    type(LONG_TEXT.slice(0, 949));
    expect(screen.queryByTestId('note-counter')).toBeNull();
    type(LONG_TEXT.slice(0, 950));
    expect(screen.getByTestId('note-counter').textContent).toBe('950/1000');
  });

  it('a new note shows no placeholder text when not editing', () => {
    renderApp([{ x: 0, y: 0 }]);
    expect(notes()[0].textContent).toBe('');
  });
});
