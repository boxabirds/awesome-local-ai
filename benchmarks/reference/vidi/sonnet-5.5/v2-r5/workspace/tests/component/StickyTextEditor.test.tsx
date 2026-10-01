import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './TestApp';
import { snapshot } from '../../src/shared/board-model';
import { OVER_LIMIT_TEXT } from '../fixtures/texts';
import { Harness, newDoc } from './helpers';
import { createSticky, getStickyText } from '../../src/shared/board-model';

afterEach(cleanup);

function selectedNoteInApp() {
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
  const area = screen.getByRole('textbox');
  fireEvent.keyDown(area, { key: 'Escape' });
  return screen.getByRole('group', { name: 'Sticky note' });
}

describe('sticky text editor', () => {
  it('TC-23 Enter on a selected note edits with the caret at the end', async () => {
    const doc = newDoc();
    const id = createSticky(doc, { x: 0, y: 0 }) as string;
    getStickyText(doc, id)!.insert(0, 'hello');
    render(<Harness doc={doc} />);
    const note = screen.getByRole('group', { name: 'Sticky note' });
    note.focus();
    fireEvent.keyDown(note, { key: 'Enter' });
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(area);
    expect(area.value).toBe('hello');
    expect(area.selectionStart).toBe(5);
    expect(area.selectionEnd).toBe(5);
  });

  it('TC-23 Enter via the window handler edits the selected note', () => {
    selectedNoteInApp();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
  });

  it('TC-24 Escape keeps the text and leaves the note selected', async () => {
    const user = userEvent.setup();
    selectedNoteInApp();
    fireEvent.keyDown(window, { key: 'Enter' });
    await user.keyboard('abc{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    const note = screen.getByRole('group', { name: 'Sticky note' });
    expect(note.dataset.selected).toBe('true');
    expect(note.textContent).toContain('abc');
  });

  it('TC-26 Backspace while editing edits text and keeps the note', async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    await user.keyboard('ab{Backspace}');
    expect(screen.getByRole('group', { name: 'Sticky note' })).toBeTruthy();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('a');
  });

  it('TC-38 typing then clicking outside ends editing and deselects', async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    await user.keyboard('abc');
    fireEvent.pointerDown(screen.getByTestId('board-viewport'));
    expect(screen.queryByRole('textbox')).toBeNull();
    const note = screen.getByRole('group', { name: 'Sticky note' });
    expect(note.textContent).toContain('abc');
    expect(note.dataset.selected).toBe('false');
  });

  it('pasting over the limit keeps exactly 1,000 characters and shows 1000/1000', async () => {
    const user = userEvent.setup();
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Sticky note' }));
    await user.paste(OVER_LIMIT_TEXT);
    const area = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(area.value).toBe(OVER_LIMIT_TEXT.slice(0, 1000));
    expect(screen.getByTestId('sticky-counter').textContent).toBe('1000/1000');
  });
});

describe('model state after editing', () => {
  it('writes typed text into the Y.Text', async () => {
    const user = userEvent.setup();
    const doc = newDoc();
    createSticky(doc, { x: 0, y: 0 });
    render(<Harness doc={doc} />);
    fireEvent.doubleClick(screen.getByRole('group', { name: 'Sticky note' }));
    await user.keyboard('Hi');
    expect(snapshot(doc)[0].text).toBe('Hi');
  });
});
