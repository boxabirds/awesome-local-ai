import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { App } from '../../src/client/App';
import { StickyTextEditor } from '../../src/client/objects/StickyTextEditor';
import { OVER_LIMIT_TEXT } from '../fixtures/texts';
import { clickEmptyBoard, createByDblClick, notes } from './helpers';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const textbox = () => screen.getByRole('textbox') as HTMLTextAreaElement;
const typeText = (value: string) => fireEvent.change(textbox(), { target: { value } });
const noteText = () => notes()[0].querySelector('.sticky-text')?.textContent;

describe('StickyTextEditor', () => {
  it('TC-23 Enter on a selected note edits it with the caret at the end', () => {
    render(<App />);
    createByDblClick();
    typeText('Hello');
    fireEvent.keyDown(textbox(), { key: 'Escape' });
    expect(notes()[0].dataset.selected).toBe('true');
    fireEvent.keyDown(window, { key: 'Enter' });
    const ta = textbox();
    expect(document.activeElement).toBe(ta);
    expect(ta.value).toBe('Hello');
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(5);
  });

  it('TC-24 Escape ends editing, keeps the text and the selection', () => {
    render(<App />);
    createByDblClick();
    typeText('Keep me');
    fireEvent.keyDown(textbox(), { key: 'Escape' });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(notes()[0].dataset.selected).toBe('true');
    expect(noteText()).toBe('Keep me');
  });

  it('TC-26 Backspace while editing does not delete the note', () => {
    render(<App />);
    createByDblClick();
    typeText('ab');
    fireEvent.keyDown(textbox(), { key: 'Backspace' });
    typeText('a'); // the browser would apply the deletion to the value
    expect(notes()).toHaveLength(1);
    fireEvent.keyDown(textbox(), { key: 'Delete' });
    expect(notes()).toHaveLength(1);
    fireEvent.keyDown(textbox(), { key: 'Escape' });
    expect(noteText()).toBe('a');
  });

  it('TC-38 clicking outside ends editing, keeps text and deselects', () => {
    render(<App />);
    createByDblClick();
    typeText('abc');
    clickEmptyBoard();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(notes()[0].dataset.selected).toBe('false');
    expect(noteText()).toBe('abc');
  });

  it('pasting over the limit keeps 1,000 characters and shows the counter', () => {
    render(<App />);
    createByDblClick();
    expect(screen.queryByText(/\/1000$/)).toBeNull();
    typeText(OVER_LIMIT_TEXT);
    expect(textbox().value).toBe(OVER_LIMIT_TEXT.slice(0, 1000));
    expect(screen.getByText('1000/1000')).toBeTruthy();
  });

  it('counter appears only within 50 characters of the limit', () => {
    render(<App />);
    createByDblClick();
    typeText('x'.repeat(949));
    expect(screen.queryByText('949/1000')).toBeNull();
    typeText('x'.repeat(950));
    expect(screen.getByText('950/1000')).toBeTruthy();
  });

  it('Enter inside the editor does not leave edit mode', () => {
    render(<App />);
    createByDblClick();
    fireEvent.keyDown(textbox(), { key: 'Enter' });
    expect(screen.getByRole('textbox')).toBeTruthy();
  });

  it('writes a minimal diff into the given Y.Text', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('t');
    ytext.insert(0, 'abc');
    render(<StickyTextEditor ytext={ytext} fontPx={24} onEnd={() => {}} />);
    const ta = textbox();
    expect(ta.value).toBe('abc');
    fireEvent.change(ta, { target: { value: 'abXc' } });
    expect(ytext.toString()).toBe('abXc');
  });
});
