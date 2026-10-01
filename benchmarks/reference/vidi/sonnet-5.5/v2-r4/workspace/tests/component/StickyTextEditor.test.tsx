import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createSticky, getStickyText, snapshot } from '../../src/shared/board-model';
import { OVER_LIMIT_TEXT } from '../fixtures/texts';
import { click, noteEl, setupBoard, viewport } from './helpers';

afterEach(cleanup);

describe('sticky text editor', () => {
  it('TC-23 Enter on a selected note edits it with the caret at the end', () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }]);
    getStickyText(doc, ids[0])!.insert(0, 'hello');
    click(noteEl());
    fireEvent.keyDown(document.body, { key: 'Enter' });
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(ta);
    expect(ta.value).toBe('hello');
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(5);
  });

  it('TC-24 Escape ends editing, keeps text and the selection', async () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(noteEl());
    await userEvent.keyboard('Faster onboarding');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(snapshot(doc)[0].text).toBe('Faster onboarding');
    expect(noteEl().getAttribute('data-selected')).toBe('true');
  });

  it('remote typing appears in the open editor, keeps the caret, and is not erased by local typing', async () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(noteEl());
    await userEvent.keyboard('ab');
    act(() => getStickyText(doc, ids[0])!.insert(0, 'X', 'remote'));
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(ta.value).toBe('Xab');
    expect(ta.selectionStart).toBe(3);
    await userEvent.keyboard('c');
    expect(snapshot(doc)[0].text).toBe('Xabc');
  });

  it('deleting the note remotely ends editing without an error', () => {
    const { doc, ids } = setupBoard([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(noteEl());
    expect(screen.getByRole('textbox')).toBeTruthy();
    act(() => doc.transact(() => doc.getMap('objects').delete(ids[0]), 'remote'));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryAllByRole('group', { name: 'Sticky note' })).toHaveLength(0);
  });

  it('TC-26 Backspace while editing deletes a character, not the note', async () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(noteEl());
    await userEvent.keyboard('ab{Backspace}');
    expect(snapshot(doc)).toHaveLength(1);
    expect(snapshot(doc)[0].text).toBe('a');
  });

  it('TC-38 clicking outside ends editing and unselects', async () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(noteEl());
    await userEvent.keyboard('abc');
    await userEvent.click(viewport());
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(snapshot(doc)[0].text).toBe('abc');
    expect(noteEl().getAttribute('data-selected')).toBe('false');
  });

  it('Enter inside the editor adds a new line', async () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(noteEl());
    await userEvent.keyboard('a{Enter}b');
    expect(snapshot(doc)[0].text).toBe('a\nb');
  });

  it('pasting over the limit keeps exactly 1,000 characters and shows the counter', async () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    fireEvent.doubleClick(noteEl());
    expect(screen.queryByTestId('char-counter')).toBeNull();
    await userEvent.paste(OVER_LIMIT_TEXT);
    expect(snapshot(doc)[0].text).toBe(OVER_LIMIT_TEXT.slice(0, 1000));
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toHaveLength(1000);
    expect(screen.getByTestId('char-counter').textContent).toBe('1000/1000');
  });

  it('an empty note stays on the board and shows no text', () => {
    const { doc } = setupBoard([{ x: 0, y: 0 }]);
    createSticky(doc, { x: 300, y: 300 });
    expect(snapshot(doc)).toHaveLength(2);
  });
});
