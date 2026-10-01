import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type * as Y from 'yjs';
import { deleteObjects, snapshot, type TextSnapshot } from '../../src/shared/board-model';
import {
  createText, getTextContent, setTextBox, setTextWidthFixed,
} from '../../src/shared/objects/text';
import { TEXT_MAX_CHARS } from '../../src/shared/config';
import { addNote, click, moveTo, release, renderBoard } from './board';
import { flushFrame } from './helpers';

const textEl = (id: string) => document.querySelector(`[data-object-id="${id}"]`) as HTMLElement;
const texts = (doc: Y.Doc) => snapshot(doc).filter((o): o is TextSnapshot => o.type === 'text');
const editor = () => screen.getByRole('textbox', { name: 'Text' }) as HTMLTextAreaElement;
const ctrlZ = () => fireEvent.keyDown(window, { key: 'z', ctrlKey: true });

/** Adds text with the given content as if typed earlier (untracked by undo) and returns its id. */
function addText(doc: Y.Doc, at = { x: 100, y: 100 }, content = ''): string {
  let id = '';
  act(() => {
    id = createText(doc, at, 'g_test') as string;
    doc.transact(() => {
      if (content) getTextContent(doc, id)!.insert(0, content);
      setTextBox(doc, id, { width: Math.max(4, content.length * 11 + 4), height: 26 });
    }, 'seed');
  });
  return id;
}

describe('text objects', () => {
  it('TC-19 Enter edits with the caret at the end, Enter adds a line, Escape keeps the text selected', async () => {
    const { doc } = renderBoard();
    const id = addText(doc, undefined, 'hello');
    click(textEl(id));
    fireEvent.keyDown(window, { key: 'Enter' });
    const ta = editor();
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(5);
    expect(ta.selectionEnd).toBe(5);
    await userEvent.keyboard('{Enter}world');
    expect(texts(doc)[0].text).toBe('hello\nworld');
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(texts(doc)[0].text).toBe('hello\nworld');
    expect(textEl(id).dataset.selected).toBe('true');
  });

  it('double-clicking text edits it', () => {
    const { doc } = renderBoard();
    const id = addText(doc, undefined, 'hi');
    fireEvent.doubleClick(textEl(id));
    expect(editor().value).toBe('hi');
  });

  it('TC-20 Escape with no characters removes the text and clears the selection', async () => {
    const { doc } = renderBoard();
    fireEvent.keyDown(window, { key: 't' });
    fireEvent.click(screen.getByTestId('board-viewport'), { clientX: 200, clientY: 200, button: 0 });
    expect(texts(doc)).toHaveLength(1);
    await userEvent.keyboard('{Escape}');
    expect(texts(doc)).toHaveLength(0);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Text toolbar' })).toBeNull();
    expect(screen.queryByTestId('selection-box')).toBeNull();
  });

  it('whitespace-only text is kept when editing ends', async () => {
    const { doc } = renderBoard();
    const id = addText(doc);
    fireEvent.doubleClick(textEl(id));
    await userEvent.type(editor(), ' ');
    await userEvent.keyboard('{Escape}');
    expect(texts(doc)).toHaveLength(1);
  });

  it('typing writes the measured box; pasting past 5,000 characters is clamped', () => {
    const { doc } = renderBoard();
    const id = addText(doc);
    fireEvent.doubleClick(textEl(id));
    fireEvent.input(editor(), { target: { value: 'Went well' } });
    const t = texts(doc)[0];
    expect(t.text).toBe('Went well');
    expect(t.width).toBeGreaterThan(4);
    fireEvent.input(editor(), { target: { value: 'x'.repeat(TEXT_MAX_CHARS + 50) } });
    expect(texts(doc)[0].text).toHaveLength(TEXT_MAX_CHARS);
  });

  it('TC-21 the toolbar shows S M L XL with M pressed; XL changes the size and keeps the top-left', () => {
    const { doc } = renderBoard();
    const id = addText(doc, { x: 120, y: 80 }, 'Title');
    click(textEl(id));
    const bar = screen.getByRole('toolbar', { name: 'Text toolbar' });
    const sizes = ['S', 'M', 'L', 'XL'].map((s) => screen.getByRole('button', { name: s }));
    expect(sizes).toHaveLength(4);
    expect(bar.querySelector('[aria-pressed="true"]')?.textContent).toBe('M');
    fireEvent.click(screen.getByRole('button', { name: 'XL' }));
    const t = texts(doc)[0];
    expect(t.size).toBe('XL');
    expect([t.x, t.y]).toEqual([120, 80]);
    expect(t.height).toBeCloseTo(56 * 1.3);
    expect(screen.getByRole('button', { name: 'XL' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Delete text' }));
    expect(texts(doc)).toHaveLength(0);
  });

  it('TC-22 one selected text shows only the left and right handles', () => {
    const { doc } = renderBoard();
    const id = addText(doc, undefined, 'Title');
    click(textEl(id));
    expect(screen.getByRole('button', { name: 'Resize right' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resize left' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Resize top' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resize bottom' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resize bottom-right' })).toBeNull();
  });

  it('dragging the right handle sets a fixed width, rewraps and grows the height', async () => {
    const { doc } = renderBoard();
    const id = addText(doc, { x: 100, y: 100 }, 'one two six');
    click(textEl(id));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize right' }), { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    moveTo(document.body, -120, 0);
    await flushFrame();
    release(document.body, -120, 0);
    const t = texts(doc)[0];
    expect(t.widthMode).toBe('fixed');
    expect(t.width).toBeLessThan(60);
    expect(t.height).toBeGreaterThan(26);
    expect(t.x).toBe(100);
  });

  it('TC-23 text with a sticky note shows all handles; resizing keeps the font size', async () => {
    const { doc } = renderBoard();
    const id = addText(doc, { x: 0, y: 500 }, 'Title');
    act(() => { setTextWidthFixed(doc, id, 100); });
    addNote(doc, 100, 100);
    fireEvent.keyDown(window, { key: 'a', ctrlKey: true });
    expect(screen.getAllByRole('button', { name: /^Resize/ })).toHaveLength(8);
    const before = texts(doc)[0];
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize bottom-right' }), { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    moveTo(document.body, 200, 200);
    await flushFrame();
    release(document.body, 200, 200);
    const after = texts(doc)[0];
    expect(after.size).toBe(before.size);
    expect(after.widthMode).toBe('fixed');
    expect(after.width).toBeGreaterThan(before.width);
    expect(after.y).toBeGreaterThan(before.y);
  });

  it('TC-24 a remote delete while editing unmounts the editor without error or recreation', () => {
    const { doc } = renderBoard();
    const id = addText(doc, undefined, 'abc');
    fireEvent.doubleClick(textEl(id));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    act(() => { deleteObjects(doc, [id]); });
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(texts(doc)).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('TC-25 typing then Ctrl+Z reverts the text and the stored box together in one step', async () => {
    const { doc } = renderBoard();
    const id = addText(doc, undefined, 'seed');
    const start = texts(doc)[0];
    fireEvent.doubleClick(textEl(id));
    await userEvent.type(editor(), 'ab');
    const typed = texts(doc)[0];
    expect(typed.text).toBe('seedab');
    expect(typed.width).not.toBe(start.width);
    await userEvent.keyboard('{Control>}z{/Control}');
    const reverted = texts(doc)[0];
    expect(reverted.text).toBe('seed');
    expect([reverted.width, reverted.height]).toEqual([start.width, start.height]);
  });

  it('undoing a new text that was typed in removes it entirely, redo brings it back', async () => {
    const { doc } = renderBoard();
    fireEvent.keyDown(window, { key: 't' });
    fireEvent.click(screen.getByTestId('board-viewport'), { clientX: 200, clientY: 200, button: 0 });
    await userEvent.type(editor(), 'Heading');
    await userEvent.keyboard('{Escape}');
    expect(texts(doc)[0].text).toBe('Heading');
    ctrlZ();
    expect(texts(doc)).toHaveLength(0);
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(texts(doc)[0].text).toBe('Heading');
  });

  it('text is deleted and nudged like a note', () => {
    const { doc } = renderBoard();
    const id = addText(doc, { x: 50, y: 50 }, 'x');
    click(textEl(id));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(texts(doc)[0].x).toBe(51);
    fireEvent.keyDown(window, { key: 'Delete' });
    expect(texts(doc)).toHaveLength(0);
    ctrlZ();
    expect(texts(doc)).toHaveLength(1);
  });

  it('is reachable by Tab and announced by its content', () => {
    const { doc } = renderBoard();
    const id = addText(doc, undefined, 'Went well');
    expect(textEl(id).getAttribute('aria-label')).toBe('Went well');
    expect(textEl(id).tabIndex).toBe(0);
  });
});
